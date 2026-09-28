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
 * `electrons` is the count of valence electrons, which is what lets the program work out
 * how many lone pairs an atom is carrying and therefore why water is bent. For the s and
 * p block it is the group number in the old reckoning: 1 for hydrogen and the alkali
 * metals, 4 for carbon, 6 for oxygen, 7 for the halogens.
 *
 * `block` matters because that calculation only works for the main group. Electron
 * counting on a transition metal does not predict its shape — that is ligand field
 * territory — so iron, copper and zinc are marked and excluded from it.
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
  electrons: number;
  block: 'main' | 'transition';
  colour: string;
  group: ElementGroup;
}

export type ElementGroup = 'organic' | 'halogen' | 'metal' | 'other';

const TABLE: Element[] = [
  main('H', 'Hydrogen', 1, 0.37, 1.2, 2.2, 1, 1, '#f5f7fa', 'organic'),
  main('C', 'Carbon', 6, 0.77, 1.7, 2.55, 4, 4, '#909090', 'organic'),
  main('N', 'Nitrogen', 7, 0.75, 1.55, 3.04, 3, 5, '#3050f8', 'organic'),
  main('O', 'Oxygen', 8, 0.73, 1.52, 3.44, 2, 6, '#ff0d0d', 'organic'),
  main('F', 'Fluorine', 9, 0.71, 1.47, 3.98, 1, 7, '#90e050', 'halogen'),
  main('Cl', 'Chlorine', 17, 0.99, 1.75, 3.16, 1, 7, '#1ff01f', 'halogen'),
  main('Br', 'Bromine', 35, 1.14, 1.85, 2.96, 1, 7, '#a62929', 'halogen'),
  main('I', 'Iodine', 53, 1.33, 1.98, 2.66, 1, 7, '#940094', 'halogen'),
  main('Li', 'Lithium', 3, 1.34, 1.82, 0.98, 1, 1, '#cc80ff', 'metal'),
  main('Na', 'Sodium', 11, 1.54, 2.27, 0.93, 1, 1, '#ab5cf2', 'metal'),
  main('K', 'Potassium', 19, 1.96, 2.75, 0.82, 1, 1, '#8f40d4', 'metal'),
  main('Mg', 'Magnesium', 12, 1.3, 1.73, 1.31, 2, 2, '#8aff00', 'metal'),
  main('Ca', 'Calcium', 20, 1.74, 2.31, 1.0, 2, 2, '#3dff00', 'metal'),
  main('Al', 'Aluminium', 13, 1.18, 1.84, 1.61, 3, 3, '#bfa6a6', 'metal'),
  metal('Fe', 'Iron', 26, 1.25, 2.04, 1.83, 6, '#e06633'),
  metal('Cu', 'Copper', 29, 1.38, 1.96, 1.9, 4, '#c88033'),
  metal('Zn', 'Zinc', 30, 1.31, 2.01, 1.65, 4, '#7d80b0'),
  main('B', 'Boron', 5, 0.82, 1.92, 2.04, 3, 3, '#ffb5b5', 'other'),
  main('Si', 'Silicon', 14, 1.11, 2.1, 1.9, 4, 4, '#f0c8a0', 'other'),
  main('P', 'Phosphorus', 15, 1.06, 1.8, 2.19, 3, 5, '#ff8000', 'other'),
  main('S', 'Sulfur', 16, 1.02, 1.8, 2.58, 2, 6, '#ffff30', 'other'),
  main('Se', 'Selenium', 34, 1.16, 1.9, 2.55, 2, 6, '#ffa100', 'other'),
  main('Xe', 'Xenon', 54, 1.3, 2.16, 2.6, 0, 8, '#429eb0', 'other'),
];

function main(
  symbol: string,
  name: string,
  number: number,
  covalent: number,
  waals: number,
  electronegativity: number,
  valence: number,
  electrons: number,
  colour: string,
  group: ElementGroup,
): Element {
  return { symbol, name, number, covalent, waals, electronegativity, valence, electrons, block: 'main', colour, group };
}

function metal(
  symbol: string,
  name: string,
  number: number,
  covalent: number,
  waals: number,
  electronegativity: number,
  valence: number,
  colour: string,
): Element {
  return {
    symbol,
    name,
    number,
    covalent,
    waals,
    electronegativity,
    valence,
    // Never used: the d block is excluded from lone-pair counting.
    electrons: 0,
    block: 'transition',
    colour,
    group: 'metal',
  };
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
