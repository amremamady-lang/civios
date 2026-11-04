/**
 * Naamherkenning met een taalmodel (NER, named entity recognition).
 *
 * Een woordenlijst of patroon kan geen namen herkennen: "Jan Peeters belde"
 * bevat geen aanwijzing behalve de naam zelf. Een NER-model is getraind op
 * duizenden zinnen en duidt per woord aan of het een persoon (PER), plaats
 * (LOC), organisatie (ORG) of datum (DATE) is.
 *
 * Taakverdeling, zoals gangbaar bij privacytools:
 * - gestructureerde gegevens (e-mail, rijksregisternummer, IBAN) blijven
 *   patronen met controlegetallen: die zijn exact en uitlegbaar;
 * - namen, en adressen zonder vaste vorm, komen van dit model.
 *
 * Bewuste keuzes:
 * - **Volledig lokaal.** Het model (`Xenova/bert-base-multilingual-cased-ner-hrl`,
 *   meertalig, ook Nederlands) wordt één keer gedownload met `npm run model` en
 *   staat daarna in `modellen/`. Tijdens het classificeren wordt er nooit iets
 *   van internet gehaald (`allowRemoteModels = false`).
 * - **Eén keer laden.** Het model laden duurt enkele seconden; daarna blijft
 *   het in het geheugen.
 * - **Een drempel.** Enkel herkenningen met een score van minstens 0,80 tellen.
 */

import { pipeline, env, type TokenClassificationPipeline } from '@huggingface/transformers';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Signaal } from '../domein/types.js';
import { isEigenAdres } from './signalen.js';

export const NER_MODEL = 'Xenova/bert-base-multilingual-cased-ner-hrl';
export const MODELMAP = join(dirname(fileURLToPath(import.meta.url)), '../../modellen');

/** Onder deze score (0-1) wordt een herkenning niet meegeteld. */
export const MINIMALE_NER_SCORE = 0.8;

env.localModelPath = MODELMAP;
env.allowLocalModels = true;
env.allowRemoteModels = false;

export interface Entiteit {
  soort: 'PER' | 'LOC' | 'ORG' | 'DATE';
  tekst: string;
  score: number;
}

let model: Promise<TokenClassificationPipeline> | null = null;

function laadModel(): Promise<TokenClassificationPipeline> {
  if (!model) {
    model = pipeline('token-classification', NER_MODEL, { dtype: 'q8' }) as Promise<TokenClassificationPipeline>;
    model.catch(() => {
      model = null;
    });
  }
  return model;
}

/** Een BERT-model leest maximaal ca. 500 tokens; lange teksten gaan in stukken. */
function inStukken(tekst: string, maxTekens = 800): string[] {
  const zinnen = tekst.split(/(?<=[.!?\n])\s+/);
  const stukken: string[] = [];
  let huidig = '';
  for (const zin of zinnen) {
    if (huidig && huidig.length + zin.length > maxTekens) {
      stukken.push(huidig);
      huidig = '';
    }
    huidig += (huidig ? ' ' : '') + zin;
  }
  if (huidig.trim()) stukken.push(huidig);
  return stukken;
}

interface Token {
  entity: string;
  score: number;
  index: number;
  word: string;
}

/**
 * Het model geeft een label per stukje woord ('Pe', '##eters'). Deze functie
 * voegt opeenvolgende stukjes van dezelfde soort samen tot één entiteit.
 */
