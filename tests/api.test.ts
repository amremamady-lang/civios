/**
 * Tests op de echte endpoints.
 *
 * De andere testbestanden controleren de onderdelen afzonderlijk. Deze tests
 * controleren of die onderdelen ook correct op de API zijn aangesloten: dat
 * aanmelden en de rolcontrole effectief gebeuren, dat statuscodes kloppen en
 * dat er geen interne informatie naar buiten lekt.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { maakDatabase } from '../src/opslag/database.js';
import { maakApp } from '../src/web/app.js';
import { stopOcr } from '../src/classificatie/ocr.js';
import { MODELBESTAND } from '../src/classificatie/ner.js';
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** Tests die het echte taalmodel nodig hebben, slaan zichzelf over zolang `npm run model` niet gedraaid is. */
const metModel = it.skipIf(!existsSync(MODELBESTAND));

// Een eigen opslagmap, zodat deze tests niet botsen met de andere testbestanden.
const OPSLAG = './opslag-test-api';

let server: Server;
let basis: string;

/** Tokens per rol; een burger meldt zich niet aan en heeft er geen. */
const tokens: Record<string, string | null> = { burger: null };

function aanmelden(gebruikersnaam: string, wachtwoord: string) {
  return fetch(`${basis}/api/aanmelden`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gebruikersnaam, wachtwoord }),
  });
}

beforeAll(async () => {
  const app = maakApp(maakDatabase(':memory:'), {
    tokengeheim: 'testgeheim-voor-de-api-tests',
    opslagwortel: OPSLAG,
  });
  server = app.listen(0);
  await new Promise((klaar) => server.once('listening', klaar));
  basis = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  tokens.medewerker = (await (await aanmelden('j.peeters', 'Demo-medewerker-2026')).json()).token;
  tokens.dossierbeheerder = (await (await aanmelden('m.claes', 'Demo-beheerder-2026')).json()).token;
});

afterAll(async () => {
  server?.close();
  await stopOcr();
  rmSync(OPSLAG, { recursive: true, force: true });
});

