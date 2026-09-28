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
 * `most` is the largest number of bonds the element carries without it being worth a remark. It
 * is not the same as `valence` and could not be: sulfur usually makes two bonds and quite
 * happily makes six, xenon usually makes none and makes four in the molecule this program is
 * often used to draw. For the transition metals it is the coordination number, which is a
 * different kind of fact — it is not derivable from counting anything, it is looked up.
 *
 * `flat` is the one place this table overrules the geometry. Four things around an atom arrange
 * themselves as a tetrahedron, and for copper(II) they do not: they arrange themselves as a
 * square, for reasons that live in the d orbitals and are invisible to anything counting
 * electron pairs. So it is recorded as a fact about copper rather than predicted.
 *
 * `ion` is the other radius that matters, and it is the one that stops the picture lying.
 * Sodium's van der Waals radius really is larger than chlorine's — 2.27 against 1.75 — so
 * drawing neutral atoms puts a big sodium next to a small chlorine, which is the opposite of
 * table salt. Sodium gives an electron away and loses its outermost shell completely, ending up
 * at 1.02; chlorine takes one on and swells to 1.81. These are Shannon's effective ionic radii
 * at six-fold coordination, the numbers crystallographers actually use.
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
  /** The most bonds this element carries unremarkably; for a metal, its coordination number. */
  most: number;
  /** A coordination number at which this element is square planar rather than tetrahedral. */
  flat?: number;
  /** The ion this element usually forms, when it forms one: its charge and its radius. */
  ion?: { charge: number; radius: number };
  colour: string;
  group: ElementGroup;
}

export type ElementGroup = 'organic' | 'halogen' | 'metal' | 'other';

const TABLE: Element[] = [
  main('H', 'Hydrogen', 1, 0.37, 1.2, 2.2, 1, 1, '#f5f7fa', 'organic', 1),
  main('C', 'Carbon', 6, 0.77, 1.7, 2.55, 4, 4, '#909090', 'organic', 4),
  main('N', 'Nitrogen', 7, 0.75, 1.55, 3.04, 3, 5, '#3050f8', 'organic', 4, [-3, 1.46]),
  main('O', 'Oxygen', 8, 0.73, 1.52, 3.44, 2, 6, '#ff0d0d', 'organic', 3, [-2, 1.4]),
  main('F', 'Fluorine', 9, 0.71, 1.47, 3.98, 1, 7, '#90e050', 'halogen', 1, [-1, 1.33]),
  main('Cl', 'Chlorine', 17, 0.99, 1.75, 3.16, 1, 7, '#1ff01f', 'halogen', 4, [-1, 1.81]),
  main('Br', 'Bromine', 35, 1.14, 1.85, 2.96, 1, 7, '#a62929', 'halogen', 5, [-1, 1.96]),
  main('I', 'Iodine', 53, 1.33, 1.98, 2.66, 1, 7, '#940094', 'halogen', 7, [-1, 2.2]),
  main('Li', 'Lithium', 3, 1.34, 1.82, 0.98, 1, 1, '#cc80ff', 'metal', 1, [1, 0.76]),
  main('Na', 'Sodium', 11, 1.54, 2.27, 0.93, 1, 1, '#ab5cf2', 'metal', 1, [1, 1.02]),
  main('K', 'Potassium', 19, 1.96, 2.75, 0.82, 1, 1, '#8f40d4', 'metal', 1, [1, 1.38]),
  main('Mg', 'Magnesium', 12, 1.3, 1.73, 1.31, 2, 2, '#8aff00', 'metal', 2, [2, 0.72]),
  main('Ca', 'Calcium', 20, 1.74, 2.31, 1.0, 2, 2, '#3dff00', 'metal', 2, [2, 1.0]),
  main('Al', 'Aluminium', 13, 1.18, 1.84, 1.61, 3, 3, '#bfa6a6', 'metal', 4, [3, 0.535]),
  metal('Fe', 'Iron', 26, 1.25, 2.04, 1.83, 6, '#e06633', 6, [2, 0.78]),
  metal('Cu', 'Copper', 29, 1.38, 1.96, 1.9, 4, '#c88033', 4, [2, 0.73], 4),
  metal('Zn', 'Zinc', 30, 1.31, 2.01, 1.65, 4, '#7d80b0', 4, [2, 0.74]),
  main('B', 'Boron', 5, 0.82, 1.92, 2.04, 3, 3, '#ffb5b5', 'other', 4, [3, 0.27]),
  main('Si', 'Silicon', 14, 1.11, 2.1, 1.9, 4, 4, '#f0c8a0', 'other', 6, [4, 0.4]),
  main('P', 'Phosphorus', 15, 1.06, 1.8, 2.19, 3, 5, '#ff8000', 'other', 5),
  main('S', 'Sulfur', 16, 1.02, 1.8, 2.58, 2, 6, '#ffff30', 'other', 6, [-2, 1.84]),
  main('Se', 'Selenium', 34, 1.16, 1.9, 2.55, 2, 6, '#ffa100', 'other', 6, [-2, 1.98]),
  main('Xe', 'Xenon', 54, 1.3, 2.16, 2.6, 0, 8, '#429eb0', 'other', 6),
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
  most: number,
  ion?: [number, number],
): Element {
  return {
    symbol,
    name,
    number,
    covalent,
    waals,
    electronegativity,
    valence,
    electrons,
    block: 'main',
    most,
    ion: ion ? { charge: ion[0], radius: ion[1] } : undefined,
    colour,
    group,
  };
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
  most: number,
  ion?: [number, number],
  flat?: number,
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
    most,
    flat,
    ion: ion ? { charge: ion[0], radius: ion[1] } : undefined,
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

/**
 * How big to draw the transparent shell: the van der Waals radius normally, the ionic radius
 * once the atom is carrying a charge of the sign it would ordinarily carry.
 *
 * Only the sign is checked, not the size of the charge. A doubly charged sodium is not a thing
 * anyone should be drawing, and pretending to know its radius would be worse than reusing the
 * one for Na+.
 */
export function shellOf(symbol: string, charge = 0): number {
  const info = element(symbol);
  if (charge !== 0 && info.ion && Math.sign(charge) === Math.sign(info.ion.charge)) {
    return info.ion.radius;
  }
  return info.waals;
}
