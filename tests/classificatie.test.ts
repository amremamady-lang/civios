import { describe, it, expect } from 'vitest';
import {
  classificeer,
  classificeerVeilig,
  VEILIGE_TERUGVAL,
} from '../src/classificatie/classificeer.js';
import {
  isGeldigRijksregisternummer,
  isGeldigIban,
  zoekAdressen,
  isEigenAdres,
  zoekAlleSignalen,
} from '../src/classificatie/signalen.js';
import { leesTekst, MINIMALE_OCR_BETROUWBAARHEID } from '../src/classificatie/tekstextractie.js';
import { metTijdslimiet } from '../src/classificatie/ocr.js';
import type { Documentmetadata, Signaal } from '../src/domein/types.js';

const intern: Documentmetadata = {
  titel: 'Testdocument',
  bron: 'loket',
  beoogdeZichtbaarheid: 'intern',
};
const publiek: Documentmetadata = { ...intern, beoogdeZichtbaarheid: 'publiek' };

/* Alle persoonsgegevens in deze tests zijn verzonnen. */

describe('rijksregisternummer', () => {
  it('aanvaardt een nummer met correcte controlegetallen', () => {
    // 86.08.14-123-?? -> controle berekend als 97 - (860814123 % 97)
    const basis = 860814123;
    const controle = String(97 - (basis % 97)).padStart(2, '0');
    expect(isGeldigRijksregisternummer(`86.08.14-123.${controle}`)).toBe(true);
  });

  it('verwerpt een reeks van elf cijfers met verkeerde controlegetallen', () => {
    expect(isGeldigRijksregisternummer('86.08.14-123.00')).toBe(false);
  });

  it('verwerpt iets dat geen elf cijfers heeft', () => {
    expect(isGeldigRijksregisternummer('1234567')).toBe(false);
  });
});

describe('IBAN', () => {
  it('aanvaardt een geldig Belgisch rekeningnummer', () => {
    expect(isGeldigIban('BE68 5390 0754 7034')).toBe(true);
  });

  it('verwerpt een rekeningnummer met een foute controle', () => {
    expect(isGeldigIban('BE68 5390 0754 7035')).toBe(false);
  });
});

describe('adressen en namen', () => {
  it('herkent een adres met een straatnaam en huisnummer', () => {
    expect(zoekAdressen('Wonende Kerkstraat 12 te Gent.')?.type).toBe('adres');
    expect(zoekAdressen('Op de Frankrijklei 5b.')?.aantal).toBe(1);
    expect(zoekAdressen('Afspraak op de Grote Markt 1.')).not.toBeNull();
  });

  it('ziet gewone zinnen met een getal niet als adres', () => {
    expect(zoekAdressen('We reden 4 uur over de snelweg 4 keer per jaar.')).toBeNull();
    expect(zoekAdressen('Een loopbaan van 3 jaar in de straat.')).toBeNull();
  });

  it('ziet het adres van het bestuur zelf niet als persoonsgegeven', () => {
    expect(isEigenAdres('gemeenteplein  1')).toBe(true);
    expect(zoekAdressen('Het gemeentehuis (Gemeenteplein 1) is gesloten.')).toBeNull();
    // Een ander adres in dezelfde tekst telt wel.
    expect(zoekAdressen('Gemeenteplein 1 ontving een brief van Kerkstraat 12.')?.aantal).toBe(1);
  });

  it('beoordeelt een korte maar leesbare tekst gewoon', () => {
    const r = classificeer('Vergadering om 14u.', intern);
    expect(r.classificatie).toBe('intern');
    expect(r.zekerheid).toBe('zeker');
  });

  it('valt wel terug bij een korte tekst uit een scan', () => {
    const r = classificeer('Verg. 14u', intern, { herkomst: 'ocr' });
    expect(r.classificatie).toBe(VEILIGE_TERUGVAL);
    expect(r.zekerheid).toBe('onzeker');
  });

  it('maskeert het adres in het bewijs', () => {
    const bewijs = zoekAlleSignalen('Hij woont in de Kerkstraat 12.').map((s) => s.bewijs).join(' ');
    expect(bewijs).not.toContain('Kerkstraat 12');
  });

  it('classificeert een document met een adres als persoonsgegevens', () => {
    const r = classificeer('Melding van een bewoner van de Kerkstraat 12 over een defecte lamp.', publiek);
    expect(r.classificatie).toBe('persoonsgegevens');
  });
});

