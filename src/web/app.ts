/**
 * De webkant: een dunne schil rond de domeinlogica.
 *
 * Express is bewust dun gehouden: geen eigen conventies of extra lagen. Elk
 * endpoint is hier in enkele regels te lezen: verzoek binnen, identiteit
 * bepalen, domeinlaag aanroepen, antwoord terug. De domeinlogica staat los
 * van Express, dus de oplossing kan ook achter een ander framework of een
 * API-gateway gehangen worden zonder dat de kern wijzigt.
 *
 * `maakApp` krijgt de database en de instellingen mee in plaats van ze zelf
 * te openen of te lezen. Zo kunnen de tests de echte endpoints aanspreken
 * met een lege database in het geheugen, een eigen testmap en een eigen
 * tokengeheim, en start `server.ts` de app met de echte configuratie.
 *
 * Het contract van deze API staat machineleesbaar in `openapi.yaml`; de
 * betekenis van de velden in `GET /api/context.jsonld` (JSON-LD).
 */

import express from 'express';
import multer from 'multer';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';

import type { Db } from '../opslag/database.js';
import { STANDAARD_OPSLAGWORTEL } from '../opslag/bestandsopslag.js';
import { Documentenregister, type Documentrij } from '../opslag/documenten.js';
import { maakVoorstel, verwerkDocument, type Aanbieding } from '../verwerking/verwerkDocument.js';
import { handelNazichtAf } from '../verwerking/nazicht.js';
import { Auditlog } from '../audit/auditlog.js';
import { BELEID, BELEIDSVERSIE } from '../beleid/beleid.js';
import {
  bepaalIdentiteit,
  beoordeelToegang,
  magAanbieden,
  STANDAARDROL,
  type Identiteit,
} from '../autorisatie/autorisatie.js';
import { controleerAanmelding } from '../autorisatie/aanmelding.js';
import { maakToken, GELDIGHEID_SECONDEN } from '../autorisatie/token.js';
import { Sessiebeheer } from '../autorisatie/sessies.js';
import { MAXIMUM_BYTES } from '../domein/validatie.js';
import { JSONLD_CONTEXT } from './context.js';

const hier = dirname(fileURLToPath(import.meta.url));
const WORTEL = join(hier, '../..');

export interface Instellingen {
  /** Geheim waarmee tokens ondertekend en gecontroleerd worden. */
  tokengeheim: string;
  /** Afgeschermde map voor de documenten. */
  opslagwortel?: string;
}

/** Elke fout heeft dezelfde vorm: een vaste code en een zin in gewone taal. */
function fout(res: express.Response, status: number, code: string, boodschap: string): null {
  res.status(status).json({ fout: code, boodschap });
  return null;
}

/** De fiche van een document zoals ze naar buiten gaat: zonder intern pad, mét betekenis. */
function naarBuiten({ opslagpad, ...rest }: Documentrij) {
  return { '@context': '/api/context.jsonld', ...rest, toegang: JSON.parse(rest.toegang) as string[] };
}

