/**
 * Databaseverbinding en schema.
 *
 * Voor dit prototype is gekozen voor SQLite: de beoordelaar kan de toepassing
 * draaien zonder databaseserver of container, en de opslag blijft lokaal en
 * afgeschermd zoals de opdracht vraagt. De toegang tot gegevens loopt enkel
 * via `Documentenregister` (hiernaast) en `Auditlog`, zodat een overstap naar
 * PostgreSQL beperkt blijft tot die twee klassen. Zie ARCHITECTUUR.md voor de
 * afweging.
 */

import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashVanRegel, type Auditrij } from '../audit/auditlog.js';

const hier = dirname(fileURLToPath(import.meta.url));

export type Db = Database.Database;

export function maakDatabase(pad: string): Db {
  if (pad !== ':memory:') mkdirSync(dirname(pad), { recursive: true });

  const db = new Database(pad);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  voegHashKettingToe(db);
  db.exec(readFileSync(join(hier, 'schema.sql'), 'utf8'));
  return db;
}

/**
 * Eenmalige migratie voor een databank van vóór de hash-ketting: voegt de
 * kolommen toe en rekent de ketting over de bestaande regels uit. De triggers
 * worden daarvoor even opgeheven en door `schema.sql` meteen weer aangemaakt.
 * Een nieuwe of lege databank slaat dit over.
 */
function voegHashKettingToe(db: Db): void {
  const bestaat = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'auditlog'")
    .get();
  if (!bestaat) return;
  const kolommen = (db.pragma('table_info(auditlog)') as { name: string }[]).map((k) => k.name);
  if (kolommen.includes('hash')) return;

  console.warn('Auditlog zonder hash-ketting gevonden: ketting wordt eenmalig aangemaakt.');
  db.transaction(() => {
    db.exec('DROP TRIGGER IF EXISTS auditlog_geen_wijziging');
    db.exec('ALTER TABLE auditlog ADD COLUMN vorige_hash TEXT');
    db.exec("ALTER TABLE auditlog ADD COLUMN hash TEXT NOT NULL DEFAULT ''");
    const rijen = db.prepare('SELECT * FROM auditlog ORDER BY id ASC').all() as Auditrij[];
    const werkBij = db.prepare('UPDATE auditlog SET vorige_hash = ?, hash = ? WHERE id = ?');
    let vorige: string | null = null;
    for (const rij of rijen) {
      const { id, hash: _oud, ...rest } = rij;
      const hash = hashVanRegel({ ...rest, vorige_hash: vorige });
      werkBij.run(vorige, hash, id);
      vorige = hash;
    }
  })();
}