describe('signalen van het taalmodel', () => {
  const naam: Signaal = { type: 'naam', impliceert: 'persoonsgegevens', bewijs: 'J*********s', aantal: 1 };
  const tekst = 'Jan Peeters belde gisteren over zijn aanvraag voor een premie.';

  it('neemt een naam van het taalmodel mee in de classificatie', () => {
    const r = classificeer(tekst, publiek, { extraSignalen: [naam] });
    expect(r.classificatie).toBe('persoonsgegevens');
    expect(r.zekerheid).toBe('zeker');
  });

  it('maakt een document nooit publiek als het taalmodel niet beschikbaar was', () => {
    const r = classificeer('Een nota over de openingsuren tijdens de feestdagen.', publiek, {
      naamherkenning: false,
    });
    expect(r.classificatie).toBe('intern');
    expect(r.zekerheid).toBe('onzeker');
    expect(r.motivering).toContain('naamherkenning');
  });

  it('zet een document in nazicht als het taalmodel niet beschikbaar was', () => {
    const r = classificeer('Mail naar jan.peeters@voorbeeld.be graag.', intern, { naamherkenning: false });
    expect(r.classificatie).toBe('persoonsgegevens');
    expect(r.zekerheid).toBe('onzeker');
  });
});

describe('classificatie', () => {
  it('schaalt een document zonder herkenbare gegevens in volgens de metadata', () => {
    const resultaat = classificeer(
      'Deze brochure beschrijft de openingsuren van het gemeentehuis.',
      publiek,
    );
    expect(resultaat.classificatie).toBe('publiek');
    expect(resultaat.zekerheid).toBe('zeker');
  });

  it('kiest intern wanneer de metadata niet om publicatie vraagt', () => {
    const resultaat = classificeer(
      'Interne nota over de herinrichting van het archief.',
      intern,
    );
    expect(resultaat.classificatie).toBe('intern');
  });

  it('herkent een e-mailadres als persoonsgegeven', () => {
    const resultaat = classificeer(
      'Gelieve te antwoorden aan jan.peeters@voorbeeld.be voor het einde van de maand.',
      intern,
    );
    expect(resultaat.classificatie).toBe('persoonsgegevens');
    expect(resultaat.signalen[0].type).toBe('emailadres');
  });

  it('schaalt een medisch trefwoord op naar gevoelige persoonsgegevens', () => {
    const resultaat = classificeer(
      'In bijlage het medisch verslag met de diagnose van de betrokkene.',
      intern,
    );
    expect(resultaat.classificatie).toBe('gevoelige_persoonsgegevens');
  });

  it('laat bij meerdere signalen de strengste classificatie winnen', () => {
    const resultaat = classificeer(
      'Contact: jan.peeters@voorbeeld.be. Zie het proces-verbaal in bijlage.',
      publiek,
    );
    expect(resultaat.classificatie).toBe('gevoelige_persoonsgegevens');
    expect(resultaat.signalen.length).toBeGreaterThan(1);
  });

  it('negeert de metadata wanneer er persoonsgegevens in de tekst staan', () => {
    const resultaat = classificeer(
      'Openbare brochure. Vragen via dienst@voorbeeld.be graag.',
      publiek,
    );
    expect(resultaat.classificatie).not.toBe('publiek');
  });
});