function kop(rol: string): Record<string, string> {
  const token = tokens[rol];
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function stuur(
  rol: string,
  inhoud: string,
  naam = 'nota.txt',
  type = 'text/plain',
  zichtbaarheid = 'publiek',
) {
  const formulier = new FormData();
  formulier.append('bestand', new Blob([inhoud], { type }), naam);
  formulier.append('titel', 'Testdocument');
  formulier.append('bron', 'loket');
  formulier.append('beoogdeZichtbaarheid', zichtbaarheid);
  return fetch(`${basis}/api/documenten`, { method: 'POST', headers: kop(rol), body: formulier });
}

function haal(pad: string, rol: string) {
  return fetch(`${basis}${pad}`, { headers: kop(rol) });
}

describe('POST /api/aanmelden', () => {
  it('geeft een token terug bij een juist wachtwoord', async () => {
    const antwoord = await aanmelden('j.peeters', 'Demo-medewerker-2026');
    expect(antwoord.status).toBe(200);
    const data = await antwoord.json();
    expect(data.rol).toBe('medewerker');
    expect(data.token.split('.')).toHaveLength(3);
  });

  it('geeft 401 bij een fout wachtwoord, zonder te verraden of de gebruiker bestaat', async () => {
    const fout = await aanmelden('j.peeters', 'fout');
    const onbekend = await aanmelden('bestaat.niet', 'fout');
    expect(fout.status).toBe(401);
    expect(onbekend.status).toBe(401);
    expect((await fout.json()).boodschap).toBe((await onbekend.json()).boodschap);
  });

  it('blokkeert tijdelijk na te veel mislukte pogingen voor dezelfde gebruiker', async () => {
    for (let i = 0; i < 5; i++) await aanmelden('r.raden', 'fout');
    const geblokkeerd = await aanmelden('r.raden', 'fout');
    expect(geblokkeerd.status).toBe(429);
    expect(geblokkeerd.headers.get('retry-after')).toBeTruthy();
    // Zelfs het juiste wachtwoord helpt niet meer tijdens de blokkering.
    expect((await aanmelden('r.raden', 'Demo-medewerker-2026')).status).toBe(429);
    // Een andere gebruiker is niet geraakt.
    expect((await aanmelden('j.peeters', 'Demo-medewerker-2026')).status).toBe(200);
  });
});

describe('afmelden', () => {
  it('trekt het token in: daarna is het ongeldig, ook vóór het verloopt', async () => {
    const { token } = await (await aanmelden('j.peeters', 'Demo-medewerker-2026')).json();
    const kopje = { Authorization: `Bearer ${token}` };

    expect((await fetch(`${basis}/api/afmelden`, { method: 'POST', headers: kopje })).status).toBe(204);

    const formulier = new FormData();
    formulier.append('bestand', new Blob(['Een gewone brochure.'], { type: 'text/plain' }), 'nota.txt');
    const daarna = await fetch(`${basis}/api/classificaties`, { method: 'POST', headers: kopje, body: formulier });
    expect(daarna.status).toBe(401);
  });
});

describe('nazicht via de API', () => {
  async function scanInNazicht(rol: string) {
    const formulier = new FormData();
    formulier.append('bestand', new Blob(['   '], { type: 'text/plain' }), 'leeg.txt');
    formulier.append('titel', 'Onleesbare scan');
    const r = await fetch(`${basis}/api/documenten`, { method: 'POST', headers: kop(rol), body: formulier });
    const data = await r.json();
    expect(data.status).toBe('in_nazicht');
    return data.documentId as string;
  }

  it('toont de wachtrij enkel aan een dossierbeheerder', async () => {
    const id = await scanInNazicht('medewerker');
    expect((await haal('/api/nazicht', 'medewerker')).status).toBe(403);
    const antwoord = await haal('/api/nazicht', 'dossierbeheerder');
    expect(antwoord.status).toBe(200);
    const lijst = (await antwoord.json()) as { id: string; opslagpad?: string }[];
    expect(lijst.some((d) => d.id === id)).toBe(true);
    expect(lijst.every((d) => !('opslagpad' in d))).toBe(true);
  });

  it('laat een dossierbeheerder herclassificeren, met motivering in het spoor', async () => {
    const id = await scanInNazicht('medewerker');
    const antwoord = await fetch(`${basis}/api/documenten/${id}/nazicht`, {
      method: 'POST',
      headers: { ...kop('dossierbeheerder'), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        beslissing: 'herclassificeren',
        classificatie: 'intern',
        motivering: 'Scan nagekeken: interne nota zonder persoonsgegevens.',
      }),
    });
    expect(antwoord.status).toBe(200);
    expect((await antwoord.json()).classificatie).toBe('intern');

    const document = await (await haal(`/api/documenten/${id}`, 'medewerker')).json();
    expect(document.status).toBe('definitief_opgeslagen');
    expect(document.classificatie).toBe('intern');
  });

  it('weigert een beslissing zonder motivering met 422 en een medewerker met 403', async () => {
    const id = await scanInNazicht('medewerker');
    const zonder = await fetch(`${basis}/api/documenten/${id}/nazicht`, {
      method: 'POST',
      headers: { ...kop('dossierbeheerder'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ beslissing: 'bevestigen', motivering: '' }),
    });
    expect(zonder.status).toBe(422);
    const medewerker = await fetch(`${basis}/api/documenten/${id}/nazicht`, {
      method: 'POST',
      headers: { ...kop('medewerker'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ beslissing: 'bevestigen', motivering: 'Ik keur mijn eigen document goed.' }),
    });
    expect(medewerker.status).toBe(403);
  });

  it('meldt of de hash-ketting van het auditlog intact is', async () => {
    expect((await haal('/api/auditlog/integriteit', 'medewerker')).status).toBe(403);
    const antwoord = await haal('/api/auditlog/integriteit', 'dossierbeheerder');
    expect(antwoord.status).toBe(200);
    expect(await antwoord.json()).toMatchObject({ intact: true });
  });
});

