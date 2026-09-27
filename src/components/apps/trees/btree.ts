import { type Event, ev } from './binary';
import type { BTreeNodeView, Engine, NodeId, Snapshot, Step } from './types';

/*
 * B-tree: keys live in bunches, every leaf sits at the same depth, and the tree
 * grows and shrinks from the root rather than the leaves. Overfull nodes split
 * and push their middle key up; underfull nodes borrow from a sibling or merge
 * with one, which is the only way the height ever changes.
 *
 * Both repairs run bottom up, which keeps them correct for an even maximum key
 * count as well: a node is allowed to overflow or underflow by exactly one
 * before it is put right.
 */

export type BTreeNode = {
  id: NodeId;
  keys: number[];
  children: BTreeNode[];
  parent: BTreeNode | null;
};

export type BTreeState = {
  root: BTreeNode | null;
  maxKeys: number;
  nextId: number;
};

export const B_TREE_MAX_KEYS_CHOICES = [2, 3, 4] as const;

export function minKeysFor(maxKeys: number): number {
  return Math.ceil((maxKeys + 1) / 2) - 1;
}

function makeNode(state: BTreeState, keys: number[], children: BTreeNode[] = []): BTreeNode {
  const node: BTreeNode = { id: state.nextId++, keys, children, parent: null };
  for (const child of children) child.parent = node;
  return node;
}

const isLeaf = (node: BTreeNode): boolean => node.children.length === 0;

/** A node with no keys left is mid-repair, and reads better in words than as `[]`. */
const fmt = (node: BTreeNode): string => (node.keys.length ? `[${node.keys.join(' | ')}]` : 'the node left empty');

/** The child to follow for `value`: the first key it sorts before. */
function childIndex(node: BTreeNode, value: number): number {
  let i = 0;
  while (i < node.keys.length && value > node.keys[i]) i += 1;
  return i;
}

function btreeSnapshot(state: BTreeState): Snapshot {
  const view = (node: BTreeNode | null): BTreeNodeView | null => {
    if (!node) return null;
    return {
      id: node.id,
      keys: [...node.keys],
      children: node.children.map((child) => view(child) as BTreeNodeView),
    };
  };
  return { shape: 'btree', root: view(state.root), maxKeys: state.maxKeys };
}

function collectBTree(run: Generator<Event, void>, state: BTreeState): Step[] {
  const steps: Step[] = [];
  for (const event of run) steps.push({ ...event, snapshot: btreeSnapshot(state) });
  return steps;
}

/** Splits every node on the way up that is holding one key too many. */
function* splitUp(state: BTreeState, from: BTreeNode): Generator<Event, void> {
  let current = from;
  while (current.keys.length > state.maxKeys) {
    const mid = Math.floor(current.keys.length / 2);
    const promoted = current.keys[mid];
    const leftKeys = current.keys.slice(0, mid);
    const rightKeys = current.keys.slice(mid + 1);
    const hasChildren = current.children.length > 0;
    const rightChildren = hasChildren ? current.children.slice(mid + 1) : [];
    const overfull = fmt(current);

    const right = makeNode(state, rightKeys, rightChildren);
    current.keys = leftKeys;
    if (hasChildren) current.children = current.children.slice(0, mid + 1);

    const parent = current.parent;
    if (!parent) {
      const newRoot = makeNode(state, [promoted], [current, right]);
      state.root = newRoot;
      yield ev(
        'split',
        `The root ${overfull} holds one key too many: split it around ${promoted}, which becomes a new root of its own and makes the tree one level taller`,
        [newRoot.id, current.id, right.id],
        [promoted],
      );
      return;
    }

    const index = parent.children.indexOf(current);
    parent.keys.splice(index, 0, promoted);
    parent.children.splice(index + 1, 0, right);
    right.parent = parent;
    yield ev(
      'split',
      `${overfull} holds one key too many: split it into ${fmt(current)} and ${fmt(right)} and push ${promoted} up into the parent`,
      [current.id, right.id, parent.id],
      [promoted],
    );
    current = parent;
  }
}

