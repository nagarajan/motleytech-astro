import { element, known } from './elements';
import {
  add,
  centre,
  openDirection,
  relaxBest,
  scale,
  sub,
  unit,
  vec,
  type RelaxBody,
  type Vec3,
} from './geometry';

export type BondKind = 'covalent' | 'ionic';

export interface Atom {
  id: number;
  symbol: string;
  position: Vec3;
}

export interface Bond {
  id: number;
  a: number;
  b: number;
  kind: BondKind;
}

export interface Molecule {
  atoms: Atom[];
  bonds: Bond[];
}

export const EMPTY: Molecule = { atoms: [], bonds: [] };

/**
 * The usual classroom line: a difference in electronegativity of about 1.8 or more and
 * the pair stops sharing and starts transferring. It is a convention rather than a fact
 * — real bonds shade smoothly from one to the other — but it is the convention that
 * decides which colour the cylinder gets, and you can always override it by hand.
 */
export const IONIC_GAP = 1.8;

/**
 * What the tidy-up button, the presets and ring closure use. Plain edits relax straight
 * downhill instead, so nothing jumps about while it is being built.
 */
export const TIDY_STEPS = 2000;

/** Hops cost time quadratically in the atom count, so spend fewer of them on big builds. */
export function tidyHops(atoms: number): number {
  return Math.max(6, Math.min(48, Math.round(560 / Math.max(1, atoms))));
}

/** The full search: what ring closure, the presets and the tidy-up button run. */
export function tidy(molecule: Molecule): Molecule {
  return settle(molecule, TIDY_STEPS, tidyHops(molecule.atoms.length));
}

export function suggestKind(first: string, second: string): BondKind {
  const gap = Math.abs(element(first).electronegativity - element(second).electronegativity);
  return gap >= IONIC_GAP ? 'ionic' : 'covalent';
}

export function bondLength(first: string, second: string): number {
  return element(first).covalent + element(second).covalent;
}

export function atomAt(molecule: Molecule, id: number): Atom | undefined {
  return molecule.atoms.find((atom) => atom.id === id);
}

export function bondsAt(molecule: Molecule, id: number): Bond[] {
  return molecule.bonds.filter((bond) => bond.a === id || bond.b === id);
}

export function neighboursOf(molecule: Molecule, id: number): Atom[] {
  return bondsAt(molecule, id)
    .map((bond) => atomAt(molecule, bond.a === id ? bond.b : bond.a))
    .filter((atom): atom is Atom => Boolean(atom));
}

export function areBonded(molecule: Molecule, first: number, second: number): boolean {
  return molecule.bonds.some(
    (bond) => (bond.a === first && bond.b === second) || (bond.a === second && bond.b === first),
  );
}

function nextId(items: Array<{ id: number }>): number {
  return items.reduce((highest, item) => Math.max(highest, item.id), 0) + 1;
}

/** Run the geometry engine over a molecule and hand back a new one. */
export function settle(molecule: Molecule, steps = 800, hops = 1): Molecule {
  const index = new Map(molecule.atoms.map((atom, position) => [atom.id, position]));
  const bodies: RelaxBody[] = molecule.atoms.map((atom) => ({
    position: atom.position,
    covalent: element(atom.symbol).covalent,
  }));
  const links = molecule.bonds
    .map((bond) => ({ a: index.get(bond.a)!, b: index.get(bond.b)! }))
    .filter((link) => link.a !== undefined && link.b !== undefined);

  relaxBest(bodies, links, steps, hops);

  return {
    atoms: molecule.atoms.map((atom, position) => ({ ...atom, position: bodies[position].position })),
    bonds: molecule.bonds,
  };
}

/**
 * Add an atom. With an anchor it arrives bonded, in the emptiest direction the anchor
 * has left; without one it arrives unbonded and clear of whatever is already there.
 */
export function addAtom(
  molecule: Molecule,
  symbol: string,
  anchorId: number | null,
  kind?: BondKind,
): { molecule: Molecule; id: number } {
  const id = nextId(molecule.atoms);
  const anchor = anchorId === null ? undefined : atomAt(molecule, anchorId);

  let position: Vec3;
  if (anchor) {
    const taken = neighboursOf(molecule, anchor.id).map((other) => sub(other.position, anchor.position));
    const away = openDirection(taken);
    position = add(anchor.position, scale(unit(away), bondLength(anchor.symbol, symbol)));
  } else {
    position = beside(molecule, symbol);
  }

  const atoms = [...molecule.atoms, { id, symbol, position }];
  const bonds = anchor
    ? [
        ...molecule.bonds,
        {
          id: nextId(molecule.bonds),
          a: anchor.id,
          b: id,
          kind: kind ?? suggestKind(anchor.symbol, symbol),
        },
      ]
    : molecule.bonds;

  return { molecule: settle({ atoms, bonds }), id };
}

