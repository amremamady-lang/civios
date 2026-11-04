/**
 * Nazicht afhandelen, opruiming na de bewaartermijn en de hash-ketting van het
 * auditlog: drie stappen in de levensloop van een document ná het opslaan.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { maakDatabase, type Db } from '../src/opslag/database.js';
import { verwerkDocument } from '../src/verwerking/verwerkDocument.js';
import { handelNazichtAf } from '../src/verwerking/nazicht.js';
import { verwijderVerlopen } from '../src/verwerking/opruiming.js';
import { Auditlog } from '../src/audit/auditlog.js';
import { Documentenregister } from '../src/opslag/documenten.js';
import { stopOcr } from '../src/classificatie/ocr.js';

const OPSLAG = './opslag-test-nazicht';
let db: Db;

beforeEach(() => {
  db = maakDatabase(':memory:');
});

afterAll(async () => {
  await stopOcr();
  if (existsSync(OPSLAG)) rmSync(OPSLAG, { recursive: true, force: true });
});

/** Een onleesbaar document van j.peeters: komt altijd in nazicht terecht. */
async function inNazicht(actor = 'j.peeters') {
  const r = await verwerkDocument(
    db,
    {
      inhoud: Buffer.from('   '),
      bestandsnaam: 'leeg.txt',
      metadata: { titel: 'Onleesbaar', bron: 'scanner', beoogdeZichtbaarheid: 'publiek' },
      actor,
      rol: actor === 'm.claes' ? 'dossierbeheerder' : 'medewerker',
    },
    OPSLAG,
  );
  if (r.uitkomst !== 'opgeslagen') throw new Error('verwacht opgeslagen');
  expect(r.status).toBe('in_nazicht');
  return r.documentId;
}

const beheerder = { actor: 'm.claes', rol: 'dossierbeheerder' as const };

describe('nazicht afhandelen', () => {
  it('bevestigt de classificatie en maakt het document definitief', async () => {
    const id = await inNazicht();
    const r = handelNazichtAf(
      db,
      { documentId: id, beslissing: 'bevestigen', motivering: 'Scan bekeken: medisch attest.', ...beheerder },
      OPSLAG,
    );
    expect(r.uitkomst).toBe('afgehandeld');
    const doc = new Documentenregister(db).haal(id)!;
    expect(doc.status).toBe('definitief_opgeslagen');
    expect(doc.zekerheid).toBe('zeker');
    expect(doc.classificatie).toBe('gevoelige_persoonsgegevens');
  });

  it('herclassificeert, verplaatst het bestand en past toegang en bewaartermijn aan', async () => {
    const id = await inNazicht();
    const voor = new Documentenregister(db).haal(id)!;
    expect(voor.opslagpad).toContain('gevoelig');

    const r = handelNazichtAf(
      db,
      {
        documentId: id,
        beslissing: 'herclassificeren',
        classificatie: 'intern',
        motivering: 'Scan bekeken: interne nota zonder persoonsgegevens.',
        ...beheerder,
      },
      OPSLAG,
    );
    expect(r.uitkomst).toBe('afgehandeld');

    const na = new Documentenregister(db).haal(id)!;
    expect(na.classificatie).toBe('intern');
    expect(na.opslagpad).toContain('intern');
    expect(existsSync(na.opslagpad)).toBe(true);
    expect(existsSync(voor.opslagpad)).toBe(false);
    expect(JSON.parse(na.toegang)).toEqual(['medewerker', 'dossierbeheerder']);
    expect(na.bewaren_tot > voor.bewaren_tot).toBe(true); // intern wordt langer bewaard

    const spoor = new Auditlog(db).voorDocument(id) as { handeling: string; motivering: string }[];
    const laatste = spoor[spoor.length - 1];
    expect(laatste.handeling).toBe('nazicht_afgehandeld');
    expect(laatste.motivering).toContain("van 'gevoelige_persoonsgegevens' naar 'intern'");
    expect(laatste.motivering).toContain('interne nota');
  });

  it('weigert zonder voldoende motivering', async () => {
    const id = await inNazicht();
    const r = handelNazichtAf(db, { documentId: id, beslissing: 'bevestigen', motivering: 'ok', ...beheerder }, OPSLAG);
    expect(r.uitkomst === 'geweigerd' && r.fout.code).toBe('motivering_ontbreekt');
  });

  it('weigert een medewerker, ook met een goede motivering', async () => {
    const id = await inNazicht();
    const r = handelNazichtAf(
      db,
      { documentId: id, beslissing: 'bevestigen', motivering: 'Ik vind het goed zo.', actor: 'a.janssens', rol: 'medewerker' },
      OPSLAG,
    );
    expect(r.uitkomst === 'geweigerd' && r.fout.code).toBe('geen_rechten');
    expect(new Documentenregister(db).haal(id)!.status).toBe('in_nazicht');
  });

  it('weigert dat de aanbieder zijn eigen document afhandelt (vier ogen)', async () => {
    const id = await inNazicht('m.claes');
    const r = handelNazichtAf(
      db,
      { documentId: id, beslissing: 'bevestigen', motivering: 'Mijn eigen scan, is in orde.', ...beheerder },
      OPSLAG,
    );
    expect(r.uitkomst === 'geweigerd' && r.fout.code).toBe('vier_ogen');
  });

  it('weigert een document dat niet in nazicht staat, en een onbekende classificatie', async () => {
    const id = await inNazicht();
    handelNazichtAf(db, { documentId: id, beslissing: 'bevestigen', motivering: 'Eerste keer bekeken.', ...beheerder }, OPSLAG);
    const tweede = handelNazichtAf(db, { documentId: id, beslissing: 'bevestigen', motivering: 'Nog een keer.', ...beheerder }, OPSLAG);
    expect(tweede.uitkomst === 'geweigerd' && tweede.fout.code).toBe('niet_in_nazicht');

    const ander = await inNazicht();
    const fout = handelNazichtAf(
      db,
      { documentId: ander, beslissing: 'herclassificeren', classificatie: 'geheim', motivering: 'Bestaat niet.', ...beheerder },
      OPSLAG,
    );
    expect(fout.uitkomst === 'geweigerd' && fout.fout.code).toBe('classificatie_ongeldig');
  });

  it('logt elke geweigerde poging', async () => {
    const id = await inNazicht();
    handelNazichtAf(db, { documentId: id, beslissing: 'bevestigen', motivering: 'x', ...beheerder }, OPSLAG);
    const spoor = new Auditlog(db).voorDocument(id) as { handeling: string; uitkomst: string }[];
    expect(spoor[spoor.length - 1]).toMatchObject({ handeling: 'toegang_geweigerd', uitkomst: 'geweigerd' });
  });
});

