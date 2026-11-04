/**
 * De classificatiestap.
 *
 * Deze module beslist welke classificatie een document krijgt. Ze weet niets
 * over opslag, rollen of logging: ze krijgt tekst en metadata binnen en geeft
 * een resultaat terug. Die scheiding is bewust, zodat de classificatie later
 * een aparte service kan worden zonder dat de rest wijzigt.
 *
 * De signalen komen uit twee bronnen:
 * - patronen met controlegetallen voor gestructureerde gegevens (e-mail,
 *   rijksregisternummer, IBAN, adres) en trefwoorden (`signalen.ts`);
 * - het taalmodel voor namen en adressen zonder vaste vorm (`ner.ts`). Die
 *   komen binnen als `extraSignalen`, zodat deze functie zelf eenvoudig en
 *   zonder model testbaar blijft.
 */

import {
  strengste,
  type Classificatie,
  type Classificatieresultaat,
  type Documentmetadata,
  type Signaal,
} from '../domein/types.js';
import { zoekAlleSignalen } from './signalen.js';

/**
 * Onder deze hoeveelheid tekst uit een scan doen we geen uitspraak: een scan
 * waar de tekstherkenning maar een paar tekens uit haalt, is waarschijnlijk
 * slecht gelezen, en dan weten we niet wat er echt op staat.
 *
 * Voor gewone tekst geldt dit niet: een korte nota ("Vergadering om 14u.") is
 * volledig leesbaar, dus die wordt gewoon beoordeeld. Enkel een document
 * zonder enige leesbare tekst (lege tekst, PDF, mislukte scan) valt terug.
 */
export const MINIMUM_OCR_TEKSTLENGTE = 20;

/** De classificatie waarop het systeem terugvalt als het het niet weet. */
export const VEILIGE_TERUGVAL: Classificatie = 'gevoelige_persoonsgegevens';

/**
 * Waar de tekst vandaan komt. Tekst uit een scan (tekstherkenning) kan
 * leesfouten bevatten, bv. 'diagn0se' in plaats van 'diagnose'.
 */
export type Herkomst = 'tekst' | 'ocr';

export interface Classificatieopties {
  herkomst?: Herkomst;
  /** Signalen van het taalmodel: namen en adressen. */
  extraSignalen?: Signaal[];
  /** `false` als het taalmodel niet beschikbaar was; dan kunnen namen gemist zijn. */
  naamherkenning?: boolean;
}

/**
 * Classificeert een document.
 *
 * Het uitgangspunt is fail-closed: twijfel leidt altijd naar de strengste
 * categorie, nooit naar de mildste. Een document te streng inschalen kost
 * iemand een extra handeling; te mild inschalen kan persoonsgegevens
 * publiek maken. Die twee fouten zijn niet even erg.
 */
export function classificeer(
  tekst: string,
  metadata: Documentmetadata,
  opties: Classificatieopties = {},
): Classificatieresultaat {
  const { herkomst = 'tekst', extraSignalen = [], naamherkenning = true } = opties;
  const leesbaar = tekst.trim();

  const onleesbaar =
    leesbaar.length === 0 || (herkomst === 'ocr' && leesbaar.length < MINIMUM_OCR_TEKSTLENGTE);

  if (onleesbaar) {
    return {
      classificatie: VEILIGE_TERUGVAL,
      zekerheid: 'onzeker',
      signalen: [],
      motivering:
        'Er is te weinig leesbare tekst gevonden om te classificeren, bijvoorbeeld bij een PDF of een scan die niet betrouwbaar gelezen kon worden. ' +
        'Het document wordt daarom als gevoelig behandeld en voor nazicht aangeboden.',
    };
  }

  // Patronen en taalmodel samen. Vinden beide hetzelfde soort signaal (bv.
  // een adres), dan telt het één keer.
  const patronen = zoekAlleSignalen(leesbaar);
  const signalen = [
    ...patronen,
    ...extraSignalen.filter((e) => !patronen.some((p) => p.type === e.type)),
  ];

  // Redenen waarom "niets gevonden" niet betrouwbaar is.
  const twijfel: string[] = [];
  if (herkomst === 'ocr') {
    twijfel.push('de tekst werd met tekstherkenning uit een scan gelezen en kan leesfouten bevatten');
  }
  if (!naamherkenning) {
    twijfel.push('de naamherkenning was niet beschikbaar, waardoor namen gemist kunnen zijn');
  }
  const toelichting = twijfel.length > 0 ? ` Let op: ${twijfel.join(', en ')}.` : '';

  if (signalen.length === 0 && twijfel.length > 0) {
    // Niets gevonden kan hier ook betekenen: niets goed gelezen of herkend.
    // Het document wordt daarom nooit automatisch publiek, ongeacht de
    // metadata, en een medewerker kijkt mee.
    return {
      classificatie: 'intern',
      zekerheid: 'onzeker',
      signalen: [],
      motivering:
        'Geen persoonsgegevens of gevoelige kenmerken aangetroffen.' +
        toelichting +
        ' Het document wordt daarom nooit automatisch publiek: het wordt als intern behandeld en voor nazicht aangeboden.',
    };
  }

  if (signalen.length === 0) {
    // Geen herkenbare gegevens: dan pas telt wat de aanbieder voorstelde.
    // 'intern' is de standaard, want publiek maken is onomkeerbaar.
    const classificatie: Classificatie =
      metadata.beoogdeZichtbaarheid === 'publiek' ? 'publiek' : 'intern';
    return {
      classificatie,
      zekerheid: 'zeker',
      signalen: [],
      motivering:
        `Geen persoonsgegevens of gevoelige kenmerken aangetroffen. ` +
        `De metadata geeft '${metadata.beoogdeZichtbaarheid}' aan, dus het document wordt als ${classificatie} ingeschaald.`,
    };
  }

  const classificatie = signalen
    .map((s) => s.impliceert)
    .reduce((hoogste, huidige) => strengste(hoogste, huidige));

  return {
    classificatie,
    // Zonder naamherkenning kan er een strenger signaal gemist zijn.
    zekerheid: naamherkenning ? 'zeker' : 'onzeker',
    signalen,
    motivering:
      `Op basis van ${signalen.length} signaal/signalen (${signalen.map((s) => s.type).join(', ')}) ` +
      `is de strengste van toepassing zijnde classificatie '${classificatie}' toegekend.` +
      toelichting,
  };
}

/**
 * Wikkelt de classificatie zodat een onverwachte fout nooit tot een milde
 * inschaling kan leiden. Valt de classificatiedienst uit, dan behandelt het
 * systeem het document als gevoelig in plaats van de verwerking af te breken
 * of door te laten.
 */
export function classificeerVeilig(
  tekst: string,
  metadata: Documentmetadata,
  opties: Classificatieopties = {},
): Classificatieresultaat {
  try {
    return classificeer(tekst, metadata, opties);
  } catch (fout) {
    // De technische oorzaak blijft aan de serverkant. De motivering gaat naar
    // de gebruiker en het auditlog, en mag geen interne details bevatten.
    console.error('Classificatie mislukt:', fout);
    return {
      classificatie: VEILIGE_TERUGVAL,
      zekerheid: 'onzeker',
      signalen: [],
      motivering:
        'De classificatie kon niet worden uitgevoerd door een technische fout. ' +
        'Het document is als gevoelig behandeld en voor nazicht aangeboden.',
    };
  }
}
