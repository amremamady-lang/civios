/**
 * Sessiebeheer: twee kleine lijsten die de aanmelding beschermen.
 *
 * - **Blokkering** na te veel mislukte aanmeldingen voor dezelfde gebruiker
 *   vanaf hetzelfde adres, zodat wachtwoorden niet massaal geraden kunnen
 *   worden.
 * - **Ingetrokken tokens**: wie afmeldt, maakt zijn token meteen waardeloos,
 *   ook al is het nog niet verlopen.
 *
 * Beide leven in het geheugen van dit ene proces en ruimen zichzelf op. In
 * productie, met meerdere servers, hoort dit bij de identiteitsprovider of een
 * gedeelde opslag; de rest van de applicatie merkt daar niets van.
 */

export const MAX_POGINGEN = 5;
export const BLOKKEERTIJD_MS = 15 * 60 * 1000;

export class Sessiebeheer {
  private mislukkingen = new Map<string, { aantal: number; tot: number }>();
  private ingetrokken = new Map<string, number>();

  /** Aantal seconden dat deze sleutel nog geblokkeerd is, of 0. */
  geblokkeerd(sleutel: string, nu = Date.now()): number {
    const r = this.mislukkingen.get(sleutel);
    if (!r) return 0;
    if (nu > r.tot) {
      this.mislukkingen.delete(sleutel);
      return 0;
    }
    return r.aantal >= MAX_POGINGEN ? Math.ceil((r.tot - nu) / 1000) : 0;
  }

  registreerMislukking(sleutel: string, nu = Date.now()): void {
    const r = this.mislukkingen.get(sleutel);
    if (!r || nu > r.tot) this.mislukkingen.set(sleutel, { aantal: 1, tot: nu + BLOKKEERTIJD_MS });
    else r.aantal++;
  }

  registreerSucces(sleutel: string): void {
    this.mislukkingen.delete(sleutel);
  }

  /** Trekt een token in tot zijn vervaltijd; verlopen tokens worden vergeten. */
  trekIn(tokenId: string, verlooptOp: number, nu = Date.now()): void {
    this.ingetrokken.set(tokenId, verlooptOp);
    const nuSeconden = Math.floor(nu / 1000);
    for (const [id, exp] of this.ingetrokken) if (exp <= nuSeconden) this.ingetrokken.delete(id);
  }

  isIngetrokken(tokenId: string): boolean {
    return this.ingetrokken.has(tokenId);
  }
}