function* insertGen(state: BTreeState, value: number): Generator<Event, void> {
  if (!state.root) {
    state.root = makeNode(state, [value]);
    yield ev('insert', `The tree was empty, so ${value} starts off the root node`, [state.root.id], [value]);
    return;
  }

  let node = state.root;
  for (;;) {
    if (node.keys.includes(value)) {
      yield ev('note', `${value} is already in ${fmt(node)}, so there is nothing to insert`, [node.id], [value]);
      return;
    }
    if (isLeaf(node)) break;
    const index = childIndex(node, value);
    yield ev(
      'compare',
      `${describePosition(node, value, index)}, so follow the child below that gap`,
      [node.id],
      node.keys.length ? [node.keys[Math.min(index, node.keys.length - 1)]] : [],
    );
    node = node.children[index];
  }

  node.keys.splice(childIndex(node, value), 0, value);
  yield ev('insert', `${value} slots into the leaf, which is now ${fmt(node)}`, [node.id], [value]);
  yield* splitUp(state, node);
}

function describePosition(node: BTreeNode, value: number, index: number): string {
  if (index === 0) return `${value} is smaller than ${node.keys[0]}`;
  if (index === node.keys.length) return `${value} is bigger than ${node.keys[node.keys.length - 1]}`;
  return `${value} falls between ${node.keys[index - 1]} and ${node.keys[index]}`;
}

/** Borrows or merges up the tree until nothing is short of keys. */
function* fixUnderflow(state: BTreeState, from: BTreeNode): Generator<Event, void> {
  const minKeys = minKeysFor(state.maxKeys);
  let current = from;

  while (current !== state.root && current.keys.length < minKeys) {
    const parent = current.parent;
    if (!parent) break;
    const index = parent.children.indexOf(current);
    const leftSibling = index > 0 ? parent.children[index - 1] : null;
    const rightSibling = index < parent.children.length - 1 ? parent.children[index + 1] : null;

    if (leftSibling && leftSibling.keys.length > minKeys) {
      const separator = parent.keys[index - 1];
      const lifted = leftSibling.keys.pop() as number;
      current.keys.unshift(separator);
      parent.keys[index - 1] = lifted;
      if (leftSibling.children.length) {
        const moved = leftSibling.children.pop() as BTreeNode;
        moved.parent = current;
        current.children.unshift(moved);
      }
      yield ev(
        'borrow',
        `${fmt(current)} is a key short, but its left sibling ${fmt(leftSibling)} has one to spare: ${separator} drops down from the parent and ${lifted} takes its place up there`,
        [current.id, leftSibling.id, parent.id],
        [separator, lifted],
      );
      return;
    }

    if (rightSibling && rightSibling.keys.length > minKeys) {
      const separator = parent.keys[index];
      const lifted = rightSibling.keys.shift() as number;
      current.keys.push(separator);
      parent.keys[index] = lifted;
      if (rightSibling.children.length) {
        const moved = rightSibling.children.shift() as BTreeNode;
        moved.parent = current;
        current.children.push(moved);
      }
      yield ev(
        'borrow',
        `${fmt(current)} is a key short, but its right sibling ${fmt(rightSibling)} has one to spare: ${separator} drops down from the parent and ${lifted} takes its place up there`,
        [current.id, rightSibling.id, parent.id],
        [separator, lifted],
      );
      return;
    }

    const mergeWithLeft = leftSibling !== null;
    const keeper = mergeWithLeft ? (leftSibling as BTreeNode) : current;
    const donor = mergeWithLeft ? current : (rightSibling as BTreeNode);
    const separatorIndex = mergeWithLeft ? index - 1 : index;
    const separator = parent.keys[separatorIndex];
    const shortSide = fmt(current);
    const sibling = fmt(mergeWithLeft ? (leftSibling as BTreeNode) : (rightSibling as BTreeNode));

    keeper.keys.push(separator, ...donor.keys);
    for (const child of donor.children) {
      child.parent = keeper;
      keeper.children.push(child);
    }
    parent.keys.splice(separatorIndex, 1);
    parent.children.splice(parent.children.indexOf(donor), 1);
    yield ev(
      'merge',
      `${shortSide} is short of keys and no sibling can spare one, so merge it with the ${mergeWithLeft ? 'left' : 'right'} sibling ${sibling} and pull the separator ${separator} down between them, leaving ${fmt(keeper)}`,
      [keeper.id, parent.id],
      [separator],
    );

    if (parent === state.root && parent.keys.length === 0) {
      state.root = keeper;
      keeper.parent = null;
      yield ev('merge', `That emptied the root, so ${fmt(keeper)} becomes the new root and the tree loses a level`, [keeper.id]);
      return;
    }

    current = parent;
  }
}

