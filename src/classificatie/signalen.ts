/**
 * Herkenning van signalen in de tekst van een document.
 *
 * Elke detector is een zuivere functie: tekst in, signalen uit. Dat maakt
 * ze afzonderlijk testbaar en vervangbaar. Hier staan de detectoren voor
 * gestructureerde gegevens (patronen met controlegetallen) en trefwoorden;
 * namen en vrije adressen komen van het taalmodel in `ner.ts`.
 */

import type { Signaal } from '../domein/types.js';

/** Vervangt alles behalve de eerste en laatste tekens door sterretjes. */
function maskeer(waarde: string, toon = 2): string {
  if (waarde.length <= toon * 2) return '*'.repeat(waarde.length);
  return waarde.slice(0, toon) + '*'.repeat(waarde.length - toon * 2) + waarde.slice(-toon);
}

/* ------------------------------------------------------------------ */
/* E-mailadressen                                                      */
/* ------------------------------------------------------------------ */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function zoekEmailadressen(tekst: string): Signaal | null {
  const treffers = tekst.match(EMAIL);
  if (!treffers) return null;
  return {
    type: 'emailadres',
    impliceert: 'persoonsgegevens',
    bewijs: maskeer(treffers[0]),
    aantal: treffers.length,
  };
}

/* ------------------------------------------------------------------ */
/* Belgisch rijksregisternummer                                        */
/* ------------------------------------------------------------------ */

/** Elf cijfers, eventueel met punten en een koppelteken ertussen. */
const RRN_KANDIDAAT = /\b\d{2}[.\s]?\d{2}[.\s]?\d{2}[-\s]?\d{3}[.\s]?\d{2}\b/g;

/**
 * Controleert de controlegetallen van een rijksregisternummer.
 *
 * De laatste twee cijfers zijn 97 min de rest van de eerste negen cijfers
 * gedeeld door 97. Voor wie geboren is vanaf 2000 wordt er een 2 voor die
 * negen cijfers gezet voor de berekening. Beide varianten worden getest.
 *
 * Deze controle is het verschil tussen "elf cijfers gevonden" en "een geldig
 * rijksregisternummer gevonden": ze houdt dossiernummers en bedragen buiten.
 */
export function isGeldigRijksregisternummer(ruw: string): boolean {
  const cijfers = ruw.replace(/\D/g, '');
  if (cijfers.length !== 11) return false;

  const basis = cijfers.slice(0, 9);
  const controle = Number(cijfers.slice(9, 11));

  const voor2000 = 97 - (Number(basis) % 97);
  const vanaf2000 = 97 - (Number('2' + basis) % 97);

  return controle === voor2000 || controle === vanaf2000;
}

export function zoekRijksregisternummers(tekst: string): Signaal | null {
  const kandidaten = tekst.match(RRN_KANDIDAAT) ?? [];
  const geldig = kandidaten.filter(isGeldigRijksregisternummer);
  if (geldig.length === 0) return null;
  return {
    type: 'rijksregisternummer',
    impliceert: 'persoonsgegevens',
    bewijs: maskeer(geldig[0].replace(/\D/g, ''), 2),
    aantal: geldig.length,
  };
}

/* ------------------------------------------------------------------ */
/* Adressen                                                            */
/* ------------------------------------------------------------------ */

/**
 * Een straatnaam met een gangbaar Vlaams achtervoegsel, gevolgd door een
 * huisnummer: 'Kerkstraat 12', 'Frankrijklei 5b', 'Grote Markt 1'.
 *
 * Bewust beperkt tot achtervoegsels die zelden iets anders betekenen. 'weg'
 * of 'baan' zouden ook 'de snelweg 4 uur' of 'loopbaan 3 jaar' vangen.
 * Kanttekening: ook het adres van het gemeentehuis in een brochure wordt zo
 * herkend. Dat maakt de classificatie strenger, nooit milder.
 *
 * Dit patroon werkt ook als het taalmodel niet beschikbaar is. Adressen met een
 * ander soort straatnaam ('Kouter 5') vindt het taalmodel (`ner.ts`).
 */
