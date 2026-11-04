/**
 * Tekstherkenning (OCR) op scans.
 *
 * Een scan is een foto van een blad papier: pixels, geen letters. OCR
 * (Optical Character Recognition) zoekt de letters in die pixels terug.
 *
 * Bewuste keuzes:
 * - **Volledig lokaal.** Tesseract draait op de eigen server en de
 *   Nederlandse taaldata zit in het project (`@tesseract.js-data/nld`). Een
 *   scan van een medisch attest verlaat het bestuur dus nooit; er is geen
 *   clouddienst, geen kost per pagina en geen internetverbinding nodig.
 * - **Eén herbruikbare werker.** Het opstarten kost tijd; daarna leest de
 *   werker scans één voor één.
 * - **Een tijdslimiet.** Hangt de herkenning, dan geeft de functie op. De
 *   classificatie valt dan veilig terug (zie `tekstextractie.ts`).
 * - **Fouten worden doorgegeven, niet gegooid.** Zonder `errorHandler` laat
 *   een fout in Tesseract het hele serverproces crashen.
 */

import { createWorker, type Worker } from 'tesseract.js';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/** Map met de Nederlandse taaldata, uit het project zelf (niet van internet). */
const TAALMAP = join(
  dirname(require.resolve('@tesseract.js-data/nld/package.json')),
  '4.0.0_best_int',
);

export const MAXIMALE_OCR_DUUR_MS = 20_000;

export interface OcrResultaat {
  tekst: string;
  /** Hoe zeker de herkenning is, van 0 tot 100. */
  betrouwbaarheid: number;
}

let werker: Promise<Worker> | null = null;

function haalWerker(): Promise<Worker> {
  if (!werker) {
    werker = createWorker('nld', 1, {
      langPath: TAALMAP,
      cacheMethod: 'none',
      gzip: true,
      errorHandler: (fout: unknown) => console.error('Tekstherkenning mislukt:', fout),
    });
    // Mislukt het opstarten, dan probeert de volgende aanvraag opnieuw.
    werker.catch(() => {
      werker = null;
    });
  }
  return werker;
}

function metTijdslimiet<T>(belofte: Promise<T>, ms: number): Promise<T> {
  let klok: NodeJS.Timeout;
  const limiet = new Promise<never>((_, weiger) => {
    klok = setTimeout(() => weiger(new Error(`Tekstherkenning duurde langer dan ${ms} ms.`)), ms);
  });
  return Promise.race([belofte, limiet]).finally(() => clearTimeout(klok));
}

/** Start de werker alvast bij het opstarten, zodat de eerste scan niet hoeft te wachten. */
export async function warmOpOcr(): Promise<boolean> {
  try {
    await haalWerker();
    return true;
  } catch (fout) {
    console.error('Tekstherkenning kon niet gestart worden:', fout);
    return false;
  }
}

/** Leest de tekst uit een scan (JPEG of PNG). Gooit een fout als dat niet lukt. */
export async function leesAfbeelding(inhoud: Buffer): Promise<OcrResultaat> {
  const w = await haalWerker();
  const { data } = await metTijdslimiet(w.recognize(inhoud), MAXIMALE_OCR_DUUR_MS);
  return { tekst: data.text, betrouwbaarheid: data.confidence };
}

/** Stopt de werker, bv. aan het einde van de tests. */
export async function stopOcr(): Promise<void> {
  const huidige = werker;
  werker = null;
  const w = await huidige?.catch(() => null);
  await w?.terminate();
}
