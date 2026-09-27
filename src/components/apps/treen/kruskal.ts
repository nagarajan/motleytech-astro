/**
 * The rules of the TREE(n) game, and the embedding test that decides them.
 *
 * A sequence of coloured rooted trees T(1), T(2), ... is legal when T(k) has at
 * most k vertices and no earlier tree embeds into a later one. The embedding is
 * the one from Kruskal's tree theorem: an injection f on vertices that keeps
 * colours and, crucially, keeps meets, so f(v and w) = f(v) and f(w) where the
 * meet of two vertices is their deepest common ancestor.
 *
 * Keeping meets is stronger than the usual "is a subdivision of" test, and it is
 * the whole reason the game can be played at all. A root with two children
 * cannot be placed into a root whose two children hang off one shared vertex:
 * the two leaves would meet below the image of the root rather than at it.
 */

export interface TreeNode {
  /** Unique inside its own tree, so a witness map can name vertices. */
  id: number;
  colour: number;
  children: TreeNode[];
}

export const MAX_COLOURS = 4;

export function leaf(colour: number, id = 0): TreeNode {
  return { id, colour, children: [] };
}

export function size(tree: TreeNode): number {
  return 1 + tree.children.reduce((total, child) => total + size(child), 0);
}

export function depth(tree: TreeNode): number {
  return tree.children.length === 0 ? 1 : 1 + Math.max(...tree.children.map(depth));
}

export function vertices(tree: TreeNode): TreeNode[] {
  return [tree, ...tree.children.flatMap(vertices)];
}

export function coloursUsed(tree: TreeNode): number[] {
  return [...new Set(vertices(tree).map((node) => node.colour))].sort((a, b) => a - b);
}

/** Renumbers a tree so ids are 0..n-1 in depth-first order. */
export function renumber(tree: TreeNode): TreeNode {
  let next = 0;
  const walk = (node: TreeNode): TreeNode => {
    const id = next;
    next += 1;
    return { id, colour: node.colour, children: node.children.map(walk) };
  };
  return walk(tree);
}

export function clone(tree: TreeNode): TreeNode {
  return { id: tree.id, colour: tree.colour, children: tree.children.map(clone) };
}

/**
 * Children are unordered, so the canonical form sorts them. Two trees are the
 * same tree exactly when their canonical forms match, which is what makes
 * saving, loading and enumeration free of duplicates.
 */
export function canonical(tree: TreeNode): string {
  const kids = tree.children.map(canonical).sort();
  return kids.length ? `${tree.colour}(${kids.join(',')})` : `${tree.colour}`;
}

export function parseTree(text: string): TreeNode {
  let at = 0;

  const number = (): number => {
    const start = at;
    while (at < text.length && text[at] >= '0' && text[at] <= '9') at += 1;
    if (at === start) throw new Error(`expected a colour at ${start} of "${text}"`);
    return Number(text.slice(start, at));
  };

  const node = (): TreeNode => {
    const colour = number();
    const children: TreeNode[] = [];
    if (text[at] === '(') {
      at += 1;
      children.push(node());
      while (text[at] === ',') {
        at += 1;
        children.push(node());
      }
      if (text[at] !== ')') throw new Error(`expected ) at ${at} of "${text}"`);
      at += 1;
    }
    return { id: 0, colour, children };
  };

  const tree = node();
  if (at !== text.length) throw new Error(`trailing text in "${text}"`);
  return renumber(tree);
}

/** Vertex of `small` -> vertex of `big`, by id. */
export type Witness = Map<number, number>;

type Memo = Map<string, Witness | null>;

/**
 * Maximum bipartite matching (Kuhn's algorithm). Each child of the smaller tree
 * needs its own child subtree of the bigger one; sharing one would put two
 * meets in the wrong place.
 */
function matchAll(fits: Array<Array<Witness | null>>): number[] | null {
  const kids = fits.length;
  const slots = fits[0]?.length ?? 0;
  const slotFor = new Array<number>(kids).fill(-1);
  const takenBy = new Array<number>(slots).fill(-1);

  const place = (kid: number, seen: boolean[]): boolean => {
    for (let slot = 0; slot < slots; slot += 1) {
      if (!fits[kid][slot] || seen[slot]) continue;
      seen[slot] = true;
      if (takenBy[slot] === -1 || place(takenBy[slot], seen)) {
        takenBy[slot] = kid;
        slotFor[kid] = slot;
        return true;
      }
    }
    return false;
  };

  for (let kid = 0; kid < kids; kid += 1) {
    if (!place(kid, new Array<boolean>(slots).fill(false))) return null;
  }
  return slotFor;
}

/** With the root of `small` landing exactly on the root of `big`. */
function embedAtRoot(small: TreeNode, big: TreeNode, memo: Memo): Witness | null {
  if (small.colour !== big.colour) return null;
  if (small.children.length === 0) return new Map([[small.id, big.id]]);
  if (small.children.length > big.children.length) return null;

  const fits = small.children.map((kid) => big.children.map((slot) => embedAnywhere(kid, slot, memo)));
  const chosen = matchAll(fits);
  if (!chosen) return null;

  const witness: Witness = new Map([[small.id, big.id]]);
  chosen.forEach((slot, kid) => {
    for (const [from, to] of fits[kid][slot]!) witness.set(from, to);
  });
  return witness;
}

