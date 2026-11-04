import { describe, it, expect } from 'vitest';
import {
  valideerBestand,
  bepaalMimetype,
  valideerMetadata,
  MAXIMUM_BYTES,
  MAXIMUM_TITEL,
} from '../src/domein/validatie.js';

const tekst = Buffer.from('Een gewone nota zonder bijzonderheden.', 'utf8');

describe('bestandsvalidatie', () => {
  it('aanvaardt een gewoon tekstbestand', () => {
    expect(valideerBestand('nota.txt', tekst)).toBeNull();
  });

  it('weigert een leeg bestand', () => {
    expect(valideerBestand('nota.txt', Buffer.alloc(0))?.code).toBe('bestand_leeg');
  });

  it('weigert een bestand boven de maximale grootte', () => {
    const groot = Buffer.alloc(MAXIMUM_BYTES + 1, 'a');
    expect(valideerBestand('nota.txt', groot)?.code).toBe('bestand_te_groot');
  });

  it('weigert een extensie die niet op de witte lijst staat', () => {
    expect(valideerBestand('nota.exe', tekst)?.code).toBe(
      'bestandstype_niet_toegestaan',
    );
  });

  it('weigert een binair bestand dat zich als tekst voordoet', () => {
    // Een Windows-programma begint met 'MZ' en bevat nul-bytes.
    const programma = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    expect(valideerBestand('nota.txt', programma)?.code).toBe(
      'inhoud_past_niet_bij_type',
    );
  });

  it('weigert een PDF die niet met de PDF-handtekening begint', () => {
    expect(valideerBestand('scan.pdf', tekst)?.code).toBe(
      'inhoud_past_niet_bij_type',
    );
  });

  it('aanvaardt een PDF met de juiste handtekening', () => {
    const pdf = Buffer.from('%PDF-1.7\n...', 'latin1');
    expect(valideerBestand('scan.pdf', pdf)).toBeNull();
  });

  it('aanvaardt een scan als PNG of JPEG met de juiste handtekening', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(valideerBestand('scan.png', png)).toBeNull();
    expect(valideerBestand('scan.jpg', jpeg)).toBeNull();
  });

  it('weigert een bestand dat zich als afbeelding voordoet', () => {
    expect(valideerBestand('scan.png', tekst)?.code).toBe(
      'inhoud_past_niet_bij_type',
    );
  });
});

describe('metadatavalidatie', () => {
  it('aanvaardt een gewone titel en bron', () => {
    expect(valideerMetadata('Nota archief', 'loket')).toBeNull();
  });

  it('weigert een lege of te lange titel', () => {
    expect(valideerMetadata('   ', 'loket')?.code).toBe('metadata_ongeldig');
    expect(valideerMetadata('x'.repeat(MAXIMUM_TITEL + 1), 'loket')?.code).toBe(
      'metadata_ongeldig',
    );
  });

  it('weigert een lege bron', () => {
    expect(valideerMetadata('Nota archief', '')?.code).toBe('metadata_ongeldig');
  });
});

describe('type uit de extensie', () => {
  it('leidt het type af uit de extensie, ongeacht wat de browser opgaf', () => {
    expect(bepaalMimetype('nota.md')).toBe('text/markdown');
    expect(bepaalMimetype('Scan.JPG')).toBe('image/jpeg');
    expect(bepaalMimetype('programma.exe')).toBeNull();
    expect(bepaalMimetype('zonder-extensie')).toBeNull();
  });
});