/** Somewhere off to one side, far enough out that the new atom is not inside anything. */
function beside(molecule: Molecule, symbol: string): Vec3 {
  if (molecule.atoms.length === 0) return vec(0, 0, 0);
  let reach = 0;
  for (const atom of molecule.atoms) {
    reach = Math.max(reach, atom.position.x + element(atom.symbol).waals);
  }
  return vec(reach + element(symbol).waals + 0.6, 0, 0);
}

export type LinkResult = { molecule: Molecule; error?: undefined } | { molecule: Molecule; error: string };

export function linkAtoms(
  molecule: Molecule,
  first: number,
  second: number,
  kind?: BondKind,
): LinkResult {
  if (first === second) return { molecule, error: 'An atom cannot bond to itself.' };
  const a = atomAt(molecule, first);
  const b = atomAt(molecule, second);
  if (!a || !b) return { molecule, error: 'One of those atoms is gone.' };
  if (areBonded(molecule, first, second)) return { molecule, error: 'Those two are already bonded.' };

  const bonds = [
    ...molecule.bonds,
    { id: nextId(molecule.bonds), a: first, b: second, kind: kind ?? suggestKind(a.symbol, b.symbol) },
  ];
  // Closing a ring is exactly the edit that needs the search, so pay for it here.
  return { molecule: tidy({ atoms: molecule.atoms, bonds }) };
}

export function unlink(molecule: Molecule, bondId: number): Molecule {
  return settle({ atoms: molecule.atoms, bonds: molecule.bonds.filter((bond) => bond.id !== bondId) });
}

export function retypeBond(molecule: Molecule, bondId: number, kind: BondKind): Molecule {
  return {
    atoms: molecule.atoms,
    bonds: molecule.bonds.map((bond) => (bond.id === bondId ? { ...bond, kind } : bond)),
  };
}

export function deleteAtom(molecule: Molecule, id: number): Molecule {
  const atoms = molecule.atoms.filter((atom) => atom.id !== id);
  const bonds = molecule.bonds.filter((bond) => bond.a !== id && bond.b !== id);
  if (atoms.length === 0) return EMPTY;
  return settle({ atoms, bonds });
}

/** Hill notation: carbon, then hydrogen, then everything else alphabetically. */
export function formula(molecule: Molecule): Array<{ symbol: string; count: number }> {
  const tally = new Map<string, number>();
  for (const atom of molecule.atoms) {
    tally.set(atom.symbol, (tally.get(atom.symbol) ?? 0) + 1);
  }
  const rank = (symbol: string): number => (symbol === 'C' ? 0 : symbol === 'H' ? 1 : 2);
  return [...tally.entries()]
    .map(([symbol, count]) => ({ symbol, count }))
    .sort((left, right) => rank(left.symbol) - rank(right.symbol) || left.symbol.localeCompare(right.symbol));
}

export function formulaText(molecule: Molecule): string {
  return formula(molecule)
    .map(({ symbol, count }) => (count === 1 ? symbol : `${symbol}${count}`))
    .join('');
}

/** Atoms carrying more bonds than the element usually manages. Reported, never blocked. */
export function crowded(molecule: Molecule): Array<{ atom: Atom; bonds: number; usual: number }> {
  return molecule.atoms
    .map((atom) => ({ atom, bonds: bondsAt(molecule, atom.id).length, usual: element(atom.symbol).valence }))
    .filter((report) => report.bonds > report.usual);
}

export interface SavedMolecule {
  atoms: Array<{ e: string; x: number; y: number; z: number }>;
  bonds: Array<{ a: number; b: number; k: BondKind }>;
}

const PLACES = 1000;

export function encode(molecule: Molecule): SavedMolecule {
  const slot = new Map(molecule.atoms.map((atom, index) => [atom.id, index]));
  return {
    atoms: molecule.atoms.map((atom) => ({
      e: atom.symbol,
      x: Math.round(atom.position.x * PLACES) / PLACES,
      y: Math.round(atom.position.y * PLACES) / PLACES,
      z: Math.round(atom.position.z * PLACES) / PLACES,
    })),
    bonds: molecule.bonds.map((bond) => ({ a: slot.get(bond.a)!, b: slot.get(bond.b)!, k: bond.kind })),
  };
}

