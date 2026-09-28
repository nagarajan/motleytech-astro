/**
 * The element table, and the oxidation states that go with the ones that have a choice.
 *
 * Two radii per element, because the picture needs both. `covalent` sets bond
 * lengths: the distance between two nuclei is taken as the sum of their covalent
 * radii, which is where that number comes from in the first place. `waals` is the
 * van der Waals radius, and it sets the transparent shell — the distance at which
 * another atom starts to feel unwelcome. The van der Waals radii for the metals are
 * Batsanov's, which is the set the first three came from.
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
 * territory — so the d block is marked and excluded from it.
 *
 * `most` is the largest number of bonds the element carries without it being worth a remark. It
 * is not the same as `valence` and could not be: sulfur usually makes two bonds and quite
 * happily makes six, xenon usually makes none and makes four in the molecule this program is
 * often used to draw. For a transition metal it is the coordination number, which is a
 * different kind of fact — it is not derivable from counting anything, it is looked up.
 *
 * Colours are the Jmol palette, which is what most chemistry software uses, so the
 * models here look like the ones in a textbook.
 *
 *
 * ## Why the oxidation states had to become a list
 *
 * For a long time this table had one ionic radius and one coordination number per element, and
 * for the main group that is very nearly the truth. Sodium is Na+ and nothing else worth
 * drawing. Chloride is Cl-. Magnesium is Mg2+.
 *
 * The d block is not like that, and cobalt is the shortest way to see it. Co(II) has an ionic
 * radius of 0.745 A and sits happily with four ligands or six. Co(III) has a radius of 0.545 —
 * a quarter smaller, because it is low spin and the electrons have paired into the lower
 * orbitals — and is octahedral essentially always. Those are not two approximations of one
 * number. They are two different substances, they are both ordinary, and a table with one slot
 * has to either pick one and be wrong about the other or refuse to have cobalt in it.
 *
 * So `states` holds them all, commonest first, and an atom's formal charge chooses between
 * them. That is not a new concept bolted on: an oxidation state *is* a formal charge, atoms
 * have carried one since the day charges were added, and it is already saved and already
 * derived from ionic bonds. The picker in the panel is only offering the values that mean
 * something for that element rather than any integer.
 *
 * Two honest limitations, both worth stating rather than hiding.
 *
 * Every radius here is Shannon's effective ionic radius at *six-fold* coordination, including
 * for the states that are not six-coordinate. Shannon tabulates by coordination number as well
 * — silver(I) is 1.15 at six but 0.67 at two — and quoting one column is a choice. It is the
 * column everybody quotes, it is the only one that is complete, and mixing columns would mean
 * the sizes on screen were no longer comparable with each other. A two-coordinate cation is
 * therefore drawn somewhat too large.
 *
 * And `coordination` is the commonest case, not the only one. Nickel(II) is six-coordinate
 * octahedral in most of its salts and four-coordinate *square* in the cyanide, so it carries
 * both: `coordination` for what to expect and `flat` for the count at which the shape changes.
 * Beyond those two there is no mechanism here for "it depends", because there is no mechanism
 * here for ligand field strength, which is the thing it actually depends on.
 */

/**
 * One oxidation state of one element: how big it is, how many things it usually gathers
 * around itself, and whether that arrangement is square rather than tetrahedral.
 */
export interface OxidationState {
  /** The charge. 3 for Co(III). */
  charge: number;
  /** Shannon effective ionic radius at six-fold coordination, in angstroms. */
  radius: number;
  /** The number of ligands this state usually carries. */
  coordination: number;
  /**
   * A ligand count at which this state is square planar rather than tetrahedral. Usually the
   * same as `coordination`, and deliberately separate from it for nickel(II), which is
   * ordinarily octahedral and square only when it happens to have four.
   */
  flat?: number;
  /** Shown beside the charge in the panel: 'low spin', 'permanganate', and so on. */
  note?: string;
}

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
  /**
   * Every oxidation state worth offering, commonest first, or empty for an element that does
   * not usefully ionise. The first entry is the one `most`, `flat` and `ion` report.
   */
  states: OxidationState[];
  colour: string;
  group: ElementGroup;
}

export type ElementGroup = 'organic' | 'halogen' | 'metal' | 'transition' | 'other';

