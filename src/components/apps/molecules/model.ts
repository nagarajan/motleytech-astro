import { element, known } from './elements';
import {
  add,
  centre,
  cross,
  length,
  openDirection,
  perpendicular,
  relax,
  relaxBest,
  scale,
  sub,
  unit,
  vec,
  type RelaxBody,
  type RelaxLink,
  type Vec3,
} from './geometry';

export type BondKind = 'covalent' | 'ionic';

/**
 * How many electron pairs the bond holds. 1.5 is the aromatic case: benzene's ring bonds
 * are neither single nor double, and counting them as 1.5 each is what makes the electron
 * arithmetic on an aromatic carbon come out whole.
 */
export type BondOrder = 1 | 1.5 | 2 | 3;

export const BOND_ORDERS: BondOrder[] = [1, 1.5, 2, 3];

export const ORDER_NAMES: Record<BondOrder, string> = {
  1: 'single',
  1.5: 'aromatic',
  2: 'double',
  3: 'triple',
};

/**
 * Multiple bonds are shorter, and roughly by these factors. They reproduce the familiar
 * numbers: a C-C single bond at 1.54 A, the aromatic ring bond at 1.42, C=C at 1.32 and
 * C≡C at 1.20.
 */
const SQUEEZE: Record<BondOrder, number> = { 1: 1, 1.5: 0.92, 2: 0.86, 3: 0.78 };

export function squeezeOf(order: BondOrder): number {
  return SQUEEZE[order] ?? 1;
}

export interface Atom {
  id: number;
  symbol: string;
  position: Vec3;
  /** Formal charge. Ammonium's nitrogen is +1 and has no lone pair; hydroxide's oxygen is -1 and has three. */
  charge: number;
}

export interface Bond {
  id: number;
  a: number;
  b: number;
  kind: BondKind;
  order: BondOrder;
}

/**
 * A lone pair: derived, never authored. Recomputed from the electron count every time the
 * geometry settles, and deliberately not saved, because it is a consequence of the atoms
 * and bonds rather than a fact about them.
 */
export interface LonePair {
  /** The atom it belongs to. */
  atom: number;
  index: number;
  position: Vec3;
  /**
   * Whether this pair had any say in the shape. Only pairs on an atom with two or more bonds
   * do: on a terminal atom there is nothing to arrange, so the pair is placed afterwards
   * against a frozen molecule and is drawn more quietly to say so.
   */
  shaping: boolean;
}

export interface Molecule {
  atoms: Atom[];
  bonds: Bond[];
  lonePairs: LonePair[];
}

export const EMPTY: Molecule = { atoms: [], bonds: [], lonePairs: [] };

/**
 * How hard a lone pair shoves, with a bonding pair at 1.
 *
 * Not a guess: this is fitted, and to exactly one measurement. Water's H-O-H angle is
 * 104.5 degrees rather than the tetrahedral 109.47, and 1.2442 is the weight that closes
 * that gap. Everything else the lone pairs do is then a prediction — ammonia comes out at
 * 106.7 against a measured 106.7, which is the single best reason to believe the mechanism
 * is right rather than merely tuned.
 */
export const LONE_PAIR_WEIGHT = 1.2442;

/** Lone pairs are held closer in than bonding pairs. Affects only the drawing, not the angles. */
const LONE_PAIR_REACH = 0.78;

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
export function tidy(molecule: Molecule, options: SettleOptions = {}): Molecule {
  return settle(molecule, {
    steps: TIDY_STEPS,
    hops: tidyHops(molecule.atoms.length),
    ...options,
  });
}

export function suggestKind(first: string, second: string): BondKind {
  const gap = Math.abs(element(first).electronegativity - element(second).electronegativity);
  return gap >= IONIC_GAP ? 'ionic' : 'covalent';
}

export function bondLength(
  first: string,
  second: string,
  order: BondOrder = 1,
  kind: BondKind = 'covalent',
): number {
  // An ionic bond is two ions in contact, so its length is the sum of the ionic radii — 2.83 Å
  // for sodium chloride, which is what the crystal measures. Using covalent radii would give
  // 2.53, the length of a bond that in this case does not exist.
  if (kind === 'ionic') {
    const gap = ionicPair(first, second);
    if (gap) return gap;
  }
  return (element(first).covalent + element(second).covalent) * squeezeOf(order);
}

