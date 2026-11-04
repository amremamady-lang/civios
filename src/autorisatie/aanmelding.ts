/**
 * Testaanmelding: gebruikersnaam en wachtwoord controleren.
 *
 * Dit speelt in het prototype de rol van de identiteitsprovider van het
 * bestuur. In productie verdwijnt dit bestand: medewerkers melden zich aan
 * via het centrale systeem (OpenID Connect), en die geeft het token uit.
 *
 * Alle accounts zijn fictief. Wachtwoorden worden nooit leesbaar bewaard,
 * enkel als scrypt-hash met een eigen zout per account. scrypt is bewust
 * traag, zodat het raden van wachtwoorden veel rekentijd kost.
 */

import { scryptSync, timingSafeEqual } from 'node:crypto';
import type { Rol } from '../beleid/beleid.js';

interface Testaccount {
  gebruikersnaam: string;
  rol: Rol;
  zout: string;
  hash: string;
}

/** Wachtwoorden staan in de README (fictieve testgegevens). */
const TESTACCOUNTS: Testaccount[] = [
  {
    gebruikersnaam: 'j.peeters',
    rol: 'medewerker',
    zout: 'ee4fd2184599ad7407e40075ea18e288',
    hash: '0699e034198b1b2dc962f43ae8301bfd4598f391e224dd938de19c89532134d7',
  },
  {
    gebruikersnaam: 'm.claes',
    rol: 'dossierbeheerder',
    zout: '994a5546d039501547015c47e19e4b59',
    hash: 'fbf8843cc34e9481907edbb9685f189f4e26e169628db6da225d83eeb34fffdd',
  },
];

/** Geeft de rol terug bij een juiste aanmelding, anders `null`. */
export function controleerAanmelding(gebruikersnaam: string, wachtwoord: string): Rol | null {
  const account = TESTACCOUNTS.find((a) => a.gebruikersnaam === gebruikersnaam);

  // Ook voor een onbestaande gebruiker wordt een hash berekend. Zo duurt elk
  // antwoord even lang en verraadt de antwoordtijd niet welke gebruikers-
  // namen bestaan.
  const berekend = scryptSync(wachtwoord, account?.zout ?? 'onbekende-gebruiker', 32);
  if (!account) return null;

  return timingSafeEqual(berekend, Buffer.from(account.hash, 'hex')) ? account.rol : null;
}
