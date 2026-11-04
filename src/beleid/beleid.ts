/**
 * Het opslagbeleid: wat volgt er uit een classificatie?
 *
 * De koppeling tussen classificatie en opslaglocatie, toegangsniveau en
 * bewaartermijn staat hier als gegeven, niet als code verspreid over de
 * applicatie. Een functioneel beheerder kan de tabel aanpassen; de logica
 * eromheen blijft gelijk. De versie wordt mee in het auditlog geschreven,
 * zodat later te achterhalen valt onder welke regels een beslissing viel.
 */

import type { Classificatie } from '../domein/types.js';

export const BELEIDSVERSIE = '2026-11-03.1';

/** Rollen in dit prototype. In productie komen die uit de identiteitsprovider. */
export const ROLLEN = ['burger', 'medewerker', 'dossierbeheerder'] as const;
export type Rol = (typeof ROLLEN)[number];

export interface Beleidsregel {
  /** Map onder de afgeschermde opslagwortel. */
  opslagmap: string;
  /** Rollen die het document mogen inkijken. */
  toegang: Rol[];
  /** Bewaartermijn in dagen. */
  bewaartermijnDagen: number;
  /** Mag dit document publiek ontsloten worden? */
  publiekToegankelijk: boolean;
  toelichting: string;
}

/**
 * De bewaartermijnen hieronder zijn fictieve, configureerbare waarden voor
 * dit prototype: 10, 7, 5 en 3 jaar. De lijn erin is dataminimalisatie:
 * hoe gevoeliger het document, hoe korter het bewaard wordt; publieke
 * informatie heeft archiefwaarde en blijft het langst. In een echt bestuur
 * komen de termijnen uit de selectielijst en de archiefwetgeving, niet uit
 * de applicatie.
 */
export const BELEID: Record<Classificatie, Beleidsregel> = {
  publiek: {
    opslagmap: 'publiek',
    toegang: ['burger', 'medewerker', 'dossierbeheerder'],
    bewaartermijnDagen: 3650,
    publiekToegankelijk: true,
    toelichting: 'Mag publiek ontsloten worden.',
  },
  intern: {
    opslagmap: 'intern',
    toegang: ['medewerker', 'dossierbeheerder'],
    bewaartermijnDagen: 2555,
    publiekToegankelijk: false,
    toelichting: 'Enkel intern toegankelijk.',
  },
  persoonsgegevens: {
    opslagmap: 'persoonsgegevens',
    // Beperkte toegang: wie voor het bestuur werkt, niet de burger.
    toegang: ['medewerker', 'dossierbeheerder'],
    bewaartermijnDagen: 1825,
    publiekToegankelijk: false,
    toelichting: 'Beveiligde opslag met beperkte toegang.',
  },
  gevoelige_persoonsgegevens: {
    opslagmap: 'gevoelig',
    // Minimale toegang: enkel de dossierbeheerder.
    toegang: ['dossierbeheerder'],
    bewaartermijnDagen: 1095,
    publiekToegankelijk: false,
    toelichting: 'Strikt beveiligde opslag met minimale toegang.',
  },
};

export function beleidVoor(classificatie: Classificatie): Beleidsregel {
  return BELEID[classificatie];
}

/** Berekent de vervaldatum op basis van de bewaartermijn. */
export function vervaldatum(classificatie: Classificatie, vanaf: Date): Date {
  const regel = beleidVoor(classificatie);
  const datum = new Date(vanaf);
  datum.setDate(datum.getDate() + regel.bewaartermijnDagen);
  return datum;
}

/** Mag deze rol een document met deze classificatie inkijken? */
export function magInkijken(rol: Rol, classificatie: Classificatie): boolean {
  return beleidVoor(classificatie).toegang.includes(rol);
}