describe('opruiming na de bewaartermijn', () => {
  it('verwijdert bestand en fiche van een verlopen document, maar niet het auditspoor', async () => {
    const id = await inNazicht();
    const register = new Documentenregister(db);
    const pad = register.haal(id)!.opslagpad;
    db.prepare("UPDATE documenten SET bewaren_tot = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(id);

    const rapport = verwijderVerlopen(db, OPSLAG);
    expect(rapport).toEqual({ verwijderd: 1, mislukt: 0 });
    expect(register.haal(id)).toBeUndefined();
    expect(existsSync(pad)).toBe(false);

    const spoor = new Auditlog(db).voorDocument(id) as { handeling: string; rol: string }[];
    expect(spoor.map((r) => r.handeling)).toContain('geclassificeerd');
    expect(spoor[spoor.length - 1]).toMatchObject({ handeling: 'verwijderd_na_bewaartermijn', rol: 'systeem' });
  });

  it('laat documenten binnen hun bewaartermijn met rust, en is herhaalbaar', async () => {
    const id = await inNazicht();
    expect(verwijderVerlopen(db, OPSLAG)).toEqual({ verwijderd: 0, mislukt: 0 });
    expect(verwijderVerlopen(db, OPSLAG)).toEqual({ verwijderd: 0, mislukt: 0 });
    expect(new Documentenregister(db).haal(id)).toBeDefined();
  });
});

describe('hash-ketting van het auditlog', () => {
  it('is intact na gewone verwerking', async () => {
    await inNazicht();
    await inNazicht();
    const rapport = new Auditlog(db).controleerIntegriteit();
    expect(rapport.intact).toBe(true);
    expect(rapport.aantalRegels).toBeGreaterThan(4);
  });

  it('wijst de eerste gemanipuleerde regel aan, ook als een beheerder de triggers omzeilt', async () => {
    await inNazicht();
    db.exec('DROP TRIGGER auditlog_geen_wijziging');
    db.prepare("UPDATE auditlog SET actor = 'iemand_anders' WHERE id = 2").run();
    const rapport = new Auditlog(db).controleerIntegriteit();
    expect(rapport.intact).toBe(false);
    expect(rapport.eersteBreuk).toBe(2);
  });

  it('merkt een gewiste regel op', async () => {
    await inNazicht();
    db.exec('DROP TRIGGER auditlog_geen_verwijdering');
    db.prepare('DELETE FROM auditlog WHERE id = 2').run();
    expect(new Auditlog(db).controleerIntegriteit().intact).toBe(false);
  });
});
