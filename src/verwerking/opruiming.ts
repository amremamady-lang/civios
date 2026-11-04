/**
 * Opruiming na de bewaartermijn.
 *
 * Elk document krijgt bij het opslaan een vervaldatum uit het beleid. Deze
 * taak verwijdert documenten waarvan die datum verstreken is: het bestand op
 * schijf én de fiche in de databank. Het **auditspoor blijft bestaan**: dat is
 * de reden waarom het auditlog een aparte tabel is. Ook de verwijdering zelf
 * wordt gelogd, zodat later te zien is dat en waarom een document verdween.
 *
 * De taak draait bij het opstarten en daarna elke dag (zie `web/server.ts`).
 * Ze is idempotent: twee keer draaien kan geen kwaad.
 */

import { rmSync } from 'node:fs';
import { Auditlog } from '../audit/auditlog.js';
import { Documentenregister } from '../opslag/documenten.js';
import { STANDAARD_OPSLAGWORTEL } from '../opslag/bestandsopslag.js';
import type { Db } from '../opslag/database.js';

export interface Opruimrapport {
  verwijderd: number;
  mislukt: number;
}

export function verwijderVerlopen(
  db: Db,
  opslagwortel: string = STANDAARD_OPSLAGWORTEL,
  nu: Date = new Date(),
): Opruimrapport {
  void opslagwortel; // het pad staat per document in de databank
  const audit = new Auditlog(db);
  const documenten = new Documentenregister(db);
  const rapport: Opruimrapport = { verwijderd: 0, mislukt: 0 };

  for (const document of documenten.verlopen(nu)) {
    try {
      // Eerst het bestand, dan de fiche en de auditregel in één transactie.
      // Verdwijnt het bestand maar faalt de transactie, dan blijft de fiche
      // staan en probeert de volgende run het opnieuw (rmSync met force
      // klaagt niet over een bestand dat al weg is).
      rmSync(document.opslagpad, { force: true });
      db.transaction(() => {
        documenten.verwijder(document.id);
        audit.schrijf({
          actor: 'systeem',
          rol: 'systeem',
          documentId: document.id,
          handeling: 'verwijderd_na_bewaartermijn',
          classificatie: document.classificatie,
          motivering:
            `Bewaartermijn verstreken op ${document.bewaren_tot.slice(0, 10)} ` +
            `(beleidsversie ${document.beleidsversie}); bestand en fiche verwijderd, auditspoor bewaard.`,
          beleidsversie: document.beleidsversie,
          uitkomst: 'geslaagd',
        });
      })();
      rapport.verwijderd++;
    } catch (fout) {
      console.error(`Opruimen van document ${document.id} mislukt:`, fout);
      rapport.mislukt++;
    }
  }
  return rapport;
}
