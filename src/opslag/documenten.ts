/**
 * Het documentenregister: de fiches van de opgeslagen documenten.
 *
 * Eén verantwoordelijkheid: documentregels bewaren en terugvinden. Samen met
 * `audit/auditlog.ts` is dit de enige plek met SQL. Wie later naar
 * PostgreSQL overstapt, past deze twee klassen aan; de rest van de
 * applicatie merkt daar niets van.
 */

import type { Db } from './database.js';
import type { Classificatie } from '../domein/types.js';

export interface Documentrij {
  id: string;
  titel: string;
  bron: string;
  bestandsnaam: string;
  mimetype: string;
  grootte_bytes: number;
  sha256: string;
  classificatie: Classificatie;
  zekerheid: string;
  /** 'definitief_opgeslagen' of 'in_nazicht'. */
  status: string;
  /** Intern pad op de schijf; wordt nooit naar buiten gegeven. */
  opslagpad: string;
  /** JSON-lijst van rollen. */
  toegang: string;
  bewaren_tot: string;
  beleidsversie: string;
  aangemaakt_op: string;
}

export class Documentenregister {
  constructor(private db: Db) {}

  voegToe(rij: Documentrij): void {
    this.db
      .prepare(
        `INSERT INTO documenten
           (id, titel, bron, bestandsnaam, mimetype, grootte_bytes, sha256,
            classificatie, zekerheid, status, opslagpad, toegang, bewaren_tot,
            beleidsversie, aangemaakt_op)
         VALUES (@id, @titel, @bron, @bestandsnaam, @mimetype, @grootte_bytes, @sha256,
                 @classificatie, @zekerheid, @status, @opslagpad, @toegang, @bewaren_tot,
                 @beleidsversie, @aangemaakt_op)`,
      )
      .run(rij);
  }

  haal(id: string): Documentrij | undefined {
    return this.db.prepare('SELECT * FROM documenten WHERE id = ?').get(id) as
      | Documentrij
      | undefined;
  }

  /** Documenten die op menselijk nazicht wachten, oudste eerst. */
  inNazicht(): Documentrij[] {
    return this.db
      .prepare("SELECT * FROM documenten WHERE status = 'in_nazicht' ORDER BY aangemaakt_op ASC")
      .all() as Documentrij[];
  }

  /** Documenten waarvan de bewaartermijn verstreken is. */
  verlopen(nu: Date): Documentrij[] {
    return this.db
      .prepare('SELECT * FROM documenten WHERE bewaren_tot < ? ORDER BY bewaren_tot ASC')
      .all(nu.toISOString()) as Documentrij[];
  }

  /** Werkt de beslissingsvelden van een document bij (na nazicht). */
  werkBij(
    id: string,
    velden: Pick<
      Documentrij,
      'classificatie' | 'zekerheid' | 'status' | 'opslagpad' | 'toegang' | 'bewaren_tot' | 'beleidsversie'
    >,
  ): void {
    this.db
      .prepare(
        `UPDATE documenten
            SET classificatie = @classificatie, zekerheid = @zekerheid, status = @status,
                opslagpad = @opslagpad, toegang = @toegang, bewaren_tot = @bewaren_tot,
                beleidsversie = @beleidsversie
          WHERE id = @id`,
      )
      .run({ ...velden, id });
  }

  /** Verwijdert de fiche. Het auditspoor van het document blijft bestaan. */
  verwijder(id: string): void {
    this.db.prepare('DELETE FROM documenten WHERE id = ?').run(id);
  }
}
