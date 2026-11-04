import { describe, it, expect } from 'vitest';
import {
  bepaalIdentiteit,
  beoordeelToegang,
  magAanbieden,
  ANONIEM,
} from '../src/autorisatie/autorisatie.js';
import { maakToken, verifieerToken, GELDIGHEID_SECONDEN } from '../src/autorisatie/token.js';
import { controleerAanmelding } from '../src/autorisatie/aanmelding.js';

const GEHEIM = 'testgeheim-dat-enkel-in-de-tests-gebruikt-wordt';

describe('tokens', () => {
  it('aanvaardt een token dat de server zelf ondertekende', () => {
    const token = maakToken('j.peeters', 'medewerker', GEHEIM);
    const inhoud = verifieerToken(token, GEHEIM);
    expect(inhoud?.sub).toBe('j.peeters');
    expect(inhoud?.rol).toBe('medewerker');
  });

  it('weigert een token waarvan iemand de rol heeft aangepast', () => {
    const [kop, inhoud, handtekening] = maakToken('j.peeters', 'medewerker', GEHEIM).split('.');
    const gegevens = JSON.parse(Buffer.from(inhoud, 'base64url').toString('utf8'));
    gegevens.rol = 'dossierbeheerder';
    const vervalst = Buffer.from(JSON.stringify(gegevens)).toString('base64url');
    expect(verifieerToken(`${kop}.${vervalst}.${handtekening}`, GEHEIM)).toBeNull();
  });

  it('weigert een token ondertekend met een ander geheim', () => {
    const token = maakToken('j.peeters', 'dossierbeheerder', 'geheim-van-een-aanvaller');
    expect(verifieerToken(token, GEHEIM)).toBeNull();
  });

  it('weigert een verlopen token', () => {
    const toen = Date.now();
    const token = maakToken('j.peeters', 'medewerker', GEHEIM, toen);
    const later = toen + (GELDIGHEID_SECONDEN + 1) * 1000;
    expect(verifieerToken(token, GEHEIM, later)).toBeNull();
  });

  it('weigert onzin', () => {
    expect(verifieerToken('geen-token', GEHEIM)).toBeNull();
    expect(verifieerToken('a.b.c', GEHEIM)).toBeNull();
  });
});

describe('aanmelden', () => {
  it('geeft de rol terug bij een juist wachtwoord', () => {
    expect(controleerAanmelding('j.peeters', 'Demo-medewerker-2026')).toBe('medewerker');
    expect(controleerAanmelding('m.claes', 'Demo-beheerder-2026')).toBe('dossierbeheerder');
  });

  it('weigert een fout wachtwoord en een onbekende gebruiker', () => {
    expect(controleerAanmelding('j.peeters', 'fout')).toBeNull();
    expect(controleerAanmelding('bestaat.niet', 'Demo-medewerker-2026')).toBeNull();
  });
});

describe('identiteit bepalen', () => {
  it('maakt van een verzoek zonder token een anonieme burger', () => {
    expect(bepaalIdentiteit(undefined, GEHEIM)).toEqual(ANONIEM);
    expect(ANONIEM.rol).toBe('burger');
  });

  it('haalt gebruiker en rol uit een geldig token', () => {
    const token = maakToken('m.claes', 'dossierbeheerder', GEHEIM);
    expect(bepaalIdentiteit(`Bearer ${token}`, GEHEIM)).toMatchObject({
      gebruiker: 'm.claes',
      rol: 'dossierbeheerder',
    });
  });

  it('meldt een ongeldig token in plaats van stil verder te gaan', () => {
    expect(bepaalIdentiteit('Bearer vervalst.token.xyz', GEHEIM)).toBe('ongeldig');
    expect(bepaalIdentiteit('dossierbeheerder', GEHEIM)).toBe('ongeldig');
  });
});

describe('toegang beoordelen', () => {
  it('houdt een burger weg bij gevoelige documenten', () => {
    expect(beoordeelToegang('burger', 'gevoelige_persoonsgegevens').toegestaan).toBe(false);
  });

  it('laat een dossierbeheerder bij gevoelige documenten', () => {
    expect(beoordeelToegang('dossierbeheerder', 'gevoelige_persoonsgegevens').toegestaan).toBe(true);
  });

  it('geeft altijd een reden terug, ook bij weigering', () => {
    expect(beoordeelToegang('burger', 'intern').reden).toContain('geen toegang');
  });
});

describe('aanbieden', () => {
  it('staat enkel toe aan wie voor het bestuur werkt', () => {
    expect(magAanbieden('medewerker')).toBe(true);
    expect(magAanbieden('dossierbeheerder')).toBe(true);
    expect(magAanbieden('burger')).toBe(false);
  });
});