export function voegSamen(tokens: Token[]): Entiteit[] {
  const entiteiten: Entiteit[] = [];
  let huidig: { soort: Entiteit['soort']; woorden: string; scores: number[]; laatste: number } | null = null;

  const sluitAf = () => {
    if (!huidig) return;
    const score = huidig.scores.reduce((a, b) => a + b, 0) / huidig.scores.length;
    entiteiten.push({ soort: huidig.soort, tekst: huidig.woorden, score });
    huidig = null;
  };

  for (const t of tokens) {
    const [voorvoegsel, soort] = t.entity.split('-') as [string, Entiteit['soort']];
    if (!soort) continue;
    const isVervolgstuk = t.word.startsWith('##');
    const hoortErbij =
      huidig !== null &&
      huidig.soort === soort &&
      t.index === huidig.laatste + 1 &&
      (voorvoegsel === 'I' || isVervolgstuk);

    if (hoortErbij && huidig) {
      huidig.woorden += isVervolgstuk ? t.word.slice(2) : ' ' + t.word;
      huidig.scores.push(t.score);
      huidig.laatste = t.index;
    } else {
      sluitAf();
      huidig = { soort, woorden: t.word.replace(/^##/, ''), scores: [t.score], laatste: t.index };
    }
  }
  sluitAf();
  return entiteiten;
}

/**
 * Laadt het model alvast bij het opstarten, zodat de eerste aanvraag niet op
 * het laden hoeft te wachten. Mislukt het, dan wordt dat gelogd; de
 * verwerking valt dan later veilig terug (zie `zoekMetNerVeilig`).
 */
export async function warmOpNer(): Promise<boolean> {
  try {
    await laadModel();
    return true;
  } catch (fout) {
    console.error('Naamherkenning kon niet geladen worden:', fout);
    return false;
  }
}

/** Herkent personen, plaatsen, organisaties en datums in een tekst. */
export async function herkenEntiteiten(tekst: string): Promise<Entiteit[]> {
  const ner = await laadModel();
  const alles: Entiteit[] = [];
  for (const stuk of inStukken(tekst)) {
    const tokens = (await ner(stuk, { ignore_labels: ['O'] })) as unknown as Token[];
    alles.push(...voegSamen(tokens));
  }
  return alles.filter((e) => e.score >= MINIMALE_NER_SCORE);
}

function maskeer(waarde: string): string {
  if (waarde.length <= 2) return '*'.repeat(waarde.length);
  return waarde[0] + '*'.repeat(waarde.length - 2) + waarde[waarde.length - 1];
}

function escapeer(tekst: string): string {
  return tekst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Zet herkende entiteiten om naar signalen:
 * - een persoon → signaal 'naam';
 * - een plaats die in de tekst gevolgd wordt door een huisnummer
 *   ('Veldstraat 3', 'Kouter 12b') → signaal 'adres'. Een plaatsnaam alleen
 *   ('Gent') is geen persoonsgegeven.
 */
export function entiteitenNaarSignalen(tekst: string, entiteiten: Entiteit[]): Signaal[] {
  const signalen: Signaal[] = [];

  const personen = entiteiten.filter((e) => e.soort === 'PER');
  if (personen.length > 0) {
    signalen.push({
      type: 'naam',
      impliceert: 'persoonsgegevens',
      bewijs: maskeer(personen[0].tekst),
      aantal: personen.length,
    });
  }

  const adressen = entiteiten
    .filter((e) => e.soort === 'LOC')
    .map((e) => {
      const treffer = new RegExp(`${escapeer(e.tekst)}\\s+\\d{1,4}[a-zA-Z]?\\b`, 'u').exec(tekst);
      return treffer ? { ...e, adres: treffer[0] } : null;
    })
    .filter((e): e is Entiteit & { adres: string } => e !== null && !isEigenAdres(e.adres));
  if (adressen.length > 0) {
    signalen.push({
      type: 'adres',
      impliceert: 'persoonsgegevens',
      bewijs: maskeer(adressen[0].tekst) + ' <nr>',
      aantal: adressen.length,
    });
  }

  return signalen;
}

/** Zoekt namen en adressen met het taalmodel. Gooit een fout als het model niet beschikbaar is. */
export async function zoekMetNer(tekst: string): Promise<Signaal[]> {
  return entiteitenNaarSignalen(tekst, await herkenEntiteiten(tekst));
}

export interface Naamherkenning {
  signalen: Signaal[];
  /** `false` als het model niet beschikbaar was of faalde. */
  gelukt: boolean;
}

/**
 * Zoals `zoekMetNer`, maar een fout stopt de verwerking niet: dan is
 * `gelukt` false, en de classificatie gaat daar voorzichtig mee om (nazicht,
 * nooit publiek). Zo is het gedrag veilig wanneer het model tijdelijk faalt.
 */
export async function zoekMetNerVeilig(
  tekst: string,
  zoek: (tekst: string) => Promise<Signaal[]> = zoekMetNer,
): Promise<Naamherkenning> {
  if (tekst.trim() === '') return { signalen: [], gelukt: true };
  try {
    return { signalen: await zoek(tekst), gelukt: true };
  } catch (fout) {
    console.error('Naamherkenning niet beschikbaar:', fout);
    return { signalen: [], gelukt: false };
  }
}
