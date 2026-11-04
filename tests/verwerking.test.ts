import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { maakDatabase, type Db } from '../src/opslag/database.js';
import { maakVoorstel, verwerkDocument } from '../src/verwerking/verwerkDocument.js';
import { Auditlog } from '../src/audit/auditlog.js';
import { veiligeBestandsnaam } from '../src/opslag/bestandsopslag.js';
import { stopOcr } from '../src/classificatie/ocr.js';
import { MODELBESTAND } from '../src/classificatie/ner.js';

/** Tests die het echte taalmodel nodig hebben, slaan zichzelf over zolang `npm run model` niet gedraaid is. */
const metModel = it.skipIf(!existsSync(MODELBESTAND));
import type { Documentmetadata } from '../src/domein/types.js';

// Een eigen opslagmap, zodat de tests nooit de documenten van de draaiende app wissen.
const OPSLAG = './opslag-test-verwerking';

let db: Db;

const metadata: Documentmetadata = {
  titel: 'Test',
  bron: 'loket',
  beoogdeZichtbaarheid: 'publiek',
};

function bied(inhoud: string | Buffer, naam = 'nota.txt', mimetype = 'text/plain') {
  return verwerkDocument(
    db,
    {
      inhoud: typeof inhoud === 'string' ? Buffer.from(inhoud, 'utf8') : inhoud,
      bestandsnaam: naam,
      mimetype,
      metadata,
      actor: 'testgebruiker',
      rol: 'medewerker',
    },
    OPSLAG,
  );
}

beforeEach(() => {
  db = maakDatabase(':memory:');
});

afterAll(async () => {
  await stopOcr();
  if (existsSync(OPSLAG)) rmSync(OPSLAG, { recursive: true, force: true });
});

