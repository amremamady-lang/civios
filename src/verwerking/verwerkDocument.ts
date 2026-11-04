/**
 * De samenhang tussen de onderdelen.
 *
 * Dit is de enige plek waar validatie, classificatie, beleid, opslag en
 * auditlog elkaar tegenkomen. De onderdelen zelf kennen elkaar niet. Wie wil
 * weten hoe een document door het systeem stroomt, leest deze twee functies:
 *
 * - `maakVoorstel`    stap 1-3: valideren, classificeren, beleid opzoeken.
 *                     Slaat niets op; zo kan de gebruiker het voorgestelde
 *                     resultaat eerst bekijken.
 * - `verwerkDocument` stap 1-5: dezelfde drie stappen, plus opslaan en
 *                     registreren.
 *
 * Bij het opslaan wordt het voorstel bewust opnieuw berekend en niet
 * overgenomen van de browser. Anders zou iemand een voorstel kunnen aanpassen
 * naar 'publiek' voor hij op opslaan klikt.
 */

import { rmSync } from 'node:fs';
import { classificeerVeilig } from '../classificatie/classificeer.js';
import { leesTekst } from '../classificatie/tekstextractie.js';
import { zoekMetNerVeilig } from '../classificatie/ner.js';
import {
  beleidVoor,
  vervaldatum,
  BELEIDSVERSIE,
  type Beleidsregel,
  type Rol,
} from '../beleid/beleid.js';
import {
  valideerBestand,
  valideerMetadata,
  bepaalMimetype,
  type Validatiefout,
} from '../domein/validatie.js';
import { slaOp, STANDAARD_OPSLAGWORTEL } from '../opslag/bestandsopslag.js';
import { Auditlog } from '../audit/auditlog.js';
import { Documentenregister } from '../opslag/documenten.js';
import type { Db } from '../opslag/database.js';
import type { Classificatieresultaat, Documentmetadata } from '../domein/types.js';

export interface Aanbieding {
  inhoud: Buffer;
  bestandsnaam: string;
  /**
   * Het type zoals de browser het opgaf. Wordt enkel ter informatie
   * meegenomen; het werkelijke type volgt uit de extensie en de inhoud.
   */
  mimetype?: string;
  metadata: Documentmetadata;
  actor: string;
  rol: Rol;
}

export type Status = 'definitief_opgeslagen' | 'in_nazicht';

export type Voorstel =
  | { uitkomst: 'geweigerd'; fout: Validatiefout }
  | {
      uitkomst: 'voorstel';
      classificatie: Classificatieresultaat;
      regel: Beleidsregel;
      bewarenTot: string;
      status: Status;
    };

export type Verwerkingsresultaat =
  | { uitkomst: 'geweigerd'; fout: Validatiefout }
  | {
      uitkomst: 'opgeslagen';
      documentId: string;
      classificatie: Classificatieresultaat;
      status: Status;
      opslagmap: string;
      toegang: Rol[];
      bewarenTot: string;
    };

/**
 * Stap 1-3: wat zou er met dit document gebeuren? Schrijft niets weg, niet
 * naar de schijf en niet naar de databank.
 *
 * Asynchroon (`async`), omdat tekstherkenning op een scan even duurt.
 */
export async function maakVoorstel(
  aanbieding: Omit<Aanbieding, 'actor' | 'rol'>,
  nu: Date = new Date(),
): Promise<Voorstel> {
  const { inhoud, bestandsnaam, metadata } = aanbieding;

  // 1. Validatie. Het type volgt uit de extensie en wordt tegen de inhoud
  //    gecontroleerd; wat de browser als type opgaf, wordt niet vertrouwd.
  const fout =
    valideerBestand(bestandsnaam, inhoud) ?? valideerMetadata(metadata.titel, metadata.bron);
  if (fout) return { uitkomst: 'geweigerd', fout };
  const mimetype = bepaalMimetype(bestandsnaam) as string;

  // 2. Classificatie. Faalt dit, dan volgt de strengste categorie.
  //    Een scan wordt met tekstherkenning gelezen. Kan de tekst niet
  //    betrouwbaar gelezen worden (een PDF, of een slechte of mislukte scan),
  //    dan is ze leeg en valt de classificatie terug op 'gevoelig' en
  //    'in nazicht'.
  //    Namen en adressen zonder vaste vorm komen van het taalmodel. Faalt dat,
  //    dan gaat het document naar nazicht en wordt het nooit publiek.
  const gelezen = await leesTekst(inhoud, mimetype);
  const namen = await zoekMetNerVeilig(gelezen.tekst);
  const classificatie = classificeerVeilig(gelezen.tekst, metadata, {
    herkomst: gelezen.herkomst === 'ocr' ? 'ocr' : 'tekst',
    extraSignalen: namen.signalen,
    naamherkenning: namen.gelukt,
  });

  // 3. Beleid raadplegen: waar hoort dit, wie mag erbij, hoelang bewaren.
  const regel = beleidVoor(classificatie.classificatie);
  const bewarenTot = vervaldatum(classificatie.classificatie, nu).toISOString();

  // Een onzekere classificatie wordt niet als afgehandeld beschouwd: het
  // document wordt veilig opgeslagen, maar vraagt menselijk nazicht.
  const status: Status = classificatie.zekerheid === 'onzeker' ? 'in_nazicht' : 'definitief_opgeslagen';

  return { uitkomst: 'voorstel', classificatie, regel, bewarenTot, status };
}

