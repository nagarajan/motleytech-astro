import type { BinaryNodeView, NodeId, Snapshot, Step, StepMark } from './types';

/*
 * The three binary structures share this mutable node. Parent pointers make the
 * rotations and the Red-Black fixups read like the textbook versions, and they
 * are dropped again when a snapshot is taken.
 */
export type BinaryNode = {
  id: NodeId;
  key: number;
  left: BinaryNode | null;
  right: BinaryNode | null;
  parent: BinaryNode | null;
  height: number;
  red: boolean;
  priority: number;
};

export type BinaryState = {
  root: BinaryNode | null;
  nextId: number;
  /** Which per-node annotation the structure wants drawn. */
  annotation: 'height' | 'color' | 'priority';
  random(): number;
};

export function createBinaryState(annotation: BinaryState['annotation'], seed = 1): BinaryState {
  return { root: null, nextId: 1, annotation, random: mulberry32(seed) };
}

/** Small seeded generator, so a treap animation can be reproduced. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeNode(state: BinaryState, key: number): BinaryNode {
  return {
    id: state.nextId++,
    key,
    left: null,
    right: null,
    parent: null,
    height: 0,
    red: true,
    priority: 1 + Math.floor(state.random() * 99),
  };
}

export function height(node: BinaryNode | null): number {
  return node ? node.height : -1;
}

export function updateHeight(node: BinaryNode): void {
  node.height = 1 + Math.max(height(node.left), height(node.right));
}

export function balanceFactor(node: BinaryNode): number {
  return height(node.left) - height(node.right);
}

export function isRed(node: BinaryNode | null): boolean {
  return node !== null && node.red;
}

/** Replaces `child` in its parent's slot with `next`, keeping the root in step. */
export function transplant(state: BinaryState, child: BinaryNode, next: BinaryNode | null): void {
  const parent = child.parent;
  if (!parent) state.root = next;
  else if (parent.left === child) parent.left = next;
  else parent.right = next;
  if (next) next.parent = parent;
}

export function rotateLeft(state: BinaryState, x: BinaryNode): BinaryNode {
  const y = x.right;
  if (!y) throw new Error('rotateLeft needs a right child');
  x.right = y.left;
  if (y.left) y.left.parent = x;
  y.parent = x.parent;
  if (!x.parent) state.root = y;
  else if (x.parent.left === x) x.parent.left = y;
  else x.parent.right = y;
  y.left = x;
  x.parent = y;
  updateHeight(x);
  updateHeight(y);
  return y;
}

export function rotateRight(state: BinaryState, x: BinaryNode): BinaryNode {
  const y = x.left;
  if (!y) throw new Error('rotateRight needs a left child');
  x.left = y.right;
  if (y.right) y.right.parent = x;
  y.parent = x.parent;
  if (!x.parent) state.root = y;
  else if (x.parent.left === x) x.parent.left = y;
  else x.parent.right = y;
  y.right = x;
  x.parent = y;
  updateHeight(x);
  updateHeight(y);
  return y;
}

export function findNode(state: BinaryState, key: number): BinaryNode | null {
  let node = state.root;
  while (node && node.key !== key) node = key < node.key ? node.left : node.right;
  return node;
}

export function minimum(node: BinaryNode): BinaryNode {
  let current = node;
  while (current.left) current = current.left;
  return current;
}

export function inorderKeys(root: BinaryNode | null): number[] {
  const keys: number[] = [];
  const walk = (node: BinaryNode | null): void => {
    if (!node) return;
    walk(node.left);
    keys.push(node.key);
    walk(node.right);
  };
  walk(root);
  return keys;
}

export function binarySnapshot(state: BinaryState): Snapshot {
  const view = (node: BinaryNode | null): BinaryNodeView | null => {
    if (!node) return null;
    const out: BinaryNodeView = { id: node.id, key: node.key, left: view(node.left), right: view(node.right) };
    if (state.annotation === 'height') out.height = node.height;
    if (state.annotation === 'color') out.red = node.red;
    if (state.annotation === 'priority') out.priority = node.priority;
    return out;
  };
  return { shape: 'binary', root: view(state.root) };
}

/** What a generator yields: a step without the snapshot, which the driver adds. */
export type Event = { caption: string; mark: StepMark; focus: NodeId[]; focusKeys?: number[] };

export function ev(mark: StepMark, caption: string, focus: NodeId[] = [], focusKeys?: number[]): Event {
  return focusKeys ? { mark, caption, focus, focusKeys } : { mark, caption, focus };
}

/** Sets up the deletion step that follows, which depends on this count. */
export function describeChildren(node: BinaryNode): string {
  if (node.left && node.right) return 'and it has two children, which is the case that needs a stand-in';
  if (node.left || node.right) return 'and it has a single child, which can slide up into its place';
  return 'and it is a leaf, which is the easy case';
}

/**
 * Runs a generator to completion, snapshotting the tree after each yield. The
 * generators mutate in place and only yield once the tree is consistent, so
 * every snapshot is a state the animation can legitimately show.
 */
export function collect(run: Generator<Event, void>, snapshot: () => Snapshot): Step[] {
  const steps: Step[] = [];
  for (const event of run) steps.push({ ...event, snapshot: snapshot() });
  return steps;
}