describe('contract en betekenis', () => {
  it('publiceert zijn eigen OpenAPI-contract', async () => {
    const antwoord = await fetch(`${basis}/api/openapi.yaml`);
    expect(antwoord.status).toBe(200);
    expect(antwoord.headers.get('content-type')).toContain('yaml');
    const tekst = await antwoord.text();
    expect(tekst.startsWith('openapi: 3.1.0')).toBe(true);
    // Elk endpoint uit de app staat in het contract.
    for (const pad of ['/api/aanmelden', '/api/afmelden', '/api/classificaties', '/api/documenten', '/api/documenten/{id}', '/api/documenten/{id}/bestand', '/api/documenten/{id}/nazicht', '/api/nazicht', '/api/auditlog', '/api/auditlog/integriteit', '/api/beleid']) {
      expect(tekst).toContain(`  ${pad}:`);
    }
  });

  it('geeft de betekenis van de documentvelden als JSON-LD-context, en verwijst ernaar', async () => {
    const context = await fetch(`${basis}/api/context.jsonld`);
    expect(context.headers.get('content-type')).toContain('application/ld+json');
    const c = (await context.json())['@context'] as Record<string, unknown>;
    expect(c.titel).toBe('dct:title');
    expect(c.classificatie).toBe('dct:accessRights');

    const aangeboden = await stuur('medewerker', 'Een gewone brochure over de openingsuren.');
    const { documentId } = await aangeboden.json();
    const document = await (await haal(`/api/documenten/${documentId}`, 'dossierbeheerder')).json();
    expect(document['@context']).toBe('/api/context.jsonld');
    // Elk veld van het document heeft een betekenis in de context.
    for (const veld of Object.keys(document)) {
      if (veld === '@context') continue;
      expect(c, `veld ${veld} ontbreekt in de context`).toHaveProperty(veld);
    }
  });
});

describe('grenzen en storingen op het bestand', () => {
  it('weigert een bestand groter dan 10 MB met 413, afgekapt tijdens het uploaden', async () => {
    const antwoord = await stuur('medewerker', 'x'.repeat(10 * 1024 * 1024 + 1));
    expect(antwoord.status).toBe(413);
    expect((await antwoord.json()).fout).toBe('bestand_te_groot');
  });

  it('geeft 500 zonder technische details als het bestand op schijf ontbreekt', async () => {
    const { documentId } = await (await stuur('medewerker', 'Nota met jan.peeters@voorbeeld.be erin.')).json();
    // Nabootsing van een storing in de opslag: het bestand verdwijnt van de schijf.
    const pad = readdirSync(OPSLAG, { recursive: true })
      .map(String)
      .find((p) => p.includes(documentId));
    expect(pad).toBeDefined();
    unlinkSync(join(OPSLAG, pad as string));

    const antwoord = await haal(`/api/documenten/${documentId}/bestand`, 'dossierbeheerder');
    expect(antwoord.status).toBe(500);
    const data = await antwoord.json();
    expect(data.fout).toBe('bestand_niet_beschikbaar');
    expect(JSON.stringify(data)).not.toContain('opslag-test-api');
  });
});

describe('beveiliging van de identiteit', () => {
  it('negeert een zelfgekozen rol in een header', async () => {
    const antwoord = await fetch(`${basis}/api/auditlog`, {
      headers: { 'X-Rol': 'dossierbeheerder' },
    });
    expect(antwoord.status).toBe(403);
  });

  it('weigert een token waarvan de rol werd aangepast met 401', async () => {
    const [kopdeel, inhoud, handtekening] = (tokens.medewerker as string).split('.');
    const gegevens = JSON.parse(Buffer.from(inhoud, 'base64url').toString('utf8'));
    gegevens.rol = 'dossierbeheerder';
    const vervalst = Buffer.from(JSON.stringify(gegevens)).toString('base64url');

    const antwoord = await fetch(`${basis}/api/auditlog`, {
      headers: { Authorization: `Bearer ${kopdeel}.${vervalst}.${handtekening}` },
    });
    expect(antwoord.status).toBe(401);
    expect((await antwoord.json()).fout).toBe('aanmelding_ongeldig');
  });
});

