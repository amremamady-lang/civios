/**
 * Autorisatie: wie is dit, en mag die dit zien?
 *
 * De identiteit komt uit een ondertekend token in de header
 * `Authorization: Bearer <token>`. Wat de browser zelf beweert (bv. een
 * header met een rol) wordt nooit geloofd: enkel een token met een geldige
 * handtekening telt. Zonder token ben je een anonieme burger.
 *
 * In productie geeft de identiteitsprovider van het bestuur het token uit
 * (OpenID Connect). De rest van de applicatie werkt al met een `Identiteit`
 * en hoeft dan niet te wijzigen.
 */

import { magInkijken, type Rol } from '../beleid/beleid.js';
import type { Classificatie } from '../domein/types.js';
import { verifieerToken } from './token.js';

/** De rol waarop we terugvallen: de minst bevoorrechte, nooit de hoogste. */
export const STANDAARDROL: Rol = 'burger';

export interface Identiteit {
  gebruiker: string;
  rol: Rol;
  /** Nummer en vervaltijd van het token; ontbreken bij een anonieme burger. */
  tokenId?: string;
  verlooptOp?: number;
}

/** Wie geen token meestuurt: een anonieme burger. */
export const ANONIEM: Identiteit = { gebruiker: 'anoniem', rol: STANDAARDROL };

/**
 * Bepaalt de identiteit uit de Authorization-header.
 *
 * - geen header           → anonieme burger
 * - geldig token          → gebruiker en rol uit het token
 * - ongeldig of verlopen  → 'ongeldig', zodat de API om een nieuwe
 *                           aanmelding kan vragen in plaats van stil
 *                           door te gaan met minder rechten
 */
export function bepaalIdentiteit(
  authorization: unknown,
  geheim: string,
  nu: number = Date.now(),
): Identiteit | 'ongeldig' {
  if (typeof authorization !== 'string' || authorization.trim() === '') return ANONIEM;
  if (!authorization.startsWith('Bearer ')) return 'ongeldig';

  const inhoud = verifieerToken(authorization.slice('Bearer '.length).trim(), geheim, nu);
  return inhoud
    ? { gebruiker: inhoud.sub, rol: inhoud.rol, tokenId: inhoud.jti, verlooptOp: inhoud.exp }
    : 'ongeldig';
}

export interface Toegangsbeslissing {
  toegestaan: boolean;
  reden: string;
}

/** Mag deze rol dit document inkijken? */
export function beoordeelToegang(
  rol: Rol,
  classificatie: Classificatie,
): Toegangsbeslissing {
  if (magInkijken(rol, classificatie)) {
    return { toegestaan: true, reden: `Rol '${rol}' heeft toegang tot '${classificatie}'.` };
  }
  return {
    toegestaan: false,
    reden: `Rol '${rol}' heeft geen toegang tot documenten met classificatie '${classificatie}'.`,
  };
}

/** Alleen wie voor het bestuur werkt, mag documenten aanbieden. */
export function magAanbieden(rol: Rol): boolean {
  return rol === 'medewerker' || rol === 'dossierbeheerder';
}