/** Stap 1-5: het voorstel opnieuw berekenen, opslaan en registreren. */
export async function verwerkDocument(
  db: Db,
  aanbieding: Aanbieding,
  opslagwortel: string = STANDAARD_OPSLAGWORTEL,
): Promise<Verwerkingsresultaat> {
  const audit = new Auditlog(db);
  const documenten = new Documentenregister(db);
  const { inhoud, bestandsnaam, metadata, actor, rol } = aanbieding;

  audit.schrijf({ actor, rol, handeling: 'document_aangeboden', uitkomst: 'geslaagd' });

  // Stap 1-3. Een geweigerd bestand wordt nooit weggeschreven.
  const voorstel = await maakVoorstel(aanbieding);
  if (voorstel.uitkomst === 'geweigerd') {
    audit.schrijf({
      actor,
      rol,
      handeling: 'validatie_geweigerd',
      motivering: voorstel.fout.boodschap,
      uitkomst: 'geweigerd',
    });
    return voorstel;
  }
  const { classificatie: resultaat, regel, bewarenTot, status } = voorstel;
  const mimetype = bepaalMimetype(bestandsnaam) as string;

  // 4. Opslaan in de map die bij de classificatie hoort.
  const opgeslagen = slaOp(inhoud, bestandsnaam, regel.opslagmap, opslagwortel);

  // 5. Registreren: de documentregel en de twee auditregels gaan samen in één
  //    transactie (alles of niets). Lukt dat niet, dan wordt ook het bestand
  //    weer verwijderd, zodat er geen document op schijf staat zonder spoor.
  const registreer = db.transaction(() => {
    documenten.voegToe({
      id: opgeslagen.documentId,
      titel: metadata.titel,
      bron: metadata.bron,
      bestandsnaam,
      mimetype,
      grootte_bytes: inhoud.byteLength,
      sha256: opgeslagen.sha256,
      classificatie: resultaat.classificatie,
      zekerheid: resultaat.zekerheid,
      status,
      opslagpad: opgeslagen.pad,
      toegang: JSON.stringify(regel.toegang),
      bewaren_tot: bewarenTot,
      beleidsversie: BELEIDSVERSIE,
      aangemaakt_op: new Date().toISOString(),
    });

    // Het spoor vastleggen: de classificatie en de opslagbeslissing apart,
    // zodat achteraf zichtbaar is waarom een document staat waar het staat.
    audit.schrijf({
      actor,
      rol,
      documentId: opgeslagen.documentId,
      handeling: 'geclassificeerd',
      classificatie: resultaat.classificatie,
      zekerheid: resultaat.zekerheid,
      signalen: resultaat.signalen,
      motivering: resultaat.motivering,
      beleidsversie: BELEIDSVERSIE,
      uitkomst: 'geslaagd',
    });

    audit.schrijf({
      actor,
      rol,
      documentId: opgeslagen.documentId,
      handeling: status === 'in_nazicht' ? 'in_nazicht_geplaatst' : 'opgeslagen',
      classificatie: resultaat.classificatie,
      motivering: `Opgeslagen in '${regel.opslagmap}', toegang: ${regel.toegang.join(', ')}, bewaren tot ${bewarenTot.slice(0, 10)}.`,
      beleidsversie: BELEIDSVERSIE,
      uitkomst: 'geslaagd',
    });
  });

  try {
    registreer();
  } catch (fout) {
    rmSync(opgeslagen.pad, { force: true });
    throw fout;
  }

  return {
    uitkomst: 'opgeslagen',
    documentId: opgeslagen.documentId,
    classificatie: resultaat,
    status,
    opslagmap: regel.opslagmap,
    toegang: regel.toegang,
    bewarenTot,
  };
}