describe('POST /api/classificaties (voorstel bekijken)', () => {
  it('toont het voorstel zonder iets op te slaan', async () => {
    const formulier = new FormData();
    formulier.append('bestand', new Blob(['In bijlage het medisch verslag met de diagnose.'], { type: 'text/plain' }), 'nota.txt');
    const antwoord = await fetch(`${basis}/api/classificaties`, {
      method: 'POST',
      headers: kop('medewerker'),
      body: formulier,
    });
    expect(antwoord.status).toBe(200);
    const data = await antwoord.json();
    expect(data.classificatie).toBe('gevoelige_persoonsgegevens');
    expect(data.opslagmap).toBe('gevoelig');
    expect(data).not.toHaveProperty('documentId');
  });

  it('weigert ook het voorstel aan wie niet aangemeld is', async () => {
    const formulier = new FormData();
    formulier.append('bestand', new Blob(['Een gewone brochure.'], { type: 'text/plain' }), 'nota.txt');
    const antwoord = await fetch(`${basis}/api/classificaties`, { method: 'POST', body: formulier });
    expect(antwoord.status).toBe(403);
  });
});

describe('POST /api/documenten', () => {
  it('weigert een burger (niet aangemeld) met 403', async () => {
    const antwoord = await stuur('burger', 'Een gewone brochure over de openingsuren.');
    expect(antwoord.status).toBe(403);
    expect((await antwoord.json()).fout).toBe('geen_rechten');
  });

  metModel('aanvaardt een document van een medewerker met 201 en een classificatie', async () => {
    const antwoord = await stuur('medewerker', 'Een gewone brochure over de openingsuren.');
    expect(antwoord.status).toBe(201);
    const data = await antwoord.json();
    expect(data.classificatie).toBe('publiek');
    expect(data.documentId).toBeTypeOf('string');
  });

  it('geeft 400 als er geen bestand meegestuurd wordt', async () => {
    const antwoord = await fetch(`${basis}/api/documenten`, {
      method: 'POST',
      headers: kop('medewerker'),
      body: new FormData(),
    });
    expect(antwoord.status).toBe(400);
    expect((await antwoord.json()).fout).toBe('geen_bestand');
  });

  it('geeft 422 met een begrijpelijke boodschap bij een verboden bestandstype', async () => {
    const antwoord = await stuur('medewerker', 'inhoud', 'virus.exe', 'application/x-msdownload');
    expect(antwoord.status).toBe(422);
    const data = await antwoord.json();
    expect(data.fout).toBe('bestandstype_niet_toegestaan');
    expect(data.boodschap).toContain('.txt');
  });
});

describe('GET /api/documenten/:id', () => {
  it('houdt een medewerker weg van gevoelige gegevens, maar niet een dossierbeheerder', async () => {
    const aangeboden = await stuur(
      'medewerker',
      'In bijlage het medisch verslag met de diagnose van de betrokkene.',
    );
    const { documentId } = await aangeboden.json();

    const medewerker = await haal(`/api/documenten/${documentId}`, 'medewerker');
    expect(medewerker.status).toBe(403);

    const beheerder = await haal(`/api/documenten/${documentId}`, 'dossierbeheerder');
    expect(beheerder.status).toBe(200);
    expect((await beheerder.json()).classificatie).toBe('gevoelige_persoonsgegevens');
  });

  it('geeft het interne opslagpad nooit prijs', async () => {
    const aangeboden = await stuur('medewerker', 'Een gewone brochure over de openingsuren.');
    const { documentId } = await aangeboden.json();
    const antwoord = await haal(`/api/documenten/${documentId}`, 'dossierbeheerder');
    const data = await antwoord.json();
    expect(data).not.toHaveProperty('opslagpad');
    expect(JSON.stringify(data)).not.toContain('opslag-test-api');
  });

  it('geeft 404 voor een onbekend document', async () => {
    const antwoord = await haal('/api/documenten/bestaat-niet', 'dossierbeheerder');
    expect(antwoord.status).toBe(404);
  });
});

