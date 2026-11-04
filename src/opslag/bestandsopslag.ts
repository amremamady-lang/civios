/**
 * Fysieke opslag van het bestand.
 *
 * Deze module weet niets van classificeren. Ze krijgt te horen in welke map
 * een bestand hoort en zorgt dat het daar veilig terechtkomt. De keuze van
 * de map ligt bij het beleid, niet hier.
 */

import { mkdirSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

/**
 * De opslagwortel staat buiten de webroot. Niets in deze map wordt door de
 * applicatie rechtstreeks als statisch bestand uitgeserveerd; opvragen kan
 * enkel via een endpoint dat eerst de rol controleert.
 *
 * Deze module leest zelf geen configuratie. De wortel wordt meegegeven door
 * wie de module gebruikt (zoals de databank aan `maakApp`), zodat
 * configuratie op één plek gelezen wordt: in `web/server.ts`.
 */
export const STANDAARD_OPSLAGWORTEL = './opslag-test';

/** Haalt padscheidingen en rare tekens uit een aangeleverde bestandsnaam. */
export function veiligeBestandsnaam(naam: string): string {
  const basis = naam.split(/[\\/]/).pop() ?? 'document';
  const schoon = basis.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  return schoon.length > 0 ? schoon : 'document';
}

export function hashVan(inhoud: Buffer): string {
  return createHash('sha256').update(inhoud).digest('hex');
}

export interface OpgeslagenBestand {
  documentId: string;
  pad: string;
  sha256: string;
}

export function slaOp(
  inhoud: Buffer,
  oorspronkelijkeNaam: string,
  map: string,
  opslagwortel: string,
): OpgeslagenBestand {
  const doelmap = join(opslagwortel, map);
  if (!existsSync(doelmap)) {
    mkdirSync(doelmap, { recursive: true });
  }
  // Alleen de eigenaar van het proces mag in de map. Op Windows heeft dit
  // geen effect; daar regelt het besturingssysteem de rechten via ACL's.
  try {
    chmodSync(doelmap, 0o700);
  } catch {
    /* rechten niet instelbaar op dit platform; zie ARCHITECTUUR.md */
  }

  const documentId = randomUUID();
  const naam = veiligeBestandsnaam(oorspronkelijkeNaam);
  const pad = join(doelmap, `${documentId}${extname(naam) || ''}`);

  writeFileSync(pad, inhoud, { mode: 0o600 });

  return { documentId, pad, sha256: hashVan(inhoud) };
}