/** The sum of the two ionic radii, when both elements have one and the charges oppose. */
function ionicPair(first: string, second: string): number | null {
  const one = element(first).ion;
  const other = element(second).ion;
  if (!one || !other) return null;
  if (Math.sign(one.charge) === Math.sign(other.charge)) return null;
  return one.radius + other.radius;
}

/**
 * The ideal length of a bond as a fraction of the two covalent radii, which is the form the
 * relaxer wants it in: multiple bonds pull in, ionic bonds stand off at the ionic radii instead.
 */
function stretchOf(molecule: Molecule, bond: Bond): number {
  const a = atomAt(molecule, bond.a);
  const b = atomAt(molecule, bond.b);
  if (!a || !b) return squeezeOf(bond.order);
  const plain = element(a.symbol).covalent + element(b.symbol).covalent;
  return bondLength(a.symbol, b.symbol, bond.order, bond.kind) / plain;
}

/**
 * How many lone pairs an atom is carrying: its valence electrons, less its formal charge,
 * less the electrons it has put into bonds, divided into pairs.
 *
 * This is the piece that makes water bend, and it is also why bond order had to come
 * first. Carbon dioxide's carbon has four valence electrons and two double bonds, so
 * 4 - 4 = 0 lone pairs and the molecule stays straight. Count those same bonds as single
 * and you get one pair left over, a third thing to make room for, and a carbon dioxide
 * bent at 120 degrees — the model would have gone backwards.
 *
 * Only the main group. Electron counting does not predict the shape of a transition metal
 * complex, so the d block is given none and left alone.
 */
/**
 * An atom's charge: what was set by hand, plus what its ionic bonds have handed over.
 *
 * An ionic bond is one electron moving from the less electronegative atom to the more
 * electronegative one, so marking a bond ionic is the same statement as saying the two atoms are
 * now ions. Taking it as derived rather than stored means the two can never disagree: change a
 * bond from covalent to ionic and the charges follow, change it back and they follow back.
 */
export function chargeAt(molecule: Molecule, id: number): number {
  const atom = atomAt(molecule, id);
  if (!atom) return 0;

  let total = atom.charge;
  for (const bond of bondsAt(molecule, id)) {
    if (bond.kind !== 'ionic') continue;
    const other = atomAt(molecule, bond.a === id ? bond.b : bond.a);
    if (!other) continue;
    const mine = element(atom.symbol).electronegativity;
    const theirs = element(other.symbol).electronegativity;
    if (mine === theirs) continue;
    total += mine > theirs ? -1 : 1;
  }
  return total;
}

export function lonePairsAt(molecule: Molecule, id: number): number {
  const atom = atomAt(molecule, id);
  if (!atom) return 0;
  const info = element(atom.symbol);
  if (info.block !== 'main') return 0;

  // An ionic bond shares nothing, so it spends no electrons: the pair stays with whichever atom
  // won it. That is why chloride ends up with a full four lone pairs and sodium with none.
  const spent = bondsAt(molecule, id).reduce(
    (sum, bond) => sum + (bond.kind === 'ionic' ? 0 : bond.order),
    0,
  );
  const spare = info.electrons - chargeAt(molecule, id) - spent;
  return Math.max(0, Math.floor(spare / 2));
}

/** Bonds plus lone pairs: the number of things competing for room around an atom. */
export function domainsAt(molecule: Molecule, id: number): number {
  return bondsAt(molecule, id).length + lonePairsAt(molecule, id);
}

/**
 * The standard VSEPR name for what an atom's neighbourhood looks like, given how many
 * bonds and lone pairs it has. Reported in the panel so the shape on screen can be checked
 * against the shape it is supposed to be.
 */
