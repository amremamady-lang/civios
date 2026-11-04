/**
 * Het auditlog.
 *
 * Eén verantwoordelijkheid: vastleggen welke beslissing genomen is, door wie,
 * wanneer en waarom. De module biedt bewust geen methode om een regel te
 * wijzigen of te verwijderen; de database weigert dat bovendien via triggers.
 *
 * Twee lagen bescherming:
 * 1. **Triggers** in de databank weigeren elke UPDATE en DELETE.
 * 2. **Een hash-ketting.** Elke regel bevat een SHA-256 over zijn inhoud én de
 *    hash van de vorige regel. Wie met beheerdersrechten de triggers omzeilt en
 *    een regel wijzigt of wist, breekt de ketting. `controleerIntegriteit`
 *    rekent de ketting na en wijst de eerste gebroken regel aan. Zo is
 *    manipulatie niet onmogelijk, maar wel altijd aantoonbaar.
 */

import { createHash } from 'node:crypto';
import type { Db } from '../opslag/database.js';
import type { Classificatie, Signaal } from '../domein/types.js';
import type { Rol } from '../beleid/beleid.js';

export type Handeling =
  | 'classificatie_voorgesteld'
  | 'document_aangeboden'
  | 'validatie_geweigerd'
  | 'geclassificeerd'
  | 'opgeslagen'
  | 'in_nazicht_geplaatst'
  | 'nazicht_afgehandeld'
  | 'verwijderd_na_bewaartermijn'
  | 'toegang_geweigerd'
  | 'toegang_verleend'
  | 'auditlog_geraadpleegd'
  | 'aangemeld'
  | 'afgemeld'
  | 'aanmelding_mislukt';

export interface Auditregel {
  actor: string;
  /** 'systeem' voor geautomatiseerde taken, zoals de opruiming na de bewaartermijn. */
  rol: Rol | 'systeem';
  documentId?: string;
  handeling: Handeling;
  classificatie?: Classificatie;
  zekerheid?: 'zeker' | 'onzeker';
  signalen?: Signaal[];
  motivering?: string;
  beleidsversie?: string;
  uitkomst: 'geslaagd' | 'geweigerd';
}

/** Een regel zoals ze in de databank staat. */
export interface Auditrij {
  id: number;
  tijdstip: string;
  actor: string;
  rol: string;
  document_id: string | null;
  handeling: string;
  classificatie: string | null;
  zekerheid: string | null;
  signalen: string | null;
  motivering: string | null;
  beleidsversie: string | null;
  uitkomst: string;
  vorige_hash: string | null;
  hash: string;
}

export interface Integriteitsrapport {
  intact: boolean;
  aantalRegels: number;
  /** Id van de eerste regel waar de ketting breekt, als ze niet intact is. */
  eersteBreuk?: number;
}

/** De hash over één regel: de inhoud plus de hash van de vorige regel. */
export function hashVanRegel(rij: Omit<Auditrij, 'id' | 'hash'>): string {
  const inhoud = [
    rij.vorige_hash ?? '',
    rij.tijdstip,
    rij.actor,
    rij.rol,
    rij.document_id ?? '',
    rij.handeling,
    rij.classificatie ?? '',
    rij.zekerheid ?? '',
    rij.signalen ?? '',
    rij.motivering ?? '',
    rij.beleidsversie ?? '',
    rij.uitkomst,
  ].join('\u0000');
  return createHash('sha256').update(inhoud, 'utf8').digest('hex');
}

export class Auditlog {
  constructor(private db: Db) {}

  schrijf(regel: Auditregel): void {
    // In één transactie: de laatste hash lezen en de nieuwe regel schrijven,
    // zodat twee gelijktijdige schrijvers nooit dezelfde voorganger nemen.
    this.db.transaction(() => {
      const laatste = this.db
        .prepare('SELECT hash FROM auditlog ORDER BY id DESC LIMIT 1')
        .get() as { hash: string } | undefined;

      const rij: Omit<Auditrij, 'id' | 'hash'> = {
        tijdstip: new Date().toISOString(),
        actor: regel.actor,
        rol: regel.rol,
        document_id: regel.documentId ?? null,
        handeling: regel.handeling,
        classificatie: regel.classificatie ?? null,
        zekerheid: regel.zekerheid ?? null,
        signalen: regel.signalen ? JSON.stringify(regel.signalen) : null,
        motivering: regel.motivering ?? null,
        beleidsversie: regel.beleidsversie ?? null,
        uitkomst: regel.uitkomst,
        vorige_hash: laatste?.hash ?? null,
      };

      this.db
        .prepare(
          `INSERT INTO auditlog
             (tijdstip, actor, rol, document_id, handeling, classificatie,
              zekerheid, signalen, motivering, beleidsversie, uitkomst,
              vorige_hash, hash)
           VALUES (@tijdstip, @actor, @rol, @document_id, @handeling, @classificatie,
                   @zekerheid, @signalen, @motivering, @beleidsversie, @uitkomst,
                   @vorige_hash, @hash)`,
        )
        .run({ ...rij, hash: hashVanRegel(rij) });
    })();
  }

  /**
   * Rekent de hele ketting na. Elke regel moet de hash van zijn voorganger
   * dragen en zijn eigen hash moet kloppen met zijn inhoud.
   */
  controleerIntegriteit(): Integriteitsrapport {
    const rijen = this.db.prepare('SELECT * FROM auditlog ORDER BY id ASC').all() as Auditrij[];
    let vorige: string | null = null;
    for (const rij of rijen) {
      const { id, hash, ...rest } = rij;
      if (rij.vorige_hash !== vorige || hashVanRegel(rest) !== hash) {
        return { intact: false, aantalRegels: rijen.length, eersteBreuk: id };
      }
      vorige = hash;
    }
    return { intact: true, aantalRegels: rijen.length };
  }

  /** Heeft deze gebruiker dit document zelf aangeboden? */
  isAanbieder(documentId: string, actor: string): boolean {
    return (
      this.db
        .prepare(
          `SELECT 1 FROM auditlog
            WHERE document_id = ? AND actor = ? AND handeling = 'geclassificeerd'
            LIMIT 1`,
        )
        .get(documentId, actor) !== undefined
    );
  }

  /** Het volledige spoor van één document, oudste eerst. */
  voorDocument(documentId: string): unknown[] {
    return this.db
      .prepare('SELECT * FROM auditlog WHERE document_id = ? ORDER BY id ASC')
      .all(documentId);
  }

  recent(limiet = 50): unknown[] {
    return this.db
      .prepare('SELECT * FROM auditlog ORDER BY id DESC LIMIT ?')
      .all(limiet);
  }
}
