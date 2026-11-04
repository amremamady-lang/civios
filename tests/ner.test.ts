/**
 * Tests op de naamherkenning met het taalmodel.
 *
 * De eerste groep test de logica zonder model (samenvoegen van stukjes,
 * omzetten naar signalen, veilig gedrag bij een fout). De tweede groep
 * gebruikt het echte, lokaal geïnstalleerde model.
 */

import { describe, it, expect } from 'vitest';
import {
  voegSamen,
  entiteitenNaarSignalen,
  zoekMetNer,
  zoekMetNerVeilig,
  herkenEntiteiten,
} from '../src/classificatie/ner.js';

describe('stukjes samenvoegen', () => {
  it('voegt stukjes van één naam samen tot één entiteit', () => {
    const entiteiten = voegSamen([
      { entity: 'B-PER', score: 0.99, index: 1, word: 'Jan' },
      { entity: 'I-PER', score: 0.98, index: 2, word: 'Pe' },
      { entity: 'I-PER', score: 0.97, index: 3, word: '##eters' },
    ]);
    expect(entiteiten).toEqual([{ soort: 'PER', tekst: 'Jan Peeters', score: expect.closeTo(0.98, 2) }]);
  });

  it('houdt twee namen uit elkaar', () => {
    const entiteiten = voegSamen([
      { entity: 'B-PER', score: 0.99, index: 1, word: 'Jan' },
      { entity: 'B-PER', score: 0.99, index: 3, word: 'An' },
    ]);
    expect(entiteiten.map((e) => e.tekst)).toEqual(['Jan', 'An']);
  });
});

describe('entiteiten naar signalen', () => {
  it('maakt van een persoon een gemaskeerd naamsignaal', () => {
    const signalen = entiteitenNaarSignalen('Jan Peeters belde.', [
      { soort: 'PER', tekst: 'Jan Peeters', score: 1 },
    ]);
    expect(signalen).toHaveLength(1);
    expect(signalen[0].type).toBe('naam');
    expect(signalen[0].bewijs).not.toContain('Peeters');
  });

  it('maakt van een plaats enkel een adres als er een huisnummer achter staat', () => {
    const metNummer = entiteitenNaarSignalen('Hij woont op de Kouter 5 in Gent.', [
      { soort: 'LOC', tekst: 'Kouter', score: 1 },
      { soort: 'LOC', tekst: 'Gent', score: 1 },
    ]);
    expect(metNummer.map((s) => s.type)).toEqual(['adres']);
    expect(metNummer[0].aantal).toBe(1);

    const zonder = entiteitenNaarSignalen('We reden naar Brussel.', [
      { soort: 'LOC', tekst: 'Brussel', score: 1 },
    ]);
    expect(zonder).toEqual([]);

    const eigen = entiteitenNaarSignalen('Welkom op Gemeenteplein 1.', [
      { soort: 'LOC', tekst: 'Gemeenteplein', score: 1 },
    ]);
    expect(eigen).toEqual([]);
  });
});

describe('veilig gedrag', () => {
  it('meldt dat de herkenning niet lukte, zonder de verwerking te stoppen', async () => {
    const faalt = async (): Promise<never> => {
      throw new Error('model niet geladen');
    };
    expect(await zoekMetNerVeilig('Jan Peeters belde.', faalt)).toEqual({ signalen: [], gelukt: false });
  });

  it('roept het model niet aan voor lege tekst', async () => {
    const faalt = async (): Promise<never> => {
      throw new Error('mag niet aangeroepen worden');
    };
    expect(await zoekMetNerVeilig('   ', faalt)).toEqual({ signalen: [], gelukt: true });
  });
});

describe('het echte taalmodel (lokaal)', () => {
  it('herkent een naam zonder aanspreking', async () => {
    const signalen = await zoekMetNer('Jan Peeters belde gisteren over zijn dossier.');
    expect(signalen.map((s) => s.type)).toContain('naam');
  }, 60_000);

  it('herkent een adres met een straatnaam zonder vast achtervoegsel', async () => {
    const signalen = await zoekMetNer('An Van der Berg woont op de Kouter 5 in Gent.');
    expect(signalen.map((s) => s.type)).toEqual(expect.arrayContaining(['naam', 'adres']));
  }, 60_000);

  it('ziet een instelling, een feestdag of een functie niet als persoon', async () => {
    const entiteiten = await herkenEntiteiten(
      'Het Gemeentehuis is gesloten op Kerstdag. Mevrouw de burgemeester opent de zitting.',
    );
    expect(entiteiten.filter((e) => e.soort === 'PER')).toEqual([]);
  }, 60_000);
});
