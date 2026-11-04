/**
 * Controle van het aangeboden bestand, vóór er iets mee gebeurt.
 *
 * De lijst met toegestane types is een witte lijst, geen zwarte lijst: wat er
 * niet in staat, wordt geweigerd. Een zwarte lijst is altijd onvolledig.
 */

export const TOEGESTANE_TYPES: Record<string, string[]> = {
  'text/plain': ['.txt'],
  'text/markdown': ['.md'],
  'application/pdf': ['.pdf'],
  // Scans komen vaak binnen als afbeelding.
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
};

/**
 * Bepaalt het type uit de extensie van de bestandsnaam, volgens de witte
 * lijst. Het type dat de browser meestuurt, wordt bewust niet gebruikt: dat is
 * een bewering van de aanbieder, en Windows stuurt voor sommige bestanden
 * (bv. '.md') gewoon 'application/octet-stream'. De extensie bepaalt wat we
 * verwachten; de inhoudscontrole hieronder bewijst of dat klopt.
 */
export function bepaalMimetype(bestandsnaam: string): string | null {
  const extensie = bestandsnaam.slice(bestandsnaam.lastIndexOf('.')).toLowerCase();
  for (const [mimetype, extensies] of Object.entries(TOEGESTANE_TYPES)) {
    if (extensies.includes(extensie)) return mimetype;
  }
  return null;
}

export const MAXIMUM_BYTES = 10 * 1024 * 1024; // 10 MB

export const MAXIMUM_TITEL = 200;
export const MAXIMUM_BRON = 100;

export interface Validatiefout {
  code:
    | 'bestandstype_niet_toegestaan'
    | 'inhoud_past_niet_bij_type'
    | 'bestand_te_groot'
    | 'bestand_leeg'
    | 'metadata_ongeldig';
  /** Boodschap in gewone taal, bedoeld om aan de gebruiker te tonen. */
  boodschap: string;
}

/**
 * Het type dat de browser meestuurt, is een bewering van de aanbieder. Deze
 * controle kijkt naar de inhoud zelf. Binaire formaten beginnen altijd met
 * een vaste handtekening ('magic bytes'): een PDF met '%PDF-', een JPEG met
 * FF D8 FF, een PNG met 89 'PNG'. Een tekstbestand bevat geen nul-bytes (die
 * komen enkel in binaire bestanden voor). Zo wordt een hernoemd programma
 * niet als '.txt' of '.png' aanvaard.
 */
const HANDTEKENINGEN: Record<string, Buffer> = {
  'application/pdf': Buffer.from('%PDF-', 'latin1'),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

function inhoudPastBijType(inhoud: Buffer, mimetype: string): boolean {
  const handtekening = HANDTEKENINGEN[mimetype];
  if (handtekening) {
    return inhoud.subarray(0, handtekening.length).equals(handtekening);
  }
  return !inhoud.includes(0);
}

/**
 * Controleert het bestand. Het type wordt uit de extensie afgeleid
 * (`bepaalMimetype`); het type dat de browser opgaf, speelt geen rol.
 */
export function valideerBestand(bestandsnaam: string, inhoud: Buffer): Validatiefout | null {
  const grootteBytes = inhoud.byteLength;
  if (grootteBytes <= 0) {
    return {
      code: 'bestand_leeg',
      boodschap: 'Het bestand is leeg. Kies een document met inhoud.',
    };
  }

  if (grootteBytes > MAXIMUM_BYTES) {
    const mb = (grootteBytes / 1024 / 1024).toFixed(1);
    return {
      code: 'bestand_te_groot',
      boodschap: `Het bestand is ${mb} MB. De maximale grootte is ${MAXIMUM_BYTES / 1024 / 1024} MB.`,
    };
  }

  const mimetype = bepaalMimetype(bestandsnaam);
  if (!mimetype) {
    return {
      code: 'bestandstype_niet_toegestaan',
      boodschap:
        'Dit bestandstype wordt niet aanvaard. Toegestaan zijn: ' +
        Object.values(TOEGESTANE_TYPES).flat().join(', ') +
        '.',
    };
  }

  if (!inhoudPastBijType(inhoud, mimetype)) {
    return {
      code: 'inhoud_past_niet_bij_type',
      boodschap:
        'De inhoud van het bestand komt niet overeen met het bestandstype. ' +
        'Controleer of u het juiste bestand gekozen hebt.',
    };
  }

  return null;
}

/** Controle van de metadata die de aanbieder meegeeft. */
export function valideerMetadata(titel: string, bron: string): Validatiefout | null {
  if (titel.trim().length === 0 || titel.length > MAXIMUM_TITEL) {
    return {
      code: 'metadata_ongeldig',
      boodschap: `De titel is verplicht en mag maximaal ${MAXIMUM_TITEL} tekens lang zijn.`,
    };
  }
  if (bron.trim().length === 0 || bron.length > MAXIMUM_BRON) {
    return {
      code: 'metadata_ongeldig',
      boodschap: `De bron is verplicht en mag maximaal ${MAXIMUM_BRON} tekens lang zijn.`,
    };
  }
  return null;
}
