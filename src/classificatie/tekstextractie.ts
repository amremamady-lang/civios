/**
 * Tekst uit een aangeboden bestand halen, vóór er geclassificeerd wordt.
 *
 * - Platte tekst (.txt, .md) wordt rechtstreeks gelezen.
 * - Een scan (.jpg, .png) wordt gelezen met tekstherkenning (OCR, zie
 *   `ocr.ts`). Is de herkenning te onzeker of mislukt ze, dan komt er bewust
 *   géén tekst terug: de classificatie valt dan veilig terug op de strengste
 *   categorie en het document gaat in nazicht.
 * - Een PDF wordt in dit prototype niet gelezen: PDF is binair en meestal
 *   gecomprimeerd. Ook hier volgt de veilige terugval.
 *
 * Wie later PDF-extractie of een andere OCR-dienst toevoegt, doet dat hier,
 * zonder dat classificatie of verwerking moeten wijzigen.
 */

import { leesAfbeelding, type OcrResultaat } from './ocr.js';

const LEESBARE_TYPES = ['text/plain', 'text/markdown'];
const AFBEELDINGEN = ['image/jpeg', 'image/png'];

/**
 * Onder deze betrouwbaarheid (0-100) wordt herkende tekst niet gebruikt.
 * Liever een document te veel in nazicht dan een slecht gelezen scan die er
 * onschuldig uitziet.
 */
export const MINIMALE_OCR_BETROUWBAARHEID = 70;

export interface GelezenTekst {
  tekst: string;
  /**
   * 'tekst'     : rechtstreeks gelezen, betrouwbaar.
   * 'ocr'       : uit een scan herkend; kan fouten bevatten.
   * 'onleesbaar': er kon niets betrouwbaars gelezen worden.
   */
  herkomst: 'tekst' | 'ocr' | 'onleesbaar';
  betrouwbaarheid?: number;
}

export async function leesTekst(
  inhoud: Buffer,
  mimetype: string,
  // Kan in tests vervangen worden, bv. om een falende OCR na te bootsen.
  ocr: (inhoud: Buffer) => Promise<OcrResultaat> = leesAfbeelding,
): Promise<GelezenTekst> {
  if (LEESBARE_TYPES.includes(mimetype)) {
    return { tekst: inhoud.toString('utf8'), herkomst: 'tekst' };
  }

  if (AFBEELDINGEN.includes(mimetype)) {
    try {
      const { tekst, betrouwbaarheid } = await ocr(inhoud);
      if (betrouwbaarheid < MINIMALE_OCR_BETROUWBAARHEID) {
        return { tekst: '', herkomst: 'onleesbaar', betrouwbaarheid };
      }
      return { tekst, herkomst: 'ocr', betrouwbaarheid };
    } catch (fout) {
      // Een falende tekstherkenning mag de verwerking niet stoppen en mag
      // zeker niet tot een milde classificatie leiden.
      console.error('Tekstherkenning niet beschikbaar:', fout);
      return { tekst: '', herkomst: 'onleesbaar' };
    }
  }

  return { tekst: '', herkomst: 'onleesbaar' };
}
