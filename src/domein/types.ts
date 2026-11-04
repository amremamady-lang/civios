/**
 * Kernbegrippen van het domein.
 *
 * Deze module bevat enkel types en zuivere hulpfuncties. Ze kent geen
 * database, geen bestandssysteem en geen webframework. Daardoor kunnen
 * classificatie en beleid getest worden zonder enige infrastructuur.
 */

/** De vier classificaties uit de opdracht, van laag naar hoog gevoelig. */
export const CLASSIFICATIES = [
  'publiek',
  'intern',
  'persoonsgegevens',
  'gevoelige_persoonsgegevens',
] as const;

export type Classificatie = (typeof CLASSIFICATIES)[number];

/**
 * Rangorde van gevoeligheid. Wordt gebruikt om bij meerdere signalen
 * altijd de strengste classificatie te laten winnen.
 */
export function gevoeligheid(classificatie: Classificatie): number {
  return CLASSIFICATIES.indexOf(classificatie);
}

/** Geeft de strengste van twee classificaties terug. */
export function strengste(a: Classificatie, b: Classificatie): Classificatie {
  return gevoeligheid(a) >= gevoeligheid(b) ? a : b;
}

/** Soorten signalen die de classificatie onderbouwen. */
export type SignaalType =
  | 'emailadres'
  | 'rijksregisternummer'
  | 'adres'
  | 'naam'
  | 'iban'
  | 'trefwoord_medisch'
  | 'trefwoord_strafrechtelijk'
  | 'trefwoord_financieel';

/**
 * Eén aangetroffen signaal.
 *
 * `bewijs` is bewust gemaskeerd. Het auditlog mag vastleggen dat er een
 * rijksregisternummer gevonden is, maar niet welk nummer dat was. Anders
 * zou het auditlog zelf een verzameling persoonsgegevens worden.
 */
export interface Signaal {
  type: SignaalType;
  impliceert: Classificatie;
  bewijs: string;
  aantal: number;
}

/** Metadata die de aanbieder bij het document meegeeft. */
export interface Documentmetadata {
  titel: string;
  bron: string;
  /** Zichtbaarheid die de aanbieder voorstelt; wordt nooit zomaar gevolgd. */
  beoogdeZichtbaarheid: 'publiek' | 'intern';
}

/** Uitkomst van de classificatiestap. */
export interface Classificatieresultaat {
  classificatie: Classificatie;
  /**
   * 'zeker'  : de tekst kon gelezen en beoordeeld worden.
   * 'onzeker': er kon niet betrouwbaar geclassificeerd worden: geen leesbare
   *            tekst (een PDF, een slechte scan), of de tekst- of
   *            naamherkenning was niet beschikbaar. Het systeem valt dan
   *            terug op een voorzichtige classificatie en vraagt nazicht.
   */
  zekerheid: 'zeker' | 'onzeker';
  signalen: Signaal[];
  motivering: string;
}
