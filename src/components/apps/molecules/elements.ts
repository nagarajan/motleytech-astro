/**
 * A small element table, big enough to build the molecules people actually want to
 * build and no bigger.
 *
 * Two radii per element, because the picture needs both. `covalent` sets bond
 * lengths: the distance between two nuclei is taken as the sum of their covalent
 * radii, which is where that number comes from in the first place. `waals` is the
 * van der Waals radius, and it sets the transparent shell — the distance at which
 * another atom starts to feel unwelcome.
 *
 * Radii are in angstroms, and the whole scene is built in those units.
 *
 * `electronegativity` is the Pauling scale, used for nothing but deciding whether a
 * bond is drawn as covalent or ionic. `valence` is the number of bonds the element
 * usually makes; the builder never enforces it, it just mentions when you go past.
 *
 * Colours are the Jmol palette, which is what most chemistry software uses, so the
 * models here look like the ones in a textbook.
 */
export interface Element {
  symbol: string;
  name: string;
  number: number;
  covalent: number;
  waals: number;
  electronegativity: number;
  valence: number;
  colour: string;
  group: ElementGroup;
}

export type ElementGroup = 'organic' | 'halogen' | 'metal' | 'other';

const TABLE: Element[] = [
  // symbol, name, Z, covalent, waals, EN, valence, colour, group
  el('H', 'Hydrogen', 1, 0.37, 1.2, 2.2, 1, '#f5f7fa', 'organic'),
  el('C', 'Carbon', 6, 0.77, 1.7, 2.55, 4, '#909090', 'organic'),
  el('N', 'Nitrogen', 7, 0.75, 1.55, 3.04, 3, '#3050f8', 'organic'),
  el('O', 'Oxygen', 8, 0.73, 1.52, 3.44, 2, '#ff0d0d', 'organic'),
  el('F', 'Fluorine', 9, 0.71, 1.47, 3.98, 1, '#90e050', 'halogen'),
  el('Cl', 'Chlorine', 17, 0.99, 1.75, 3.16, 1, '#1ff01f', 'halogen'),
  el('Br', 'Bromine', 35, 1.14, 1.85, 2.96, 1, '#a62929', 'halogen'),
  el('I', 'Iodine', 53, 1.33, 1.98, 2.66, 1, '#940094', 'halogen'),
  el('Li', 'Lithium', 3, 1.34, 1.82, 0.98, 1, '#cc80ff', 'metal'),
  el('Na', 'Sodium', 11, 1.54, 2.27, 0.93, 1, '#ab5cf2', 'metal'),
  el('K', 'Potassium', 19, 1.96, 2.75, 0.82, 1, '#8f40d4', 'metal'),
  el('Mg', 'Magnesium', 12, 1.3, 1.73, 1.31, 2, '#8aff00', 'metal'),
  el('Ca', 'Calcium', 20, 1.74, 2.31, 1.0, 2, '#3dff00', 'metal'),
  el('Al', 'Aluminium', 13, 1.18, 1.84, 1.61, 3, '#bfa6a6', 'metal'),
  el('Fe', 'Iron', 26, 1.25, 2.04, 1.83, 6, '#e06633', 'metal'),
  el('Cu', 'Copper', 29, 1.38, 1.96, 1.9, 4, '#c88033', 'metal'),
  el('Zn', 'Zinc', 30, 1.31, 2.01, 1.65, 4, '#7d80b0', 'metal'),
  el('B', 'Boron', 5, 0.82, 1.92, 2.04, 3, '#ffb5b5', 'other'),
  el('Si', 'Silicon', 14, 1.11, 2.1, 1.9, 4, '#f0c8a0', 'other'),
  el('P', 'Phosphorus', 15, 1.06, 1.8, 2.19, 3, '#ff8000', 'other'),
  el('S', 'Sulfur', 16, 1.02, 1.8, 2.58, 2, '#ffff30', 'other'),
  el('Se', 'Selenium', 34, 1.16, 1.9, 2.55, 2, '#ffa100', 'other'),
];

function el(
  symbol: string,
  name: string,
  number: number,
  covalent: number,
  waals: number,
  electronegativity: number,
  valence: number,
  colour: string,
  group: ElementGroup,
): Element {
  return { symbol, name, number, covalent, waals, electronegativity, valence, colour, group };
}

const BY_SYMBOL = new Map(TABLE.map((entry) => [entry.symbol, entry]));

export const ELEMENTS: readonly Element[] = TABLE;

export const GROUP_NAMES: Record<ElementGroup, string> = {
  organic: 'Organic',
  halogen: 'Halogens',
  metal: 'Metals',
  other: 'Others',
};

export const GROUP_ORDER: ElementGroup[] = ['organic', 'halogen', 'metal', 'other'];

/** Anything off the table falls back to carbon, so a corrupt save cannot break the scene. */
export function element(symbol: string): Element {
  return BY_SYMBOL.get(symbol) ?? BY_SYMBOL.get('C')!;
}

export function known(symbol: string): boolean {
  return BY_SYMBOL.has(symbol);
}
