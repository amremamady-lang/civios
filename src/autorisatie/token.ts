/**
 * Ondertekende toegangsbewijzen (tokens).
 *
 * Een token is een JWT (JSON Web Token) met drie delen, gescheiden door een
 * punt: kop.inhoud.handtekening. De inhoud zegt wie je bent en welke rol je
 * hebt. De handtekening is berekend met een geheim dat enkel de server kent
 * (HMAC-SHA256). Verandert iemand ook maar één teken aan de inhoud, bv. de
 * rol naar 'dossierbeheerder', dan klopt de handtekening niet meer en wordt
 * het token geweigerd.
 *
 * In productie geeft de identiteitsprovider van het bestuur het token uit
 * (OpenID Connect). De controle hieronder blijft dan hetzelfde principe.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { ROLLEN, type Rol } from '../beleid/beleid.js';

/** Hoe lang een aanmelding geldig blijft: één werkdag. */
export const GELDIGHEID_SECONDEN = 8 * 60 * 60;

export interface Tokeninhoud {
  /** De gebruiker ('subject'). */
  sub: string;
  rol: Rol;
  /** Uitgegeven op, in seconden sinds 1970. */
  iat: number;
  /** Verloopt op, in seconden sinds 1970. */
  exp: number;
  /** Uniek nummer van dit token, zodat het afzonderlijk ingetrokken kan worden. */
  jti: string;
}

function onderteken(tekst: string, geheim: string): Buffer {
  return createHmac('sha256', geheim).update(tekst).digest();
}

function base64url(tekst: string): string {
  return Buffer.from(tekst, 'utf8').toString('base64url');
}

export function maakToken(
  gebruiker: string,
  rol: Rol,
  geheim: string,
  nu: number = Date.now(),
): string {
  const iat = Math.floor(nu / 1000);
  const kop = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const inhoud = base64url(
    JSON.stringify({ sub: gebruiker, rol, iat, exp: iat + GELDIGHEID_SECONDEN, jti: randomUUID() }),
  );
  const handtekening = onderteken(`${kop}.${inhoud}`, geheim).toString('base64url');
  return `${kop}.${inhoud}.${handtekening}`;
}

/**
 * Controleert een token en geeft de inhoud terug, of `null` als het token
 * vervalst, beschadigd of verlopen is. Er wordt nooit iets uit de inhoud
 * geloofd vóór de handtekening gecontroleerd is.
 */
export function verifieerToken(
  token: string,
  geheim: string,
  nu: number = Date.now(),
): Tokeninhoud | null {
  const delen = token.split('.');
  if (delen.length !== 3) return null;
  const [kop, inhoud, handtekening] = delen;

  // 1. De handtekening. timingSafeEqual vergelijkt altijd even snel, zodat
  //    een aanvaller niet uit de antwoordtijd kan afleiden hoeveel tekens
  //    van zijn vervalste handtekening al juist zijn.
  const verwacht = onderteken(`${kop}.${inhoud}`, geheim);
  const gekregen = Buffer.from(handtekening, 'base64url');
  if (gekregen.length !== verwacht.length || !timingSafeEqual(gekregen, verwacht)) {
    return null;
  }

  // 2. Pas nu de inhoud lezen.
  let gegevens: Partial<Tokeninhoud>;
  try {
    gegevens = JSON.parse(Buffer.from(inhoud, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (
    typeof gegevens.sub !== 'string' ||
    !(ROLLEN as readonly string[]).includes(gegevens.rol as string) ||
    typeof gegevens.iat !== 'number' ||
    typeof gegevens.exp !== 'number' ||
    typeof gegevens.jti !== 'string'
  ) {
    return null;
  }

  // 3. Verlopen?
  if (gegevens.exp <= Math.floor(nu / 1000)) return null;

  return gegevens as Tokeninhoud;
}