/** Shorthand for one row of the states list. */
function st(
  charge: number,
  radius: number,
  coordination: number,
  extra: { flat?: number; note?: string } = {},
): OxidationState {
  return { charge, radius, coordination, ...extra };
}

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

  // The first transition row, complete. The states are the ones a first course meets: the
  // aqua ions, the oxoanions at the top of the row, and cobalt(III), which is the reason
  // any of this became a list.
  metal('Sc', 'Scandium', 21, 1.44, 2.15, 1.36, '#e6e6e6', [st(3, 0.745, 6)]),
  metal('Ti', 'Titanium', 22, 1.36, 2.11, 1.54, '#bfc2c7', [
    st(4, 0.605, 6),
    st(3, 0.67, 6, { note: 'the violet aqua ion' }),
  ]),
  metal('V', 'Vanadium', 23, 1.25, 2.07, 1.63, '#a6a6ab', [
    st(3, 0.64, 6),
    st(4, 0.58, 6),
    st(5, 0.54, 4, { note: 'vanadate' }),
  ]),
  metal('Cr', 'Chromium', 24, 1.27, 2.06, 1.66, '#8a99c7', [
    st(3, 0.615, 6, { note: 'inert, and famously slow to swap a ligand' }),
    st(2, 0.8, 6, { note: 'high spin' }),
    st(6, 0.44, 4, { note: 'chromate' }),
  ]),
  metal('Mn', 'Manganese', 25, 1.39, 2.05, 1.55, '#9c7ac7', [
    st(2, 0.83, 6, { note: 'high spin' }),
    st(4, 0.53, 6),
    st(7, 0.46, 4, { note: 'permanganate' }),
  ]),
  metal('Fe', 'Iron', 26, 1.25, 2.04, 1.83, '#e06633', [
    st(2, 0.78, 6, { note: 'high spin' }),
    st(3, 0.645, 6, { note: 'high spin' }),
  ]),
  metal('Co', 'Cobalt', 27, 1.26, 2.0, 1.88, '#f090a0', [
    st(2, 0.745, 6, { note: 'high spin' }),
    st(3, 0.545, 6, { note: 'low spin, and a quarter smaller for it' }),
  ]),
  metal('Ni', 'Nickel', 28, 1.21, 1.97, 1.91, '#50d050', [
    st(2, 0.69, 6, { flat: 4, note: 'octahedral, but square on the four-coordinate ones' }),
  ]),
  metal('Cu', 'Copper', 29, 1.38, 1.96, 1.9, '#c88033', [
    st(2, 0.73, 4, { flat: 4, note: 'square planar' }),
    st(1, 0.77, 4),
  ]),
  metal('Zn', 'Zinc', 30, 1.31, 2.01, 1.65, '#7d80b0', [st(2, 0.74, 4)]),

  // A few from further down, chosen because each one is the standard example of something:
  // molybdate, the square planar platinum of cisplatin, linear silver and gold.
  metal('Mo', 'Molybdenum', 42, 1.45, 2.11, 2.16, '#54b5b5', [
    st(6, 0.59, 4, { note: 'molybdate' }),
    st(4, 0.65, 6),
  ]),
  metal('Pd', 'Palladium', 46, 1.31, 2.02, 2.2, '#006985', [st(2, 0.86, 4, { flat: 4 })]),
  metal('Ag', 'Silver', 47, 1.45, 2.03, 1.93, '#c0c0c0', [
    st(1, 1.15, 2, { note: 'linear, as in the diammine' }),
  ]),
  metal('Cd', 'Cadmium', 48, 1.44, 2.18, 1.69, '#ffd98f', [st(2, 0.95, 6)]),
  metal('W', 'Tungsten', 74, 1.37, 2.1, 2.36, '#2194d6', [st(6, 0.6, 6), st(4, 0.66, 6)]),
  metal('Pt', 'Platinum', 78, 1.36, 2.06, 2.28, '#d0d0e0', [
    st(2, 0.8, 4, { flat: 4, note: 'square planar, as in cisplatin' }),
    st(4, 0.625, 6),
  ]),
  metal('Au', 'Gold', 79, 1.36, 2.05, 2.54, '#ffd123', [
    st(3, 0.85, 4, { flat: 4 }),
    st(1, 1.37, 2, { note: 'linear' }),
  ]),
  metal('Hg', 'Mercury', 80, 1.32, 2.05, 2.0, '#b8b8d0', [
    st(2, 1.02, 2, { note: 'linear, which is unusual and real' }),
  ]),

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
    // A main-group element gets at most one, and its coordination is `most` rather than
    // anything about the ion: sulfur's ion is S2- and sulfur still manages six bonds.
    states: ion ? [st(ion[0], ion[1], most)] : [],
    colour,
    group,
  };
}

