import {
  type BinaryNode,
  type BinaryState,
  type Event,
  binarySnapshot,
  collect,
  createBinaryState,
  ev,
  inorderKeys,
  makeNode,
  rotateLeft,
  rotateRight,
  transplant,
} from './binary';
import type { Engine, Snapshot } from './types';

/*
 * Treap: a binary search tree on the keys and a heap on a random priority given
 * to each node. The keys decide where a node goes, the priorities decide how
 * high it sits, and because the priorities are random the shape is the shape of
 * a randomly built tree however the keys arrive.
 */

export type TreapState = BinaryState;

function* bubbleUp(state: TreapState, node: BinaryNode): Generator<Event, void> {
  while (node.parent && node.priority > node.parent.priority) {
    const parent = node.parent;
    const wasLeft = parent.left === node;
    if (wasLeft) rotateRight(state, parent);
    else rotateLeft(state, parent);
    yield ev(
      'rotate',
      `${node.key} has priority ${node.priority}, above the ${parent.priority} at its parent ${parent.key}, so rotate ${wasLeft ? 'right' : 'left'} at ${parent.key} to lift ${node.key} over it`,
      [node.id, parent.id],
    );
  }
  if (node.parent) {
    yield ev(
      'note',
      `Priority ${node.priority} sits below the ${node.parent.priority} at its parent ${node.parent.key}, so the heap order holds and ${node.key} stays where it is`,
      [node.id, node.parent.id],
    );
  } else {
    yield ev('note', `${node.key} has the highest priority in the tree, so it ends up at the root`, [node.id]);
  }
}

function* insertGen(state: TreapState, value: number): Generator<Event, void> {
  if (!state.root) {
    state.root = makeNode(state, value);
    yield ev('insert', `The tree was empty, so ${value} becomes the root with priority ${state.root.priority}`, [
      state.root.id,
    ]);
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
      yield ev(
        'insert',
        `${value} ${goLeft ? '<' : '>'} ${node.key}, so ${value} goes in here as a leaf and draws the random priority ${fresh.priority}`,
        [fresh.id],
      );
      yield* bubbleUp(state, fresh);
      return;
    }
    yield ev('compare', `${value} ${goLeft ? '<' : '>'} ${node.key}, so walk ${goLeft ? 'left' : 'right'}`, [node.id]);
    node = next;
  }
}

function* removeGen(state: TreapState, value: number): Generator<Event, void> {
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

  const target = node;
  const hadChildren = target.left !== null || target.right !== null;
  yield ev(
    'note',
    hadChildren
      ? `Found ${target.key} with priority ${target.priority}, and it still has children, so rotate it down until it is a leaf: each rotation lifts whichever child has the higher priority`
      : `Found ${target.key} with priority ${target.priority}`,
    [target.id],
  );

  while (target.left || target.right) {
    const left = target.left;
    const right = target.right;
    const liftLeft = !right || (left !== null && left.priority > right.priority);
    const lifted = liftLeft ? left : right;
    if (!lifted) break;
    if (liftLeft) rotateRight(state, target);
    else rotateLeft(state, target);
    yield ev(
      'rotate',
      `${lifted.key} has the higher priority of the two children (${lifted.priority}), so rotate ${liftLeft ? 'right' : 'left'} to lift it and push ${target.key} one level down`,
      [target.id, lifted.id],
    );
  }

  const parent = target.parent;
  transplant(state, target, null);
  yield ev(
    'remove',
    hadChildren
      ? `${target.key} is a leaf now, so detach it and the heap order of everything else is untouched`
      : `${target.key} is a leaf already, so detach it and nothing else has to move`,
    parent ? [parent.id] : [],
  );
}

export const treapEngine: Engine<TreapState> = {
  id: 'treap',
  label: 'Treap',
  invariant: 'A search tree on the keys and a max-heap on a random priority, which is what keeps it balanced.',
  create: (options) => createBinaryState('priority', options?.seed ?? 7),
  insert: (state, value) => collect(insertGen(state, value), () => binarySnapshot(state)),
  remove: (state, value) => collect(removeGen(state, value), () => binarySnapshot(state)),
  snapshot: (state): Snapshot => binarySnapshot(state),
  keys: (state) => inorderKeys(state.root),
};

/** Exported for the tests: the priorities have to form a max-heap. */
export function treapInvariantBroken(state: TreapState): string | null {
  const walk = (node: BinaryNode | null): void => {
    if (!node) return;
    for (const child of [node.left, node.right]) {
      if (child && child.priority > node.priority) {
        throw new Error(`child ${child.key} (${child.priority}) outranks its parent ${node.key} (${node.priority})`);
      }
    }
    walk(node.left);
    walk(node.right);
  };
  try {
    walk(state.root);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}
