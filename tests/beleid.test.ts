import { describe, it, expect } from 'vitest';
import {
  BELEID,
  beleidVoor,
  magInkijken,
  vervaldatum,
} from '../src/beleid/beleid.js';
import { CLASSIFICATIES } from '../src/domein/types.js';

describe('opslagbeleid', () => {
  it('heeft voor elke classificatie een regel', () => {
    for (const classificatie of CLASSIFICATIES) {
      expect(BELEID[classificatie]).toBeDefined();
    }
  });

  it('maakt enkel publieke documenten publiek toegankelijk', () => {
    for (const classificatie of CLASSIFICATIES) {
      const publiek = beleidVoor(classificatie).publiekToegankelijk;
      expect(publiek).toBe(classificatie === 'publiek');
    }
  });

  it('bewaart gevoeliger documenten niet langer dan minder gevoelige', () => {
    const termijnen = CLASSIFICATIES.map((c) => beleidVoor(c).bewaartermijnDagen);
    const aflopend = [...termijnen].sort((a, b) => b - a);
    expect(termijnen).toEqual(aflopend);
  });

  it('geeft een burger geen toegang tot persoonsgegevens', () => {
    expect(magInkijken('burger', 'persoonsgegevens')).toBe(false);
    expect(magInkijken('burger', 'gevoelige_persoonsgegevens')).toBe(false);
    expect(magInkijken('burger', 'publiek')).toBe(true);
  });

  it('maakt onderscheid tussen beperkte en minimale toegang', () => {
    expect(magInkijken('medewerker', 'intern')).toBe(true);
    // Beperkt: wie voor het bestuur werkt, wel; de burger niet.
    expect(magInkijken('medewerker', 'persoonsgegevens')).toBe(true);
    // Minimaal: enkel de dossierbeheerder.
    expect(magInkijken('medewerker', 'gevoelige_persoonsgegevens')).toBe(false);
    expect(magInkijken('dossierbeheerder', 'gevoelige_persoonsgegevens')).toBe(true);
  });

  it('wordt per niveau strenger: elk hoger niveau laat hoogstens dezelfde rollen toe', () => {
    for (let i = 1; i < CLASSIFICATIES.length; i++) {
      const lager = beleidVoor(CLASSIFICATIES[i - 1]).toegang;
      const hoger = beleidVoor(CLASSIFICATIES[i]).toegang;
      expect(lager).toEqual(expect.arrayContaining(hoger));
    }
  });

  it('berekent de vervaldatum op basis van de bewaartermijn', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const eind = vervaldatum('gevoelige_persoonsgegevens', start);
    const dagen = Math.round((eind.getTime() - start.getTime()) / 86_400_000);
    expect(dagen).toBe(beleidVoor('gevoelige_persoonsgegevens').bewaartermijnDagen);
  });
});