describe('veilig gedrag bij twijfel en fouten', () => {
  it('valt terug op de strengste classificatie bij te weinig leesbare tekst', () => {
    const resultaat = classificeer('   ', intern);
    expect(resultaat.classificatie).toBe(VEILIGE_TERUGVAL);
    expect(resultaat.zekerheid).toBe('onzeker');
  });

  it('valt terug op de strengste classificatie wanneer de classificatie faalt', () => {
    const stuk = {
      get beoogdeZichtbaarheid(): never {
        throw new Error('classificatiedienst niet bereikbaar');
      },
      titel: 'x',
      bron: 'x',
    } as unknown as Documentmetadata;

    const resultaat = classificeerVeilig(
      'Een voldoende lange tekst zonder bijzondere kenmerken erin.',
      stuk,
    );
    expect(resultaat.classificatie).toBe(VEILIGE_TERUGVAL);
    expect(resultaat.zekerheid).toBe('onzeker');
  });

  it('toont geen technische details van een fout aan de gebruiker', () => {
    const stuk = {
      get beoogdeZichtbaarheid(): never {
        throw new Error('verbinding met 10.0.0.5:8443 geweigerd');
      },
      titel: 'x',
      bron: 'x',
    } as unknown as Documentmetadata;

    const resultaat = classificeerVeilig(
      'Een voldoende lange tekst zonder bijzondere kenmerken erin.',
      stuk,
    );
    expect(resultaat.motivering).not.toContain('10.0.0.5');
  });
});

describe('tekstextractie', () => {
  const scan = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  it('leest platte tekst en markdown', async () => {
    expect((await leesTekst(Buffer.from('hallo'), 'text/plain')).tekst).toBe('hallo');
    expect((await leesTekst(Buffer.from('# hallo'), 'text/markdown')).tekst).toBe('# hallo');
  });

  it('geeft geen tekst terug voor een PDF, zodat er veilig teruggevallen wordt', async () => {
    const pdf = Buffer.from('%PDF-1.7 binaire inhoud die niet als tekst te lezen valt');
    expect(await leesTekst(pdf, 'application/pdf')).toEqual({ tekst: '', herkomst: 'onleesbaar' });
  });

  it('gebruikt de tekst uit een scan als de herkenning betrouwbaar is', async () => {
    const ocr = async () => ({ tekst: 'Medisch verslag', betrouwbaarheid: 92 });
    const gelezen = await leesTekst(scan, 'image/png', ocr);
    expect(gelezen.herkomst).toBe('ocr');
    expect(gelezen.tekst).toBe('Medisch verslag');
  });

  it('gooit onbetrouwbaar herkende tekst weg', async () => {
    const ocr = async () => ({ tekst: 'Mcd1sch vcrsl@g', betrouwbaarheid: MINIMALE_OCR_BETROUWBAARHEID - 1 });
    expect((await leesTekst(scan, 'image/png', ocr)).tekst).toBe('');
  });

  it('geeft op als de tekstherkenning blijft hangen', async () => {
    const hangt = new Promise<never>(() => {});
    await expect(metTijdslimiet(hangt, 20)).rejects.toThrow('langer dan 20 ms');
    await expect(metTijdslimiet(Promise.resolve('klaar'), 20)).resolves.toBe('klaar');
  });

  it('valt veilig terug als de tekstherkenning faalt, zonder de verwerking te stoppen', async () => {
    const ocr = async (): Promise<never> => {
      throw new Error('tekstherkenning niet beschikbaar');
    };
    expect(await leesTekst(scan, 'image/png', ocr)).toEqual({ tekst: '', herkomst: 'onleesbaar' });
  });
});

describe('classificatie van tekst uit een scan', () => {
  it('maakt een scan zonder herkenbare gegevens nooit publiek', () => {
    const r = classificeer('Openingsuren van het gemeentehuis tijdens de feestdagen.', publiek, { herkomst: 'ocr' });
    expect(r.classificatie).toBe('intern');
    expect(r.zekerheid).toBe('onzeker');
  });

  it('herkent signalen in een scan zoals in gewone tekst', () => {
    const r = classificeer('In bijlage het medisch verslag met de diagnose.', publiek, { herkomst: 'ocr' });
    expect(r.classificatie).toBe('gevoelige_persoonsgegevens');
    expect(r.zekerheid).toBe('zeker');
  });
});

describe('bescherming van het auditspoor', () => {
  it('logt het signaal maar niet het persoonsgegeven zelf', () => {
    const signalen = zoekAlleSignalen('Mail naar jan.peeters@voorbeeld.be alstublieft.');
    const bewijs = signalen[0].bewijs;
    expect(bewijs).not.toContain('jan.peeters@voorbeeld.be');
    expect(bewijs).toContain('*');
  });
});