export function maakApp(db: Db, instellingen: Instellingen): express.Express {
  const { tokengeheim, opslagwortel = STANDAARD_OPSLAGWORTEL } = instellingen;
  const audit = new Auditlog(db);
  const documenten = new Documentenregister(db);
  const sessies = new Sessiebeheer();

  /**
   * Het bestand blijft in het geheugen tot het gevalideerd en geclassificeerd
   * is. Zo belandt een geweigerd of nog niet ingeschaald document nooit op de
   * schijf. De limiet staat hier én in de validatie: de eerste beschermt de
   * server, de tweede geeft de gebruiker een begrijpelijke boodschap.
   */
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAXIMUM_BYTES } });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  // Basisbeveiliging van elk antwoord: geen MIME sniffing, geen framing door
  // andere sites (clickjacking), geen URL-lek via Referer, geen caching.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.static(join(WORTEL, 'public')));

  /* ------------------------------------------------------------ */
  /* Wie ben je, en wat mag je?                                     */
  /* ------------------------------------------------------------ */

  /** Identiteit uit het token; bij een vervalst, verlopen of ingetrokken token meteen 401. */
  function identiteit(req: express.Request, res: express.Response): Identiteit | null {
    const wie = bepaalIdentiteit(req.header('Authorization'), tokengeheim);
    if (wie === 'ongeldig' || (wie.tokenId && sessies.isIngetrokken(wie.tokenId))) {
      return fout(res, 401, 'aanmelding_ongeldig', 'Uw aanmelding is verlopen of ongeldig. Meld u opnieuw aan.');
    }
    return wie;
  }

  /** Enkel de dossierbeheerder; elke andere poging wordt gelogd. */
  function alsDossierbeheerder(req: express.Request, res: express.Response, waarvoor: string): Identiteit | null {
    const wie = identiteit(req, res);
    if (!wie) return null;
    if (wie.rol !== 'dossierbeheerder') {
      audit.schrijf({ actor: wie.gebruiker, rol: wie.rol, handeling: 'toegang_geweigerd', motivering: waarvoor, uitkomst: 'geweigerd' });
      return fout(res, 403, 'geen_rechten', 'Dit is enkel toegankelijk voor een dossierbeheerder.');
    }
    return wie;
  }

  /** Mag deze aangemelde gebruiker dit document zien? Elke beslissing wordt gelogd. */
  function controleerInzage(req: express.Request<{ id: string }>, res: express.Response, toelichting = ''): Documentrij | null {
    const wie = identiteit(req, res);
    if (!wie) return null;
    const document = documenten.haal(req.params.id);
    if (!document) return fout(res, 404, 'niet_gevonden', 'Onbekend document.');

    const beslissing = beoordeelToegang(wie.rol, document.classificatie);
    audit.schrijf({
      actor: wie.gebruiker,
      rol: wie.rol,
      documentId: document.id,
      handeling: beslissing.toegestaan ? 'toegang_verleend' : 'toegang_geweigerd',
      classificatie: document.classificatie,
      motivering: beslissing.reden + toelichting,
      uitkomst: beslissing.toegestaan ? 'geslaagd' : 'geweigerd',
    });
    return beslissing.toegestaan ? document : fout(res, 403, 'geen_rechten', beslissing.reden);
  }

  /** Voor voorstel en opslaan: wie is het, mag die aanbieden, en is er een bestand? */
  function leesAanbieding(req: express.Request, res: express.Response): Aanbieding | null {
    const wie = identiteit(req, res);
    if (!wie) return null;
    if (!magAanbieden(wie.rol)) {
      audit.schrijf({ actor: wie.gebruiker, rol: wie.rol, handeling: 'toegang_geweigerd', motivering: 'Poging tot aanbieden van een document.', uitkomst: 'geweigerd' });
      return fout(res, 403, 'geen_rechten', 'Alleen een aangemelde medewerker of dossierbeheerder kan documenten aanbieden.');
    }
    if (!req.file) return fout(res, 400, 'geen_bestand', 'Er is geen bestand meegestuurd.');

    // Een leeg veld krijgt een redelijke standaardwaarde; de lengte wordt
    // daarna gecontroleerd in de validatie.
    return {
      inhoud: req.file.buffer,
      bestandsnaam: req.file.originalname,
      mimetype: req.file.mimetype,
      metadata: {
        titel: String(req.body?.titel ?? '').trim() || req.file.originalname,
        bron: String(req.body?.bron ?? '').trim() || 'onbekend',
        beoogdeZichtbaarheid: req.body?.beoogdeZichtbaarheid === 'publiek' ? 'publiek' : 'intern',
      },
      actor: wie.gebruiker,
      rol: wie.rol,
    };
  }

  /* ------------------------------------------------------------ */
  /* Aanmelden en afmelden                                          */
  /* ------------------------------------------------------------ */

  app.post('/api/aanmelden', (req, res) => {
    const gebruikersnaam = String(req.body?.gebruikersnaam ?? '').trim().slice(0, 100);
    const wachtwoord = String(req.body?.wachtwoord ?? '');
    const sleutel = `${req.ip}|${gebruikersnaam.toLowerCase()}`;
    const actor = gebruikersnaam || 'onbekend';

    const wachtSeconden = sessies.geblokkeerd(sleutel);
    if (wachtSeconden > 0) {
      audit.schrijf({ actor, rol: STANDAARDROL, handeling: 'aanmelding_mislukt', motivering: 'Tijdelijk geblokkeerd na te veel mislukte pogingen.', uitkomst: 'geweigerd' });
      res.setHeader('Retry-After', String(wachtSeconden));
      return fout(res, 429, 'te_veel_pogingen', `Te veel mislukte aanmeldingen. Probeer het over ${Math.ceil(wachtSeconden / 60)} minuten opnieuw.`);
    }

    const rol = controleerAanmelding(gebruikersnaam, wachtwoord);
    if (!rol) {
      sessies.registreerMislukking(sleutel);
      audit.schrijf({ actor, rol: STANDAARDROL, handeling: 'aanmelding_mislukt', uitkomst: 'geweigerd' });
      // Eén boodschap voor beide gevallen: zo verraadt het antwoord niet of
      // de gebruikersnaam bestaat.
      return fout(res, 401, 'aanmelding_mislukt', 'Gebruikersnaam of wachtwoord is onjuist.');
    }

    sessies.registreerSucces(sleutel);
    audit.schrijf({ actor, rol, handeling: 'aangemeld', uitkomst: 'geslaagd' });
    return res.json({
      token: maakToken(gebruikersnaam, rol, tokengeheim),
      gebruiker: gebruikersnaam,
      rol,
      geldigTot: new Date(Date.now() + GELDIGHEID_SECONDEN * 1000).toISOString(),
    });
  });

  app.post('/api/afmelden', (req, res) => {
    const wie = identiteit(req, res);
    if (!wie) return;
    if (wie.tokenId && wie.verlooptOp) {
      sessies.trekIn(wie.tokenId, wie.verlooptOp);
      audit.schrijf({ actor: wie.gebruiker, rol: wie.rol, handeling: 'afgemeld', uitkomst: 'geslaagd' });
    }
    return res.status(204).end();
  });

  /* ------------------------------------------------------------ */
  /* Documenten: voorstel bekijken, opslaan, terugvinden            */
  /* ------------------------------------------------------------ */

  /** Classificeert en toont wat er zou gebeuren, zonder iets op te slaan. */
  app.post('/api/classificaties', upload.single('bestand'), async (req, res) => {
    const aanbieding = leesAanbieding(req, res);
    if (!aanbieding) return;

    const voorstel = await maakVoorstel(aanbieding);
    if (voorstel.uitkomst === 'geweigerd') return fout(res, 422, voorstel.fout.code, voorstel.fout.boodschap);

    audit.schrijf({
      actor: aanbieding.actor,
      rol: aanbieding.rol,
      handeling: 'classificatie_voorgesteld',
      classificatie: voorstel.classificatie.classificatie,
      zekerheid: voorstel.classificatie.zekerheid,
      signalen: voorstel.classificatie.signalen,
      beleidsversie: BELEIDSVERSIE,
      uitkomst: 'geslaagd',
    });
    return res.json({
      classificatie: voorstel.classificatie.classificatie,
      zekerheid: voorstel.classificatie.zekerheid,
      motivering: voorstel.classificatie.motivering,
      signalen: voorstel.classificatie.signalen,
      status: voorstel.status,
      opslagmap: voorstel.regel.opslagmap,
      toegang: voorstel.regel.toegang,
      bewarenTot: voorstel.bewarenTot,
      beleidsversie: BELEIDSVERSIE,
    });
  });

  /** Classificeert opnieuw en slaat op. Het voorstel uit de browser wordt nooit overgenomen. */
  app.post('/api/documenten', upload.single('bestand'), async (req, res) => {
    const aanbieding = leesAanbieding(req, res);
    if (!aanbieding) return;

    const resultaat = await verwerkDocument(db, aanbieding, opslagwortel);
    if (resultaat.uitkomst === 'geweigerd') return fout(res, 422, resultaat.fout.code, resultaat.fout.boodschap);

    return res.status(201).json({
      documentId: resultaat.documentId,
      classificatie: resultaat.classificatie.classificatie,
      zekerheid: resultaat.classificatie.zekerheid,
      motivering: resultaat.classificatie.motivering,
      signalen: resultaat.classificatie.signalen,
      status: resultaat.status,
      opslagmap: resultaat.opslagmap,
      toegang: resultaat.toegang,
      bewarenTot: resultaat.bewarenTot,
      beleidsversie: BELEIDSVERSIE,
    });
  });

  app.get('/api/documenten/:id', (req, res) => {
    const document = controleerInzage(req, res);
    if (document) res.json(naarBuiten(document));
  });

  app.get('/api/documenten/:id/bestand', (req, res) => {
    const document = controleerInzage(req, res, ' (opvragen bestand)');
    if (!document) return;

    // Het pad komt uit de databank, nooit uit het verzoek; het type werd bij
    // de validatie bepaald; het bestand wordt als download aangeboden.
    res.setHeader('Content-Type', document.mimetype);
    res.setHeader('Content-Disposition', `attachment; filename="${document.bestandsnaam.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    const stroom = createReadStream(document.opslagpad);
    stroom.on('error', (f) => {
      console.error('Bestand niet leesbaar:', f);
      if (!res.headersSent) fout(res, 500, 'bestand_niet_beschikbaar', 'Het bestand is momenteel niet beschikbaar. Contacteer de beheerder.');
      else res.destroy();
    });
    stroom.pipe(res);
  });

  /* ------------------------------------------------------------ */
  /* Auditlog                                                       */
  /* ------------------------------------------------------------ */

  /**
   * De dossierbeheerder ziet alles; een medewerker enkel het spoor van
   * documenten die hij zelf aanbood (afgeleid uit het auditlog zelf), zodat
   * hij de genomen beslissing kan terugvinden. Ook inzage wordt gelogd.
   */
  app.get('/api/auditlog', (req, res) => {
    const wie = identiteit(req, res);
    if (!wie) return;
    const documentId = typeof req.query.documentId === 'string' ? req.query.documentId : undefined;
    const eigenDocument = wie.rol === 'medewerker' && documentId !== undefined && audit.isAanbieder(documentId, wie.gebruiker);

    if (wie.rol !== 'dossierbeheerder' && !eigenDocument) {
      audit.schrijf({ actor: wie.gebruiker, rol: wie.rol, documentId, handeling: 'toegang_geweigerd', motivering: 'Poging tot raadplegen van het auditlog.', uitkomst: 'geweigerd' });
      return fout(res, 403, 'geen_rechten', 'Het volledige auditlog is enkel raadpleegbaar door een dossierbeheerder. Een medewerker kan enkel het spoor bekijken van documenten die hij zelf aanbood.');
    }
    audit.schrijf({ actor: wie.gebruiker, rol: wie.rol, documentId, handeling: 'auditlog_geraadpleegd', uitkomst: 'geslaagd' });
    return res.json(documentId !== undefined ? audit.voorDocument(documentId) : audit.recent());
  });

  app.get('/api/auditlog/integriteit', (req, res) => {
    if (alsDossierbeheerder(req, res, 'Poging om de integriteit van het auditlog te controleren.')) {
      res.json(audit.controleerIntegriteit());
    }
  });

  /* ------------------------------------------------------------ */
  /* Nazicht: wat het systeem niet zeker wist, handelt een mens af  */
  /* ------------------------------------------------------------ */

  app.get('/api/nazicht', (req, res) => {
    if (alsDossierbeheerder(req, res, 'Poging om de nazichtlijst te raadplegen.')) {
      res.json(documenten.inNazicht().map(naarBuiten));
    }
  });

  /** Body: { beslissing: 'bevestigen' | 'herclassificeren', classificatie?, motivering } */
  app.post('/api/documenten/:id/nazicht', (req, res) => {
    const wie = alsDossierbeheerder(req, res, 'Poging om nazicht af te handelen.');
    if (!wie) return;

    const beslissing = req.body?.beslissing;
    if (beslissing !== 'bevestigen' && beslissing !== 'herclassificeren') {
      return fout(res, 400, 'beslissing_ongeldig', "De beslissing moet 'bevestigen' of 'herclassificeren' zijn.");
    }

    const resultaat = handelNazichtAf(
      db,
      {
        documentId: req.params.id,
        beslissing,
        classificatie: typeof req.body?.classificatie === 'string' ? req.body.classificatie : undefined,
        motivering: String(req.body?.motivering ?? '').slice(0, 1000),
        actor: wie.gebruiker,
        rol: wie.rol,
      },
      opslagwortel,
    );
    if (resultaat.uitkomst === 'geweigerd') {
      const status = { niet_gevonden: 404, geen_rechten: 403 }[resultaat.fout.code as string] ?? 422;
      return fout(res, status, resultaat.fout.code, resultaat.fout.boodschap);
    }
    return res.json(resultaat);
  });

  /* ------------------------------------------------------------ */
  /* Transparantie: de regels, het contract en de betekenis          */
  /* ------------------------------------------------------------ */

  app.get('/api/beleid', (_req, res) => res.json({ versie: BELEIDSVERSIE, regels: BELEID }));
  app.get('/api/openapi.yaml', (_req, res) => res.type('application/yaml').sendFile(join(WORTEL, 'openapi.yaml')));
  app.get('/api/context.jsonld', (_req, res) => res.type('application/ld+json').json(JSONLD_CONTEXT));

  /* ------------------------------------------------------------ */
  /* Foutafhandeling                                                */
  /* ------------------------------------------------------------ */

  app.use((f: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (f instanceof multer.MulterError && f.code === 'LIMIT_FILE_SIZE') {
      return fout(res, 413, 'bestand_te_groot', `Het bestand is groter dan ${MAXIMUM_BYTES / 1024 / 1024} MB.`);
    }
    // Technische details blijven aan de serverkant.
    console.error('Onverwachte fout:', f);
    return fout(res, 500, 'interne_fout', 'Er liep iets mis bij het verwerken van het document. Probeer het opnieuw.');
  });

  return app;
}