/**
 * A transition metal, which differs in that the shape and the size both come from the chosen
 * oxidation state rather than from counting electrons. `most`, `flat` and `ion` report the
 * first state in the list, so an atom nobody has assigned a charge to still behaves.
 */
function metal(
  symbol: string,
  name: string,
  number: number,
  covalent: number,
  waals: number,
  electronegativity: number,
  colour: string,
  states: OxidationState[],
): Element {
  const usual = states[0];
  return {
    symbol,
    name,
    number,
    covalent,
    waals,
    electronegativity,
    valence: usual.coordination,
    // Never used: the d block is excluded from lone-pair counting.
    electrons: 0,
    block: 'transition',
    most: usual.coordination,
    flat: usual.flat,
    ion: { charge: usual.charge, radius: usual.radius },
    states,
    colour,
    group: 'transition',
  };
}

const BY_SYMBOL = new Map(TABLE.map((entry) => [entry.symbol, entry]));

export const ELEMENTS: readonly Element[] = TABLE;

export const GROUP_NAMES: Record<ElementGroup, string> = {
  organic: 'Organic',
  halogen: 'Halogens',
  metal: 'Metals',
  transition: 'Transition metals',
  other: 'Others',
};

export const GROUP_ORDER: ElementGroup[] = ['organic', 'halogen', 'metal', 'transition', 'other'];

/** Anything off the table falls back to carbon, so a corrupt save cannot break the scene. */
export function element(symbol: string): Element {
  return BY_SYMBOL.get(symbol) ?? BY_SYMBOL.get('C')!;
}

export function known(symbol: string): boolean {
  return BY_SYMBOL.has(symbol);
}

/** The oxidation states worth offering for an element, commonest first. */
export function statesOf(symbol: string): readonly OxidationState[] {
  return element(symbol).states;
}

/**
 * The state an atom of this charge is in, if the table knows one.
 *
 * Exact on the charge, because that is the whole point: Co(II) and Co(III) are different
 * entries and picking the nearest would defeat the exercise.
 */
export function stateOf(symbol: string, charge: number): OxidationState | undefined {
  return element(symbol).states.find((state) => state.charge === charge);
}

/**
 * How big to draw the transparent shell: the van der Waals radius normally, the ionic radius
 * once the atom is carrying a charge it is known to carry.
 *
 * An exact match on the state comes first, so a cobalt(III) is drawn at 0.545 and a cobalt(II)
 * at 0.745. Failing that the sign is enough: a charge of the sign the element ordinarily takes
 * gets the usual ion's radius. A doubly charged sodium is not a thing anyone should be drawing,
 * and pretending to know its radius would be worse than reusing the one for Na+.
 */
export function shellOf(symbol: string, charge = 0): number {
  const info = element(symbol);
  if (charge === 0) return info.waals;

  const exact = stateOf(symbol, charge);
  if (exact) return exact.radius;

  if (info.ion && Math.sign(charge) === Math.sign(info.ion.charge)) return info.ion.radius;
  return info.waals;
}

/**
 * How many ligands this atom is expected to carry, which is what the crowding warning is
 * measured against. Iron(III) and iron(II) happen to agree at six; vanadium(V) gathers four
 * where vanadium(III) gathers six.
 */
export function coordinationOf(symbol: string, charge = 0): number {
  return stateOf(symbol, charge)?.coordination ?? element(symbol).most;
}

/**
 * The ligand count, if any, at which this atom is square planar rather than tetrahedral.
 *
 * The one place the table overrules the geometry, and now the one place it does so per
 * oxidation state: platinum(II) is square with four, platinum(IV) is octahedral with six, and
 * nothing about counting electron pairs could tell them apart.
 */
export function flatAt(symbol: string, charge = 0): number | undefined {
  const state = stateOf(symbol, charge);
  if (state) return state.flat;
  return element(symbol).flat;
}
