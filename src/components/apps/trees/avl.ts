import {
  type BinaryNode,
  type BinaryState,
  type Event,
  balanceFactor,
  binarySnapshot,
  collect,
  createBinaryState,
  describeChildren,
  ev,
  findNode,
  height,
  inorderKeys,
  makeNode,
  minimum,
  rotateLeft,
  rotateRight,
  transplant,
  updateHeight,
} from './binary';
import type { Engine, Snapshot, Step } from './types';

/*
 * AVL: every node keeps the heights of its two subtrees within one of each
 * other. Inserts and deletes retrace the path back to the root, and the first
 * node that breaks the rule is rotated back into shape.
 */

export type AvlState = BinaryState;

function* fixAt(state: AvlState, node: BinaryNode): Generator<Event, void> {
  const factor = balanceFactor(node);
  const pivotKey = node.key;

  if (factor > 1) {
    const left = node.left;
    if (!left) return;
    if (balanceFactor(left) < 0) {
      yield ev(
        'note',
        `${pivotKey} is left heavy (${height(node.left)} vs ${height(node.right)}) and its left child ${left.key} leans right: a Left-Right case, so it takes two rotations`,
        [node.id, left.id],
      );
      const grandchildKey = left.right?.key;
      rotateLeft(state, left);
      yield ev('rotate', `Rotate left at ${left.key}: ${grandchildKey} moves up, which turns this into a Left-Left case`, [
        node.id,
        left.id,
      ]);
    } else {
      yield ev(
        'note',
        `${pivotKey} is left heavy (${height(node.left)} vs ${height(node.right)}) and its left child leans the same way: a Left-Left case, so one rotation is enough`,
        [node.id, left.id],
      );
    }
    const risingKey = node.left?.key;
    rotateRight(state, node);
    yield ev('rotate', `Rotate right at ${pivotKey}: ${risingKey} takes its place and ${pivotKey} becomes its right child`, [
      node.id,
    ]);
    return;
  }

  const right = node.right;
  if (!right) return;
  if (balanceFactor(right) > 0) {
    yield ev(
      'note',
      `${pivotKey} is right heavy (${height(node.right)} vs ${height(node.left)}) and its right child ${right.key} leans left: a Right-Left case, so it takes two rotations`,
      [node.id, right.id],
    );
    const grandchildKey = right.left?.key;
    rotateRight(state, right);
    yield ev('rotate', `Rotate right at ${right.key}: ${grandchildKey} moves up, which turns this into a Right-Right case`, [
      node.id,
      right.id,
    ]);
  } else {
    yield ev(
      'note',
      `${pivotKey} is right heavy (${height(node.right)} vs ${height(node.left)}) and its right child leans the same way: a Right-Right case, so one rotation is enough`,
      [node.id, right.id],
    );
  }
  const risingKey = node.right?.key;
  rotateLeft(state, node);
  yield ev('rotate', `Rotate left at ${pivotKey}: ${risingKey} takes its place and ${pivotKey} becomes its left child`, [node.id]);
}

/** Walks back up to the root, refreshing heights and rotating anything that tipped over. */
function* retrace(state: AvlState, from: BinaryNode | null): Generator<Event, void> {
  let node = from;
  while (node) {
    const parent = node.parent;
    const before = node.height;
    updateHeight(node);
    const factor = balanceFactor(node);
    if (factor > 1 || factor < -1) {
      yield* fixAt(state, node);
    } else if (node.height !== before) {
      yield ev('note', `Height of ${node.key} is now ${node.height}`, [node.id]);
    }
    node = parent;
  }
}

function* insertGen(state: AvlState, value: number): Generator<Event, void> {
  if (!state.root) {
    state.root = makeNode(state, value);
    state.root.height = 0;
    yield ev('insert', `The tree was empty, so ${value} becomes the root`, [state.root.id]);
    return;
  }

  let node: BinaryNode = state.root;
  for (;;) {
    if (value === node.key) {
      yield ev('note', `${value} is already in the tree, so there is nothing to insert`, [node.id]);
      return;
    }
    const goLeft = value < node.key;
    const next = goLeft ? node.left : node.right;
    if (!next) {
      const fresh = makeNode(state, value);
      fresh.parent = node;
      if (goLeft) node.left = fresh;
      else node.right = fresh;
      yield ev('insert', `${value} ${goLeft ? '<' : '>'} ${node.key} and that slot is free, so ${value} lands here as a leaf`, [
        fresh.id,
      ]);
      yield* retrace(state, node);
      return;
    }
    yield ev('compare', `${value} ${goLeft ? '<' : '>'} ${node.key}, so walk ${goLeft ? 'left' : 'right'}`, [node.id]);
    node = next;
  }
}

function* removeGen(state: AvlState, value: number): Generator<Event, void> {
  let node = state.root;
  while (node && node.key !== value) {
    const goLeft = value < node.key;
    yield ev('compare', `${value} ${goLeft ? '<' : '>'} ${node.key}, so walk ${goLeft ? 'left' : 'right'}`, [node.id]);
    node = goLeft ? node.left : node.right;
  }
  if (!node) {
    yield ev('note', `${value} is not in the tree, so there is nothing to delete`, []);
    return;
  }

  yield ev('note', `Found ${value}, ${describeChildren(node)}`, [node.id]);

  let victim = node;
  if (node.left && node.right) {
    const successor = minimum(node.right);
    yield ev(
      'swap',
      `${node.key} has two children, so its in-order successor ${successor.key} moves into this node and the successor node is deleted instead`,
      [node.id, successor.id],
    );
    node.key = successor.key;
    victim = successor;
  }

  const parent = victim.parent;
  const child = victim.left ?? victim.right;
  transplant(state, victim, child);
  yield ev(
    'remove',
    child
      ? `Detach ${victim.key} and pull its only child ${child.key} up into the gap`
      : `${victim.key} is a leaf, so it can simply be detached`,
    parent ? [parent.id] : [],
  );

  yield* retrace(state, parent);
}

export const avlEngine: Engine<AvlState> = {
  id: 'avl',
  label: 'AVL tree',
  invariant: 'Every node keeps its two subtree heights within one of each other.',
  create: () => createBinaryState('height'),
  insert: (state, value) => collect(insertGen(state, value), () => binarySnapshot(state)),
  remove: (state, value) => collect(removeGen(state, value), () => binarySnapshot(state)),
  snapshot: (state): Snapshot => binarySnapshot(state),
  keys: (state) => inorderKeys(state.root),
};

/** Exported for the tests, which check the invariant directly. */
export function avlInvariantBroken(state: AvlState): string | null {
  const walk = (node: BinaryNode | null): number => {
    if (!node) return -1;
    const left = walk(node.left);
    const right = walk(node.right);
    const real = 1 + Math.max(left, right);
    if (node.height !== real) throw new Error(`stored height ${node.height} at ${node.key} should be ${real}`);
    if (Math.abs(left - right) > 1) throw new Error(`node ${node.key} is out of balance (${left} vs ${right})`);
    return real;
  };
  try {
    walk(state.root);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

export { findNode as avlFind };