describe('verwerking van een aangeboden document', () => {
  metModel('slaat een publiek document op in de publieke map', async () => {
    const r = await bied('Brochure over de openingsuren van het gemeentehuis.');
    expect(r.uitkomst).toBe('opgeslagen');
    if (r.uitkomst !== 'opgeslagen') return;
    expect(r.opslagmap).toBe('publiek');
    expect(r.status).toBe('definitief_opgeslagen');
  });

  it('stuurt een document met een rijksregisternummer naar de beveiligde map', async () => {
    const basis = 860814123;
    const controle = String(97 - (basis % 97)).padStart(2, '0');
    const r = await bied(`Aanvraag van betrokkene met nummer 86.08.14-123.${controle} in bijlage.`);
    if (r.uitkomst !== 'opgeslagen') throw new Error('verwacht opgeslagen');
    expect(r.classificatie.classificatie).toBe('persoonsgegevens');
    expect(r.opslagmap).toBe('persoonsgegevens');
    expect(r.toegang).toEqual(['medewerker', 'dossierbeheerder']);
  });

  it('plaatst een onleesbaar document in nazicht in plaats van het publiek te maken', async () => {
    const r = await bied('  ');
    if (r.uitkomst !== 'opgeslagen') throw new Error('verwacht opgeslagen');
    expect(r.classificatie.classificatie).toBe('gevoelige_persoonsgegevens');
    expect(r.status).toBe('in_nazicht');
    expect(r.opslagmap).not.toBe('publiek');
  });

  it('maakt een PDF nooit publiek, ook niet als de aanbieder dat voorstelt', async () => {
    const r = await bied(
      '%PDF-1.7 stream x\u009cËí binaire inhoud zonder leesbare signalen',
      'scan.pdf',
      'application/pdf',
    );
    if (r.uitkomst !== 'opgeslagen') throw new Error('verwacht opgeslagen');
    expect(r.classificatie.classificatie).toBe('gevoelige_persoonsgegevens');
    expect(r.classificatie.zekerheid).toBe('onzeker');
    expect(r.status).toBe('in_nazicht');
  });

  it('leest een gescand medisch attest met tekstherkenning en herkent het als gevoelig', async () => {
    const scan = readFileSync('voorbeelddocumenten/07-gescand-medisch-attest.png');
    const r = await bied(scan, '07-gescand-medisch-attest.png', 'image/png');
    if (r.uitkomst !== 'opgeslagen') throw new Error('verwacht opgeslagen');
    expect(r.classificatie.classificatie).toBe('gevoelige_persoonsgegevens');
    expect(r.classificatie.signalen.map((s) => s.type)).toContain('trefwoord_medisch');
    expect(r.classificatie.motivering).toContain('tekstherkenning');
  }, 30_000);

  it('maakt een gescande brochure nooit publiek, ook niet als de aanbieder dat voorstelt', async () => {
    const scan = readFileSync('voorbeelddocumenten/08-gescande-brochure.png');
    const r = await bied(scan, '08-gescande-brochure.png', 'image/png');
    if (r.uitkomst !== 'opgeslagen') throw new Error('verwacht opgeslagen');
    expect(r.classificatie.classificatie).toBe('intern');
    expect(r.status).toBe('in_nazicht');
  }, 30_000);

  it('maakt een voorstel zonder iets op te slaan of te registreren', async () => {
    const v = await maakVoorstel({
      inhoud: Buffer.from('Vragen aan jan.peeters@voorbeeld.be richten alstublieft.'),
      bestandsnaam: 'nota.txt',
      mimetype: 'text/plain',
      metadata,
    });
    if (v.uitkomst !== 'voorstel') throw new Error('verwacht een voorstel');
    expect(v.classificatie.classificatie).toBe('persoonsgegevens');
    expect(v.regel.opslagmap).toBe('persoonsgegevens');
    expect(db.prepare('SELECT COUNT(*) AS n FROM documenten').get()).toEqual({ n: 0 });
    expect(new Auditlog(db).recent()).toHaveLength(0);
  });

  metModel('laat geen bestand en geen auditspoor achter als registreren mislukt', async () => {
    await bied('Nota over de werking van de dienst burgerzaken, zonder bijzonderheden.');
    const map = join(OPSLAG, 'publiek');
    const bestandenVoor = readdirSync(map).length;
    const regelsVoor = (new Auditlog(db).recent(1000) as unknown[]).length;

    // De documententabel onbruikbaar maken, zodat registreren faalt.
    db.exec('DROP TABLE documenten');

    await expect(
      bied('Nog een nota over de werking van de dienst, zonder bijzonderheden.'),
    ).rejects.toThrow();
    expect(readdirSync(map).length).toBe(bestandenVoor);
    const regels = new Auditlog(db).recent(1000) as { handeling: string }[];
    // Enkel 'document_aangeboden' komt erbij; classificatie en opslag niet.
    expect(regels.length).toBe(regelsVoor + 1);
    expect(regels[0].handeling).toBe('document_aangeboden');
  });

  it('weigert een bestandstype dat niet op de witte lijst staat', async () => {
    const r = await bied('inhoud die lang genoeg is om te classificeren', 'virus.exe', 'application/x-msdownload');
    expect(r.uitkomst).toBe('geweigerd');
    if (r.uitkomst !== 'geweigerd') return;
    expect(r.fout.code).toBe('bestandstype_niet_toegestaan');
    expect(r.fout.boodschap).toContain('.txt');
  });

  metModel('legt elke stap vast in het auditlog', async () => {
    const r = await bied('Nota over de werking van de dienst burgerzaken, zonder bijzonderheden.');
    if (r.uitkomst !== 'opgeslagen') throw new Error('verwacht opgeslagen');
    const spoor = new Auditlog(db).voorDocument(r.documentId) as { handeling: string }[];
    expect(spoor.map((s) => s.handeling)).toEqual(['geclassificeerd', 'opgeslagen']);
  });

  it('schrijft geen persoonsgegevens in het auditlog', async () => {
    const r = await bied('Vragen aan jan.peeters@voorbeeld.be richten alstublieft.');
    if (r.uitkomst !== 'opgeslagen') throw new Error('verwacht opgeslagen');
    const spoor = JSON.stringify(new Auditlog(db).voorDocument(r.documentId));
    expect(spoor).not.toContain('jan.peeters@voorbeeld.be');
  });

  it('logt ook een geweigerd bestand, zonder het op te slaan', async () => {
    await bied('inhoud die lang genoeg is om te classificeren', 'virus.exe', 'application/x-msdownload');
    const regels = new Auditlog(db).recent() as { handeling: string; uitkomst: string }[];
    const weigering = regels.find((r) => r.handeling === 'validatie_geweigerd');
    expect(weigering?.uitkomst).toBe('geweigerd');
  });
});

describe('het auditlog is append-only', () => {
  it('weigert een wijziging van een bestaande regel', async () => {
    await bied('Nota over de werking van de dienst burgerzaken, zonder bijzonderheden.');
    expect(() => db.prepare("UPDATE auditlog SET actor = 'iemand anders'").run()).toThrow(
      /append-only/,
    );
  });

  it('weigert het verwijderen van een regel', async () => {
    await bied('Nota over de werking van de dienst burgerzaken, zonder bijzonderheden.');
    expect(() => db.prepare('DELETE FROM auditlog').run()).toThrow(/append-only/);
  });
});

describe('bestandsnamen', () => {
  it('haalt padverwijzingen uit een aangeleverde naam', () => {
    expect(veiligeBestandsnaam('../../etc/passwd')).toBe('passwd');
    expect(veiligeBestandsnaam('C:\\Users\\test\\nota.txt')).toBe('nota.txt');
  });
});