const ADRES =
  /\b(?:\p{Lu}[\p{L}'-]*(?:straat|laan|steenweg|plein|lei|dreef|kaai|markt|singel|vest)|Markt|Plein|Kaai|Vest)\s+\d{1,4}[a-zA-Z]?\b/gu;

/**
 * Adressen van het bestuur zelf. Die staan in elke brochure en op elk
 * briefhoofd en zijn geen persoonsgegeven. Net als de trefwoorden op één plek,
 * zodat een functioneel beheerder ze kan aanvullen. Fictief in dit prototype.
 */
export const EIGEN_ADRESSEN = ['Gemeenteplein 1', 'Stationsstraat 10'];

const normaliseer = (adres: string) => adres.toLowerCase().replace(/\s+/g, ' ').trim();
const EIGEN_GENORMALISEERD = new Set(EIGEN_ADRESSEN.map(normaliseer));

/** Is dit een adres van het bestuur zelf (dus geen persoonsgegeven)? */
export function isEigenAdres(adres: string): boolean {
  return EIGEN_GENORMALISEERD.has(normaliseer(adres));
}

export function zoekAdressen(tekst: string): Signaal | null {
  const treffers = (tekst.match(ADRES) ?? []).filter((a) => !isEigenAdres(a));
  if (treffers.length === 0) return null;
  return {
    type: 'adres',
    impliceert: 'persoonsgegevens',
    bewijs: maskeer(treffers[0], 3),
    aantal: treffers.length,
  };
}

/*
 * Namen worden niet hier met patronen gezocht, maar met een taalmodel
 * (`ner.ts`): een naam heeft geen vaste vorm, dus elk patroon zou ofwel namen
 * missen, ofwel elk woord met een hoofdletter verdenken.
 */

/* ------------------------------------------------------------------ */
/* IBAN-rekeningnummers                                                */
/* ------------------------------------------------------------------ */

const IBAN_KANDIDAAT = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}\b/g;

/** IBAN gebruikt dezelfde modulo-97-controle, maar over de hele string. */
export function isGeldigIban(ruw: string): boolean {
  const schoon = ruw.replace(/\s/g, '').toUpperCase();
  if (schoon.length < 15 || schoon.length > 34) return false;

  const verplaatst = schoon.slice(4) + schoon.slice(0, 4);
  const numeriek = verplaatst.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));

  // Stuksgewijs rekenen, want het getal is te groot voor een gewone number.
  let rest = 0;
  for (const cijfer of numeriek) {
    rest = (rest * 10 + Number(cijfer)) % 97;
  }
  return rest === 1;
}

export function zoekIban(tekst: string): Signaal | null {
  const kandidaten = tekst.match(IBAN_KANDIDAAT) ?? [];
  const geldig = kandidaten.filter(isGeldigIban);
  if (geldig.length === 0) return null;
  return {
    // De opdracht rekent financiële informatie bij de gevoelige gegevens.
    // Zie ARCHITECTUUR.md voor de nuance tegenover artikel 9 van de AVG.
    type: 'iban',
    impliceert: 'gevoelige_persoonsgegevens',
    bewijs: maskeer(geldig[0].replace(/\s/g, ''), 4),
    aantal: geldig.length,
  };
}

/* ------------------------------------------------------------------ */
/* Trefwoorden                                                         */
/* ------------------------------------------------------------------ */

/**
 * Trefwoordenlijsten staan bewust op één plek, zodat een functioneel
 * beheerder ze kan aanpassen zonder in de logica te moeten werken.
 */
export const TREFWOORDEN: Record<
  'medisch' | 'strafrechtelijk' | 'financieel',
  string[]
> = {
  medisch: [
    'medisch verslag',
    'medisch attest',
    'diagnose',
    'behandelend arts',
    'patiëntendossier',
    'ziekenhuisopname',
  ],
  strafrechtelijk: [
    'strafrechtelijk',
    'proces-verbaal',
    'uittreksel strafregister',
    'veroordeling',
    'strafonderzoek',
  ],
  financieel: [
    'loonfiche',
    'schuldbemiddeling',
    'collectieve schuldenregeling',
    'rekeningnummer',
    'aanslagbiljet',
  ],
};

const TYPE_PER_CATEGORIE = {
  medisch: 'trefwoord_medisch',
  strafrechtelijk: 'trefwoord_strafrechtelijk',
  financieel: 'trefwoord_financieel',
} as const;

export function zoekTrefwoorden(tekst: string): Signaal[] {
  const laag = tekst.toLowerCase();
  const signalen: Signaal[] = [];

  for (const [categorie, woorden] of Object.entries(TREFWOORDEN)) {
    const gevonden = woorden.filter((woord) => laag.includes(woord));
    if (gevonden.length === 0) continue;
    signalen.push({
      type: TYPE_PER_CATEGORIE[categorie as keyof typeof TYPE_PER_CATEGORIE],
      impliceert: 'gevoelige_persoonsgegevens',
      // Een trefwoord is geen persoonsgegeven, dus dat mag onverkort gelogd.
      bewijs: gevonden.join(', '),
      aantal: gevonden.length,
    });
  }

  return signalen;
}

/** Voert alle detectoren uit en geeft de gevonden signalen terug. */
export function zoekAlleSignalen(tekst: string): Signaal[] {
  return [
    zoekEmailadressen(tekst),
    zoekRijksregisternummers(tekst),
    zoekAdressen(tekst),
    zoekIban(tekst),
    ...zoekTrefwoorden(tekst),
  ].filter((s): s is Signaal => s !== null);
}
