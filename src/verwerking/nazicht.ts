/**
 * Nazicht: een mens handelt af wat het systeem niet zeker wist.
 *
 * Een document met status 'in_nazicht' staat al veilig opgeslagen onder een
 * voorzichtige classificatie. Een dossierbeheerder bekijkt het en beslist:
 * - **bevestigen**: de voorgestelde classificatie klopt;
 * - **herclassificeren**: een andere classificatie, met het bestand naar de
 *   bijhorende map en de bijhorende toegang en bewaartermijn.
 *
 * Tegen misbruik of omzeiling:
 * - enkel een dossierbeheerder (gecontroleerd in de webkant én hier);
 * - enkel documenten die effectief in nazicht staan;
 * - een motivering is verplicht en komt in het auditlog;
 * - **vier ogen**: wie het document zelf aanbood, mag het niet zelf
 *   afhandelen;
 * - de beslissing en de bijwerking gebeuren in één transactie; mislukt die,
 *   dan gaat het bestand terug naar zijn oorspronkelijke map.
 */

import { chmodSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { CLASSIFICATIES, type Classificatie } from '../domein/types.js';
import { beleidVoor, vervaldatum, BELEIDSVERSIE, type Rol } from '../beleid/beleid.js';
import { Auditlog } from '../audit/auditlog.js';
import { Documentenregister } from '../opslag/documenten.js';
import { STANDAARD_OPSLAGWORTEL } from '../opslag/bestandsopslag.js';
import type { Db } from '../opslag/database.js';

export const MINIMALE_MOTIVERING = 10;

export interface Nazichtbeslissing {
  documentId: string;
  beslissing: 'bevestigen' | 'herclassificeren';
  /** Verplicht bij herclassificeren. */
  classificatie?: string;
  motivering: string;
  actor: string;
  rol: Rol;
}

export interface Nazichtfout {
  code:
    | 'geen_rechten'
    | 'niet_gevonden'
    | 'niet_in_nazicht'
    | 'motivering_ontbreekt'
    | 'classificatie_ongeldig'
    | 'vier_ogen';
  boodschap: string;
}

export type Nazichtresultaat =
  | { uitkomst: 'geweigerd'; fout: Nazichtfout }
  | { uitkomst: 'afgehandeld'; documentId: string; classificatie: Classificatie; opslagmap: string };

function isClassificatie(waarde: unknown): waarde is Classificatie {
  return typeof waarde === 'string' && (CLASSIFICATIES as readonly string[]).includes(waarde);
}

export function handelNazichtAf(
  db: Db,
  beslissing: Nazichtbeslissing,
  opslagwortel: string = STANDAARD_OPSLAGWORTEL,
): Nazichtresultaat {
  const audit = new Auditlog(db);
  const documenten = new Documentenregister(db);
  const { documentId, actor, rol, motivering } = beslissing;

  const weiger = (fout: Nazichtfout): Nazichtresultaat => {
    audit.schrijf({
      actor,
      rol,
      documentId,
      handeling: 'toegang_geweigerd',
      motivering: `Nazicht geweigerd: ${fout.boodschap}`,
      uitkomst: 'geweigerd',
    });
    return { uitkomst: 'geweigerd', fout };
  };

  if (rol !== 'dossierbeheerder') {
    return weiger({ code: 'geen_rechten', boodschap: 'Enkel een dossierbeheerder kan nazicht afhandelen.' });
  }
  const document = documenten.haal(documentId);
  if (!document) {
    return weiger({ code: 'niet_gevonden', boodschap: 'Onbekend document.' });
  }
  if (document.status !== 'in_nazicht') {
    return weiger({ code: 'niet_in_nazicht', boodschap: 'Dit document staat niet in nazicht.' });
  }
  if (motivering.trim().length < MINIMALE_MOTIVERING) {
    return weiger({
      code: 'motivering_ontbreekt',
      boodschap: `Een motivering van minstens ${MINIMALE_MOTIVERING} tekens is verplicht.`,
    });
  }
  if (audit.isAanbieder(documentId, actor)) {
    return weiger({
      code: 'vier_ogen',
      boodschap: 'Wie een document zelf aanbood, mag het nazicht ervan niet zelf afhandelen.',
    });
  }

  let classificatie: Classificatie = document.classificatie;
  if (beslissing.beslissing === 'herclassificeren') {
    if (!isClassificatie(beslissing.classificatie)) {
      return weiger({ code: 'classificatie_ongeldig', boodschap: 'Onbekende classificatie.' });
    }
    classificatie = beslissing.classificatie;
  }

  const regel = beleidVoor(classificatie);
  const bewarenTot = vervaldatum(classificatie, new Date(document.aangemaakt_op)).toISOString();

  // Het bestand verhuist naar de map van de nieuwe classificatie. Het pad komt
  // uit de databank, de doelmap uit het beleid; niets uit het verzoek.
  const oudPad = document.opslagpad;
  const doelmap = join(opslagwortel, regel.opslagmap);
  const nieuwPad = join(doelmap, basename(oudPad));
  if (nieuwPad !== oudPad) {
    if (!existsSync(doelmap)) {
      mkdirSync(doelmap, { recursive: true });
      chmodSync(doelmap, 0o700); // dezelfde afscherming als bij de eerste opslag
    }
    renameSync(oudPad, nieuwPad);
  }

  const vorige = document.classificatie;
  const samenvatting =
    beslissing.beslissing === 'bevestigen'
      ? `Classificatie '${vorige}' bevestigd na nazicht.`
      : `Geherclassificeerd van '${vorige}' naar '${classificatie}' na nazicht.`;

  try {
    db.transaction(() => {
      documenten.werkBij(documentId, {
        classificatie,
        zekerheid: 'zeker',
        status: 'definitief_opgeslagen',
        opslagpad: nieuwPad,
        toegang: JSON.stringify(regel.toegang),
        bewaren_tot: bewarenTot,
        beleidsversie: BELEIDSVERSIE,
      });
      audit.schrijf({
        actor,
        rol,
        documentId,
        handeling: 'nazicht_afgehandeld',
        classificatie,
        zekerheid: 'zeker',
        motivering: `${samenvatting} Motivering: ${motivering.trim()} ` +
          `Opgeslagen in '${regel.opslagmap}', toegang: ${regel.toegang.join(', ')}, bewaren tot ${bewarenTot.slice(0, 10)}.`,
        beleidsversie: BELEIDSVERSIE,
        uitkomst: 'geslaagd',
      });
    })();
  } catch (fout) {
    if (nieuwPad !== oudPad) {
      mkdirSync(dirname(oudPad), { recursive: true });
      renameSync(nieuwPad, oudPad);
    }
    throw fout;
  }

  return { uitkomst: 'afgehandeld', documentId, classificatie, opslagmap: regel.opslagmap };
}