export function shapeAt(molecule: Molecule, id: number): string {
  const bonds = bondsAt(molecule, id).length;
  const lones = lonePairsAt(molecule, id);
  // An atom with one bond has no arrangement to describe, however many lone pairs it holds,
  // so it is terminal and that is all there is to say about it.
  if (bonds === 1) return 'terminal';

  // Looked up rather than worked out, for the elements where working it out gives the wrong
  // answer. Copper is the whole reason this branch exists.
  const atom = atomAt(molecule, id);
  if (atom && element(atom.symbol).flat === bonds) return 'square planar';
  const table: Record<string, string> = {
    '2,0': 'linear',
    '2,1': 'bent',
    '2,2': 'bent',
    '2,3': 'linear',
    '3,0': 'trigonal planar',
    '3,1': 'trigonal pyramidal',
    '3,2': 'T-shaped',
    '4,0': 'tetrahedral',
    '4,1': 'see-saw',
    '4,2': 'square planar',
    '5,0': 'trigonal bipyramidal',
    '5,1': 'square pyramidal',
    '6,0': 'octahedral',
  };
  return table[`${bonds},${lones}`] ?? (bonds === 0 ? 'lone atom' : `${bonds} bonds`);
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

export interface SettleOptions {
  steps?: number;
  hops?: number;
  /**
   * Whether lone pairs take part. On by default; turning it off is what the playground's
   * toggle does, and it reproduces the older behaviour where water came out straight.
   */
  lonePairs?: boolean;
}

/**
 * Run the geometry engine over a molecule and hand back a new one.
 *
 * Lone pairs join the system as ordinary bodies: each one gets a short link to its atom so
 * the spring pins how far out it sits, a weight above 1 so it shoves harder than a bond,
 * and a ghost flag so it has no bulk and does not drag the centre around. After that the
 * existing machinery does the rest — the angle repulsion cannot tell a lone pair from an
 * atom, which is precisely the point.
 */
export function settle(molecule: Molecule, options: SettleOptions = {}): Molecule {
  const { steps = 800, hops = 1, lonePairs = true } = options;

  const index = new Map(molecule.atoms.map((atom, position) => [atom.id, position]));
  const bodies: RelaxBody[] = molecule.atoms.map((atom) => ({
    position: atom.position,
    covalent: element(atom.symbol).covalent,
  }));
  const links: RelaxLink[] = molecule.bonds
    .filter((bond) => index.has(bond.a) && index.has(bond.b))
    .map((bond) => ({
      a: index.get(bond.a)!,
      b: index.get(bond.b)!,
      squeeze: stretchOf(molecule, bond),
      // Anything above a single bond has pi character and so resists being twisted about. An
      // ionic bond has no shared pair to twist, so it is free either way.
      stiff: bond.kind === 'covalent' && bond.order >= 1.5,
    }));

  const ghosts: Array<{ atom: number; index: number; body: number; shaping: boolean }> = [];

  /**
   * Append the lone pairs of one atom as ghost bodies on a short link to it, seeded from
   * `source` — which is the molecule as given on the first pass, and the molecule as
   * settled on the second.
   */
  const hang = (source: Molecule, id: number, count: number, shaping: boolean): void => {
    const atom = atomAt(source, id)!;
    const home = index.get(atom.id)!;
    const reach = element(atom.symbol).covalent * LONE_PAIR_REACH;

    // If the molecule arrives with pairs already on this atom, start from where they are.
    // Settling has to be idempotent: re-running it on a molecule already at rest must not
    // change the answer, and throwing the pairs away to re-seed them from scratch does
    // exactly that, because the seed can land in a different basin to the one the molecule
    // is already sitting in.
    const already = molecule.lonePairs.filter((pair) => pair.atom === atom.id);
    const keep = already.length === count;

    for (let which = 0; which < count; which += 1) {
      const aim = keep
        ? sub(already[which].position, atom.position)
        : // Otherwise the emptiest direction left, counting the pairs already placed, so
          // the relaxation begins from somewhere plausible.
          openDirection([
            ...neighboursOf(source, atom.id).map((other) => sub(other.position, atom.position)),
            ...ghosts
              .filter((ghost) => ghost.atom === atom.id)
              .map((ghost) => sub(bodies[ghost.body].position, atom.position)),
          ]);

      bodies.push({
        position: add(atom.position, scale(unit(aim), reach)),
        covalent: reach,
        weight: LONE_PAIR_WEIGHT,
        ghost: true,
      });
      // The link's ideal length is the sum of the two covalent figures, so the atom
      // contributes its own radius and the pair contributes the rest.
      links.push({ a: home, b: bodies.length - 1, squeeze: reach / (element(atom.symbol).covalent + reach) });
      ghosts.push({ atom: atom.id, index: which, body: bodies.length - 1, shaping });
    }
  };

  // Which pairs shape the molecule and which merely decorate it. An atom with one bond has
  // no arrangement to make: rotating its pairs about that bond costs nothing, so their
  // position is a free parameter. Letting them into the main relaxation therefore feeds
  // meaningless noise into everything else — enough noise, it turns out, to cost xenon
  // tetrafluoride its square. They are placed afterwards instead, against a frozen molecule.
  const shaping: number[] = [];
  const trailing: number[] = [];
  if (lonePairs) {
    for (const atom of molecule.atoms) {
      if (lonePairsAt(molecule, atom.id) === 0) continue;
      (bondsAt(molecule, atom.id).length >= 2 ? shaping : trailing).push(atom.id);
    }
  }

  for (const id of shaping) hang(molecule, id, lonePairsAt(molecule, id), true);

  // The one place the element table overrules the geometry, and the one place this program is
  // told an answer instead of working one out.
  //
  // Four ligands on a copper(II) sit in a square rather than a tetrahedron, for reasons that live
  // in the d orbitals and are invisible to anything counting electron pairs.
  //
  // With two extra bodies above and below the plane the square is a perfectly good minimum here —
  // push a ligand a fifth of an angstrom out of plane and it springs straight back. What it is
  // not is the *lowest* minimum: a lopsided alternative sits one part in six thousand below it,
  // and the search, doing exactly what it is built to do, goes and finds it. So the two poles are
  // pinned, which stops it looking. The axis is an input, not a result, and pinning is the honest
  // way to say so.
  //
  // The poles shove like lone pairs because that is the only vocabulary this program has for
  // "something is sitting here", but they are not recorded as lone pairs afterwards, because they
  // are not lone pairs.
  for (const atom of molecule.atoms) {
    const info = element(atom.symbol);
    const attached = neighboursOf(molecule, atom.id);
    if (info.flat === undefined || attached.length !== info.flat) continue;

    const home = index.get(atom.id)!;
    const axis = unit(openDirection(attached.map((other) => sub(other.position, atom.position))));
    const sideways = perpendicular(axis);
    const other = cross(axis, sideways);

    // The ligands onto the corners of a square, each left at the distance it already had.
    attached.forEach((leg, corner) => {
      const seat = index.get(leg.id);
      if (seat === undefined) return;
      const span = length(sub(leg.position, atom.position)) || bondLength(atom.symbol, leg.symbol);
      const turn = (corner * Math.PI) / 2;
      bodies[seat].position = add(
        atom.position,
        scale(add(scale(sideways, Math.cos(turn)), scale(other, Math.sin(turn))), span),
      );
    });

    const reach = info.covalent * LONE_PAIR_REACH;
    for (const way of [axis, scale(axis, -1)]) {
      bodies.push({
        position: add(atom.position, scale(way, reach)),
        covalent: reach,
        weight: LONE_PAIR_WEIGHT,
        ghost: true,
        // Held still, which is the whole point. Left free they wander off to the lopsided
        // arrangement the energy marginally prefers, taking the ligands with them. Pinning them
        // is the honest version of what is happening: the axis is an input, not a result.
        pinned: true,
      });
      links.push({ a: home, b: bodies.length - 1, squeeze: reach / (info.covalent + reach) });
    }
  }

  relaxBest(bodies, links, steps, hops);

  if (trailing.length > 0) {
    // Everything settled so far is held still, so this second pass can only move the pairs
    // it is placing. Forces on the pinned bodies are still computed and simply discarded,
    // which leaves the gradient exact for the handful of things that are free.
    for (const body of bodies) body.pinned = true;
    const settled: Molecule = {
      ...molecule,
      atoms: molecule.atoms.map((atom, position) => ({ ...atom, position: bodies[position].position })),
    };
    for (const id of trailing) hang(settled, id, lonePairsAt(molecule, id), false);
    relax(bodies, links, TRAILING_STEPS);
  }

  return {
    atoms: molecule.atoms.map((atom, position) => ({ ...atom, position: bodies[position].position })),
    bonds: molecule.bonds,
    lonePairs: ghosts
      .map((ghost) => ({
        atom: ghost.atom,
        index: ghost.index,
        position: bodies[ghost.body].position,
        shaping: ghost.shaping,
      }))
      .sort((left, right) => left.atom - right.atom || left.index - right.index),
  };
}

/** The second pass has only a few free bodies and a fixed cage, so it converges quickly. */
const TRAILING_STEPS = 600;

const FLAT_POLE_WEIGHT = 3;

/** Lone pairs are derived, so every edit hands back a molecule with none and lets settle fill them in. */
function shaped(atoms: Atom[], bonds: Bond[]): Molecule {
  return { atoms, bonds, lonePairs: [] };
}

/**
 * Add an atom. With an anchor it arrives bonded, in the emptiest direction the anchor
 * has left; without one it arrives unbonded and clear of whatever is already there.
 */
export function addAtom(
  molecule: Molecule,
  symbol: string,
  anchorId: number | null,
  bond?: { kind?: BondKind; order?: BondOrder },
  options?: SettleOptions,
): { molecule: Molecule; id: number } {
  const id = nextId(molecule.atoms);
  const anchor = anchorId === null ? undefined : atomAt(molecule, anchorId);
  const order = bond?.order ?? 1;

  let position: Vec3;
  if (anchor) {
    const taken = neighboursOf(molecule, anchor.id).map((other) => sub(other.position, anchor.position));
    const away = openDirection(taken);
    position = add(anchor.position, scale(unit(away), bondLength(anchor.symbol, symbol, order)));
  } else {
    position = beside(molecule, symbol);
  }

  const atoms = [...molecule.atoms, { id, symbol, position, charge: 0 }];
  const bonds = anchor
    ? [
        ...molecule.bonds,
        {
          id: nextId(molecule.bonds),
          a: anchor.id,
          b: id,
          kind: bond?.kind ?? suggestKind(anchor.symbol, symbol),
          order,
        },
      ]
    : molecule.bonds;

  return { molecule: settle(shaped(atoms, bonds), options), id };
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
  bond?: { kind?: BondKind; order?: BondOrder },
  options?: SettleOptions,
): LinkResult {
  if (first === second) return { molecule, error: 'An atom cannot bond to itself.' };
  const a = atomAt(molecule, first);
  const b = atomAt(molecule, second);
  if (!a || !b) return { molecule, error: 'One of those atoms is gone.' };
  if (areBonded(molecule, first, second)) return { molecule, error: 'Those two are already bonded.' };

  const bonds = [
    ...molecule.bonds,
    {
      id: nextId(molecule.bonds),
      a: first,
      b: second,
      kind: bond?.kind ?? suggestKind(a.symbol, b.symbol),
      order: bond?.order ?? 1,
    },
  ];
  // Closing a ring is exactly the edit that needs the search, so pay for it here.
  return { molecule: tidy(shaped(molecule.atoms, bonds), options) };
}

export function unlink(molecule: Molecule, bondId: number, options?: SettleOptions): Molecule {
  return settle(shaped(molecule.atoms, molecule.bonds.filter((bond) => bond.id !== bondId)), options);
}

/** The ionic-or-covalent colour, which is paint: it changes nothing about the geometry. */
export function retypeBond(molecule: Molecule, bondId: number, kind: BondKind): Molecule {
  return {
    ...molecule,
    bonds: molecule.bonds.map((bond) => (bond.id === bondId ? { ...bond, kind } : bond)),
  };
}

/** Bond order, which changes both the length of the bond and how many lone pairs are left over. */
export function reorderBond(
  molecule: Molecule,
  bondId: number,
  order: BondOrder,
  options?: SettleOptions,
): Molecule {
  const bonds = molecule.bonds.map((bond) => (bond.id === bondId ? { ...bond, order } : bond));
  return settle(shaped(molecule.atoms, bonds), options);
}

export function setCharge(
  molecule: Molecule,
  atomId: number,
  charge: number,
  options?: SettleOptions,
): Molecule {
  const atoms = molecule.atoms.map((atom) => (atom.id === atomId ? { ...atom, charge } : atom));
  return settle(shaped(atoms, molecule.bonds), options);
}

export function deleteAtom(molecule: Molecule, id: number, options?: SettleOptions): Molecule {
  const atoms = molecule.atoms.filter((atom) => atom.id !== id);
  const bonds = molecule.bonds.filter((bond) => bond.a !== id && bond.b !== id);
  if (atoms.length === 0) return EMPTY;
  return settle(shaped(atoms, bonds), options);
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

/**
 * Atoms carrying more bonds than the element manages even generously. Reported, never blocked.
 *
 * Measured against `most` rather than `valence`, because the two are different questions and the
 * warning is only interesting for the second. Sulfur's valence is two and sulfur hexafluoride is
 * a real substance sitting in the preset list; complaining about it would be the program
 * doubting one of its own examples.
 */
export function crowded(molecule: Molecule): Array<{ atom: Atom; bonds: number; usual: number }> {
  return molecule.atoms
    .map((atom) => ({ atom, bonds: bondsAt(molecule, atom.id).length, usual: element(atom.symbol).most }))
    .filter((report) => report.bonds > report.usual);
}

/**
 * The save format. Version 2 adds bond order and formal charge; anything without a version
 * is a version 1 save, where every bond was single and every atom neutral, and those
 * defaults are exactly what reading the missing fields as absent produces. So the migration
 * is: assume nothing, default everything, and old saves load unchanged.
 *
 * Lone pairs are not saved. They are a consequence of the atoms and bonds, so writing them
 * down would only create the opportunity for them to disagree.
 */
export interface SavedMolecule {
  version?: number;
  atoms: Array<{ e: string; x: number; y: number; z: number; q?: number }>;
  bonds: Array<{ a: number; b: number; k: BondKind; o?: BondOrder }>;
}

const PLACES = 1000;
export const SAVE_VERSION = 2;

export function encode(molecule: Molecule): SavedMolecule {
  const slot = new Map(molecule.atoms.map((atom, index) => [atom.id, index]));
  return {
    version: SAVE_VERSION,
    atoms: molecule.atoms.map((atom) => ({
      e: atom.symbol,
      x: Math.round(atom.position.x * PLACES) / PLACES,
      y: Math.round(atom.position.y * PLACES) / PLACES,
      z: Math.round(atom.position.z * PLACES) / PLACES,
      ...(atom.charge ? { q: atom.charge } : {}),
    })),
    bonds: molecule.bonds.map((bond) => ({
      a: slot.get(bond.a)!,
      b: slot.get(bond.b)!,
      k: bond.kind,
      ...(bond.order === 1 ? {} : { o: bond.order }),
    })),
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
    const charge = typeof entry.q === 'number' && Number.isFinite(entry.q) ? Math.trunc(entry.q) : 0;
    atoms.push({ id: index + 1, symbol: entry.e, position: vec(x, y, z), charge });
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
    const order = BOND_ORDERS.includes(entry.o as BondOrder) ? (entry.o as BondOrder) : 1;
    bonds.push({ id: bonds.length + 1, a, b, kind: entry.k === 'ionic' ? 'ionic' : 'covalent', order });
  });

  const molecule = shaped(atoms, bonds);
  centre(molecule.atoms.map((atom) => ({ position: atom.position, covalent: 0 })));
  return molecule;
}

interface Recipe {
  name: string;
  /**
   * Each atom names the earlier atom it hangs off, by index, or null to start a piece, and
   * optionally the order of the bond that attaches it.
   */
  atoms: Array<[symbol: string, bondTo: number | null, order?: BondOrder]>;
  /** Extra bonds, for closing rings. */
  rings?: Array<[number, number, BondOrder?]>;
  /** Formal charges, by atom index. */
  charges?: Array<[number, number]>;
  note: string;
}

const RECIPES: Recipe[] = [
  {
    name: 'Water',
    atoms: [['O', null], ['H', 0], ['H', 0]],
    note: 'Bent to 104.5°, and the two lone pairs doing the bending are the reason. Turn them off to see it snap straight.',
  },
  {
    name: 'Methane',
    atoms: [['C', null], ['H', 0], ['H', 0], ['H', 0], ['H', 0]],
    note: 'Four things repelling on a sphere settle into a tetrahedron. Nobody told it 109.47°.',
  },
  {
    name: 'Ammonia',
    atoms: [['N', null], ['H', 0], ['H', 0], ['H', 0]],
    note: 'One lone pair over the top pushes the hydrogens down to 106.7°. That number is a prediction, not a setting.',
  },
  {
    name: 'Ammonium ion',
    atoms: [['N', null], ['H', 0], ['H', 0], ['H', 0], ['H', 0]],
    charges: [[0, 1]],
    note: 'The +1 charge spends the lone pair, so ammonium is a clean tetrahedron where ammonia was a pyramid.',
  },
  {
    name: 'Carbon dioxide',
    atoms: [['C', null], ['O', 0, 2], ['O', 0, 2]],
    note: 'Two double bonds use all four of carbon’s electrons, leaving no lone pair and no reason to bend.',
  },
  {
    name: 'Sulfur dioxide',
    atoms: [['S', null], ['O', 0, 2], ['O', 0, 2]],
    note: 'The same two double bonds, but sulfur has two electrons spare, and that one lone pair bends it.',
  },
  {
    name: 'Ethyne',
    atoms: [['C', null], ['C', 0, 3], ['H', 0], ['H', 1]],
    note: 'A triple bond, drawn as three cylinders and appreciably shorter than a single one.',
  },
  {
    name: 'Boron trifluoride',
    atoms: [['B', null], ['F', 0], ['F', 0], ['F', 0]],
    note: 'Three neighbours make a flat triangle at 120°, and boron has no lone pair to spoil it.',
  },
  {
    name: 'Xenon tetrafluoride',
    atoms: [['Xe', null], ['F', 0], ['F', 0], ['F', 0], ['F', 0]],
    note: 'Six domains, two of them lone pairs. They take the poles, which leaves the fluorines in a square.',
  },
  {
    name: 'Benzene',
    atoms: [
      ['C', null], ['C', 0, 1.5], ['C', 1, 1.5], ['C', 2, 1.5], ['C', 3, 1.5], ['C', 4, 1.5],
      ['H', 0], ['H', 1], ['H', 2], ['H', 3], ['H', 4], ['H', 5],
    ],
    rings: [[5, 0, 1.5]],
    note: 'Aromatic bonds, counted as one and a half each, which is what leaves every carbon with no lone pair.',
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
    note: 'Two tetrahedral carbons, and an oxygen whose two lone pairs put a kink in the end of the chain.',
  },
  {
    name: 'Sulfur hexafluoride',
    atoms: [['S', null], ['F', 0], ['F', 0], ['F', 0], ['F', 0], ['F', 0], ['F', 0]],
    note: 'Six neighbours give an octahedron, which is also the answer to the six-point Thomson problem.',
  },
  {
    name: 'Table salt',
    atoms: [['Na', null], ['Cl', 0]],
    note: 'Ionic, so the electron moves across: sodium shrinks to Na+ and chlorine swells to Cl−.',
  },
  {
    name: 'Copper(II) chloride',
    atoms: [['Cu', null], ['Cl', 0], ['Cl', 0], ['Cl', 0], ['Cl', 0]],
    note: 'Square, not tetrahedral. The one shape here that is looked up rather than worked out.',
  },
];

export interface Preset {
  name: string;
  note: string;
  build: (options?: SettleOptions) => Molecule;
}

export const PRESETS: Preset[] = RECIPES.map((recipe) => ({
  name: recipe.name,
  note: recipe.note,
  build: (options?: SettleOptions) => cook(recipe, options),
}));

function cook(recipe: Recipe, options?: SettleOptions): Molecule {
  let molecule = EMPTY;
  const ids: number[] = [];
  for (const [symbol, bondTo, order] of recipe.atoms) {
    const step = addAtom(molecule, symbol, bondTo === null ? null : ids[bondTo], { order });
    molecule = step.molecule;
    ids.push(step.id);
  }

  // Ring bonds and charges go on without settling in between, so the one search at the end
  // does all the work rather than paying for it several times over.
  const bonds = [...molecule.bonds];
  for (const [from, to, order] of recipe.rings ?? []) {
    bonds.push({ id: nextId(bonds), a: ids[from], b: ids[to], kind: 'covalent', order: order ?? 1 });
  }
  const charged = new Map(recipe.charges ?? []);
  const atoms = molecule.atoms.map((atom, index) => ({ ...atom, charge: charged.get(index) ?? 0 }));

  return tidy(shaped(atoms, bonds), options);
}