describe('GET /api/auditlog', () => {
  it('is in zijn geheel enkel toegankelijk voor een dossierbeheerder, en legt elke inzage vast', async () => {
    expect((await haal('/api/auditlog', 'medewerker')).status).toBe(403);

    const antwoord = await haal('/api/auditlog', 'dossierbeheerder');
    expect(antwoord.status).toBe(200);
    const regels = (await antwoord.json()) as { handeling: string }[];
    expect(regels[0].handeling).toBe('auditlog_geraadpleegd');
    expect(regels.some((r) => r.handeling === 'toegang_geweigerd')).toBe(true);
    expect(regels.some((r) => r.handeling === 'aanmelding_mislukt')).toBe(true);
  });

  metModel('laat een medewerker de beslissing over zijn eigen document terugvinden', async () => {
    const aangeboden = await stuur('medewerker', 'Vragen aan jan.peeters@voorbeeld.be richten.');
    const { documentId } = await aangeboden.json();

    const antwoord = await haal(`/api/auditlog?documentId=${documentId}`, 'medewerker');
    expect(antwoord.status).toBe(200);
    const spoor = (await antwoord.json()) as { handeling: string; classificatie: string | null }[];
    expect(spoor.map((r) => r.handeling)).toEqual([
      'geclassificeerd',
      'opgeslagen',
      'auditlog_geraadpleegd',
    ]);
    expect(spoor[0].classificatie).toBe('persoonsgegevens');
  });

  metModel('weigert een medewerker het spoor van andermans document, en legt die poging vast', async () => {
    // Aangeboden door de dossierbeheerder, dus niet door j.peeters.
    const aangeboden = await stuur('dossierbeheerder', 'Een gewone brochure over de openingsuren.');
    const { documentId } = await aangeboden.json();

    expect((await haal(`/api/auditlog?documentId=${documentId}`, 'medewerker')).status).toBe(403);

    const antwoord = await haal(`/api/auditlog?documentId=${documentId}`, 'dossierbeheerder');
    const spoor = (await antwoord.json()) as { handeling: string; rol: string; actor: string }[];

    expect(spoor.map((r) => r.handeling)).toEqual([
      'geclassificeerd',
      'opgeslagen',
      'toegang_geweigerd',
      'auditlog_geraadpleegd',
    ]);
    expect(spoor[2].actor).toBe('j.peeters');
    expect(spoor[3].actor).toBe('m.claes');
  });
});

describe('GET /api/publiek (zonder aanmelding)', () => {
  metModel('toont een burger enkel wat definitief publiek is, en laat dat bestand ook lezen', async () => {
    const publiek = await (await stuur('medewerker', 'Openingsuren van de bibliotheek tijdens de zomer.')).json();
    const intern = await (await stuur('medewerker', 'Interne nota over de herinrichting.', 'nota.txt', 'text/plain', 'intern')).json();
    expect(publiek.classificatie).toBe('publiek');

    const lijst = await (await haal('/api/publiek', 'burger')).json();
    const ids = lijst.map((d: { id: string }) => d.id);
    expect(ids).toContain(publiek.documentId);
    expect(ids).not.toContain(intern.documentId);
    expect(JSON.stringify(lijst)).not.toContain('opslagpad');

    expect((await haal(`/api/documenten/${publiek.documentId}/bestand`, 'burger')).status).toBe(200);
    expect((await haal(`/api/documenten/${intern.documentId}/bestand`, 'burger')).status).toBe(403);
  });
});