/** With the root of `small` landing anywhere in `big`. */
function embedAnywhere(small: TreeNode, big: TreeNode, memo: Memo): Witness | null {
  const key = `${small.id}:${big.id}`;
  const seen = memo.get(key);
  if (seen !== undefined) return seen;

  let found = embedAtRoot(small, big, memo);
  if (!found) {
    for (const slot of big.children) {
      found = embedAnywhere(small, slot, memo);
      if (found) break;
    }
  }

  memo.set(key, found);
  return found;
}

/** The witness map if `small` embeds into `big`, otherwise null. */
export function embed(small: TreeNode, big: TreeNode): Witness | null {
  return embedAnywhere(small, big, new Map());
}

export function embeds(small: TreeNode, big: TreeNode): boolean {
  return embed(small, big) !== null;
}

export type Verdict =
  | { ok: true }
  | { ok: false; reason: 'budget'; size: number; allowed: number }
  | { ok: false; reason: 'palette'; colours: number[] }
  | { ok: false; reason: 'embeds'; position: number; witness: Witness };

/**
 * Judges the tree about to be played. Only earlier-into-later counts: a tree may
 * freely embed into one that came before it, which is exactly the loophole that
 * lets a sequence start with something big and finish with something small.
 */
export function judge(sequence: TreeNode[], candidate: TreeNode, palette: number): Verdict {
  const position = sequence.length + 1;

  const count = size(candidate);
  if (count > position) return { ok: false, reason: 'budget', size: count, allowed: position };

  const outside = coloursUsed(candidate).filter((colour) => colour >= palette);
  if (outside.length) return { ok: false, reason: 'palette', colours: outside };

  for (let i = 0; i < sequence.length; i += 1) {
    const witness = embed(sequence[i], candidate);
    if (witness) return { ok: false, reason: 'embeds', position: i + 1, witness };
  }

  return { ok: true };
}

export function isLegalSequence(sequence: TreeNode[], palette: number): boolean {
  return sequence.every((tree, index) => judge(sequence.slice(0, index), tree, palette).ok);
}

/**
 * Every tree with exactly `count` vertices drawn from `colours`, once each up to
 * reordering of children. Built up from smaller sizes, because a tree is a root
 * plus a multiset of smaller trees.
 */
export function everyTree(count: number, colours: number[]): string[] {
  const bySize: string[][] = [[]];
  const sizeOf = new Map<string, number>();

  for (let target = 1; target <= count; target += 1) {
    // Trees available as children, shortest first, so combinations stay ordered.
    const pool: string[] = [];
    for (let s = 1; s < target; s += 1) pool.push(...bySize[s]);

    const forests = (left: number, from: number): string[][] => {
      if (left === 0) return [[]];
      const out: string[][] = [];
      for (let i = from; i < pool.length; i += 1) {
        const used = sizeOf.get(pool[i])!;
        if (used > left) break;
        for (const rest of forests(left - used, i)) out.push([pool[i], ...rest]);
      }
      return out;
    };

    const here: string[] = [];
    for (const forest of forests(target - 1, 0)) {
      const kids = [...forest].sort();
      for (const colour of colours) {
        here.push(kids.length ? `${colour}(${kids.join(',')})` : `${colour}`);
      }
    }
    for (const form of here) sizeOf.set(form, target);
    bySize[target] = here;
  }

  return bySize[count] ?? [];
}

/**
 * A colour is spent once some earlier tree is a lone vertex of that colour,
 * because a lone vertex embeds into anything that uses its colour at all. That
 * makes the endgame cheap to reason about: when every colour is spent there is
 * provably nothing left to play, without enumerating a single tree.
 */
export function usableColours(sequence: TreeNode[], palette: number): number[] {
  const spent = new Set(
    sequence.filter((tree) => tree.children.length === 0).map((tree) => tree.colour),
  );
  return Array.from({ length: palette }, (_, colour) => colour).filter((colour) => !spent.has(colour));
}

export type Search =
  | { outcome: 'found'; tree: TreeNode }
  | { outcome: 'stuck' }
  | { outcome: 'unknown'; examined: number };

/**
 * Looks for any tree that could legally come next, smallest first. Finding one
 * is quick. Proving there is none means examining everything that fits the
 * budget, which stays feasible only while few colours are still in play, so the
 * answer is allowed to be "do not know".
 */
export function findLegalNext(sequence: TreeNode[], palette: number, budget = 300000): Search {
  const position = sequence.length + 1;
  const colours = usableColours(sequence, palette);
  if (colours.length === 0) return { outcome: 'stuck' };

  let examined = 0;
  for (let count = 1; count <= position; count += 1) {
    const forms = everyTree(count, colours);
    if (examined + forms.length > budget) return { outcome: 'unknown', examined };

    for (const form of forms) {
      examined += 1;
      const tree = parseTree(form);
      if (judge(sequence, tree, palette).ok) return { outcome: 'found', tree };
    }
  }

  return { outcome: 'stuck' };
}

/** The longest sequence the rules allow, found by exhaustive search. */
export function longestSequence(palette: number, cap = 12): TreeNode[] {
  let best: TreeNode[] = [];

  const extend = (sequence: TreeNode[]): void => {
    if (sequence.length > best.length) best = [...sequence];
    if (sequence.length >= cap) return;

    const position = sequence.length + 1;
    const colours = usableColours(sequence, palette);
    for (let count = 1; count <= position; count += 1) {
      for (const form of everyTree(count, colours)) {
        const tree = parseTree(form);
        if (!judge(sequence, tree, palette).ok) continue;
        sequence.push(tree);
        extend(sequence);
        sequence.pop();
      }
    }
  };

  extend([]);
  return best;
}