function* removeGen(state: BTreeState, value: number): Generator<Event, void> {
  if (!state.root) {
    yield ev('note', `The tree is empty, so there is nothing to delete`, []);
    return;
  }

  let node: BTreeNode | null = state.root;
  while (node) {
    if (node.keys.includes(value)) break;
    if (isLeaf(node)) {
      node = null;
      break;
    }
    const index = childIndex(node, value);
    yield ev(
      'compare',
      `${describePosition(node, value, index)}, so follow the child below that gap`,
      [node.id],
      node.keys.length ? [node.keys[Math.min(index, node.keys.length - 1)]] : [],
    );
    node = node.children[index];
  }

  if (!node) {
    yield ev('note', `${value} is not in the tree, so there is nothing to delete`, []);
    return;
  }

  yield ev('note', `Found ${value} in ${fmt(node)}`, [node.id], [value]);

  let shortNode = node;
  if (isLeaf(node)) {
    node.keys.splice(node.keys.indexOf(value), 1);
    yield ev('remove', `${value} is in a leaf, so take it straight out, leaving ${fmt(node)}`, [node.id]);
  } else {
    const slot = node.keys.indexOf(value);
    let predecessor = node.children[slot];
    while (!isLeaf(predecessor)) predecessor = predecessor.children[predecessor.children.length - 1];
    const lifted = predecessor.keys.pop() as number;
    node.keys[slot] = lifted;
    yield ev(
      'swap',
      `${value} sits in an internal node, where it works as a separator, so its predecessor ${lifted} moves up to do that job and the leaf loses ${lifted} instead`,
      [node.id, predecessor.id],
      [lifted],
    );
    shortNode = predecessor;
  }

  if (state.root.keys.length === 0 && isLeaf(state.root)) {
    state.root = null;
    yield ev('note', `That was the last key, so the tree is empty again`, []);
    return;
  }

  yield* fixUnderflow(state, shortNode);
}

export const bTreeEngine: Engine<BTreeState> = {
  id: 'btree',
  label: 'B-tree',
  invariant: 'Keys are stored in groups, no node holds more than its limit, and every leaf sits at the same depth.',
  create: (options) => ({ root: null, maxKeys: options?.maxKeys ?? 2, nextId: 1 }),
  insert: (state, value) => collectBTree(insertGen(state, value), state),
  remove: (state, value) => collectBTree(removeGen(state, value), state),
  snapshot: (state): Snapshot => btreeSnapshot(state),
  keys: (state) => {
    const out: number[] = [];
    const walk = (node: BTreeNode | null): void => {
      if (!node) return;
      node.keys.forEach((key, i) => {
        walk(node.children[i] ?? null);
        out.push(key);
      });
      walk(node.children[node.keys.length] ?? null);
    };
    walk(state.root);
    return out;
  },
};

/** Exported for the tests: key counts, child counts and a single leaf depth. */
export function bTreeInvariantBroken(state: BTreeState): string | null {
  const root = state.root;
  if (!root) return null;
  const minKeys = minKeysFor(state.maxKeys);
  const depths = new Set<number>();

  const walk = (node: BTreeNode, depth: number, low: number, high: number): void => {
    if (node.keys.length > state.maxKeys) throw new Error(`${fmt(node)} holds more than ${state.maxKeys} keys`);
    if (node !== root && node.keys.length < minKeys) throw new Error(`${fmt(node)} holds fewer than ${minKeys} keys`);
    if (node === root && node.keys.length === 0) throw new Error('the root has no keys');
    for (let i = 1; i < node.keys.length; i += 1) {
      if (node.keys[i - 1] >= node.keys[i]) throw new Error(`${fmt(node)} is not sorted`);
    }
    for (const key of node.keys) {
      if (key <= low || key >= high) throw new Error(`${key} is outside the range this node covers`);
    }
    if (node.children.length === 0) {
      depths.add(depth);
      return;
    }
    if (node.children.length !== node.keys.length + 1) {
      throw new Error(`${fmt(node)} has ${node.children.length} children for ${node.keys.length} keys`);
    }
    node.children.forEach((child, i) => {
      if (child.parent !== node) throw new Error(`${fmt(child)} has a stale parent pointer`);
      walk(child, depth + 1, i === 0 ? low : node.keys[i - 1], i === node.keys.length ? high : node.keys[i]);
    });
  };

  try {
    walk(root, 0, -Infinity, Infinity);
    if (depths.size > 1) throw new Error(`leaves sit at different depths (${[...depths].join(', ')})`);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}
