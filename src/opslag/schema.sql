-- Datamodel van het prototype.
--
-- Twee tabellen: wat er over een document bekend is, en wat er beslist is.
-- Het auditlog is bewust een aparte tabel en geen kolom op het document,
-- omdat een document meerdere beslissingen kan kennen en de geschiedenis
-- bewaard moet blijven ook als het document verdwijnt.

CREATE TABLE IF NOT EXISTS documenten (
  id                TEXT PRIMARY KEY,
  titel             TEXT    NOT NULL,
  bron              TEXT    NOT NULL,
  bestandsnaam      TEXT    NOT NULL,
  mimetype          TEXT    NOT NULL,
  grootte_bytes     INTEGER NOT NULL,
  sha256            TEXT    NOT NULL,
  classificatie     TEXT    NOT NULL,
  zekerheid         TEXT    NOT NULL,
  -- 'definitief_opgeslagen' of 'in_nazicht'.
  -- Dit veld is het aangrijpingspunt voor toekomstige tussenstappen in de
  -- levensloop van een document, zoals een goedkeuring door een medewerker.
  status            TEXT    NOT NULL,
  opslagpad         TEXT    NOT NULL,
  toegang           TEXT    NOT NULL,  -- JSON-lijst van rollen
  bewaren_tot       TEXT    NOT NULL,  -- ISO 8601
  beleidsversie     TEXT    NOT NULL,
  aangemaakt_op     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS auditlog (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tijdstip          TEXT NOT NULL,
  actor             TEXT NOT NULL,
  rol               TEXT NOT NULL,
  document_id       TEXT,
  handeling         TEXT NOT NULL,
  classificatie     TEXT,
  zekerheid         TEXT,
  -- Gemaskeerde signalen. Het auditlog legt vast DAT er een
  -- rijksregisternummer gevonden is, niet WELK nummer dat was.
  signalen          TEXT,
  motivering        TEXT,
  beleidsversie     TEXT,
  uitkomst          TEXT NOT NULL,
  -- Hash-ketting: elke regel bevat de hash van de vorige regel plus zichzelf.
  -- Wie een regel wijzigt of wist, ook met beheerdersrechten buiten de
  -- triggers om, breekt de ketting; dat is achteraf aantoonbaar.
  vorige_hash       TEXT,
  hash              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auditlog_document ON auditlog (document_id);
CREATE INDEX IF NOT EXISTS idx_documenten_bewaren_tot ON documenten (bewaren_tot);

-- Het auditlog is append-only, en dat wordt afgedwongen in de database zelf.
-- Zo blijft het spoor intact, ook wanneer iemand buiten de applicatie om een
-- regel zou willen bijwerken of wissen.
CREATE TRIGGER IF NOT EXISTS auditlog_geen_wijziging
BEFORE UPDATE ON auditlog
BEGIN
  SELECT RAISE(ABORT, 'Het auditlog is append-only: wijzigen is niet toegestaan.');
END;

CREATE TRIGGER IF NOT EXISTS auditlog_geen_verwijdering
BEFORE DELETE ON auditlog
BEGIN
  SELECT RAISE(ABORT, 'Het auditlog is append-only: verwijderen is niet toegestaan.');
END;