/** Rebuilt defensively: anything that does not make sense is dropped, not thrown. */
export function decode(raw: unknown): Molecule | null {
  if (!raw || typeof raw !== 'object') return null;
  const shape = raw as Partial<SavedMolecule>;
  if (!Array.isArray(shape.atoms) || !Array.isArray(shape.bonds)) return null;

  const atoms: Atom[] = [];
  shape.atoms.forEach((entry, index) => {
    if (!entry || typeof entry.e !== 'string' || !known(entry.e)) return;
    const { x, y, z } = entry;
    if (![x, y, z].every((value) => typeof value === 'number' && Number.isFinite(value))) return;
    atoms.push({ id: index + 1, symbol: entry.e, position: vec(x, y, z) });
  });
  if (atoms.length === 0) return null;

  const live = new Set(atoms.map((atom) => atom.id));
  const bonds: Bond[] = [];
  shape.bonds.forEach((entry) => {
    if (!entry) return;
    const a = entry.a + 1;
    const b = entry.b + 1;
    if (a === b || !live.has(a) || !live.has(b)) return;
    if (bonds.some((bond) => (bond.a === a && bond.b === b) || (bond.a === b && bond.b === a))) return;
    bonds.push({ id: bonds.length + 1, a, b, kind: entry.k === 'ionic' ? 'ionic' : 'covalent' });
  });

  const molecule = { atoms, bonds };
  centre(molecule.atoms.map((atom) => ({ position: atom.position, covalent: 0 })));
  return molecule;
}

interface Recipe {
  name: string;
  /** Each atom names the earlier atom it hangs off, by index, or null to start a piece. */
  atoms: Array<[symbol: string, bondTo: number | null]>;
  /** Extra bonds, for closing rings. */
  rings?: Array<[number, number]>;
  note: string;
}

const RECIPES: Recipe[] = [
  {
    name: 'Water',
    atoms: [['O', null], ['H', 0], ['H', 0]],
    note: 'Straight, not bent — the two lone pairs that squeeze real water down to 104° are not modelled here.',
  },
  {
    name: 'Methane',
    atoms: [['C', null], ['H', 0], ['H', 0], ['H', 0], ['H', 0]],
    note: 'Four things repelling on a sphere settle into a tetrahedron. Nobody told it 109.47°.',
  },
  {
    name: 'Carbon dioxide',
    atoms: [['C', null], ['O', 0], ['O', 0]],
    note: 'Two neighbours, so they go to opposite poles. Real CO₂ is straight too, and for the same reason.',
  },
  {
    name: 'Boron trifluoride',
    atoms: [['B', null], ['F', 0], ['F', 0], ['F', 0]],
    note: 'Three neighbours make a flat triangle at 120°, and boron has no lone pair to spoil it.',
  },
  {
    name: 'Benzene',
    atoms: [
      ['C', null], ['C', 0], ['C', 1], ['C', 2], ['C', 3], ['C', 4],
      ['H', 0], ['H', 1], ['H', 2], ['H', 3], ['H', 4], ['H', 5],
    ],
    rings: [[5, 0]],
    note: 'Close the ring and it flattens into a hexagon by itself.',
  },
  {
    name: 'Cyclohexane',
    atoms: [
      ['C', null], ['C', 0], ['C', 1], ['C', 2], ['C', 3], ['C', 4],
      ['H', 0], ['H', 0], ['H', 1], ['H', 1], ['H', 2], ['H', 2],
      ['H', 3], ['H', 3], ['H', 4], ['H', 4], ['H', 5], ['H', 5],
    ],
    rings: [[5, 0]],
    note: 'The same ring, but each carbon now wants 109° rather than 120°, so it buckles into a chair.',
  },
  {
    name: 'Ethanol',
    atoms: [
      ['C', null], ['C', 0], ['O', 1],
      ['H', 0], ['H', 0], ['H', 0], ['H', 1], ['H', 1], ['H', 2],
    ],
    note: 'Two tetrahedral carbons and an oxygen on the end.',
  },
  {
    name: 'Sulfur hexafluoride',
    atoms: [['S', null], ['F', 0], ['F', 0], ['F', 0], ['F', 0], ['F', 0], ['F', 0]],
    note: 'Six neighbours give an octahedron, which is also the answer to the six-point Thomson problem.',
  },
  {
    name: 'Table salt',
    atoms: [['Na', null], ['Cl', 0]],
    note: 'Sodium and chlorine differ by 2.23 on the Pauling scale, so the bond is drawn as ionic.',
  },
];

export interface Preset {
  name: string;
  note: string;
  build: () => Molecule;
}

export const PRESETS: Preset[] = RECIPES.map((recipe) => ({
  name: recipe.name,
  note: recipe.note,
  build: () => cook(recipe),
}));

function cook(recipe: Recipe): Molecule {
  let molecule = EMPTY;
  const ids: number[] = [];
  for (const [symbol, bondTo] of recipe.atoms) {
    const step = addAtom(molecule, symbol, bondTo === null ? null : ids[bondTo]);
    molecule = step.molecule;
    ids.push(step.id);
  }
  // Ring bonds go on without settling in between, so the one search at the end does all
  // the work rather than paying for it twice.
  const bonds = [...molecule.bonds];
  for (const [from, to] of recipe.rings ?? []) {
    bonds.push({ id: nextId(bonds), a: ids[from], b: ids[to], kind: 'covalent' });
  }
  return tidy({ atoms: molecule.atoms, bonds });
}
