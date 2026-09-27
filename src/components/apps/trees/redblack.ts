import {
  type BinaryNode,
  type BinaryState,
  type Event,
  binarySnapshot,
  collect,
  createBinaryState,
  describeChildren,
  ev,
  inorderKeys,
  isRed,
  makeNode,
  minimum,
  rotateLeft,
  rotateRight,
  transplant,
} from './binary';
import type { Engine, Snapshot } from './types';

/*
 * Red-Black: new nodes arrive red so no black height changes, and the repair
 * work is a short list of recolour and rotate cases. Deleting a black node
 * leaves one branch a black short, which is the "double black" the fixup walks
 * up the tree until it can be absorbed.
 */

export type RedBlackState = BinaryState;

const colour = (node: BinaryNode | null): string => (isRed(node) ? 'red' : 'black');

function* insertFixup(state: RedBlackState, inserted: BinaryNode): Generator<Event, void> {
  let node = inserted;
  while (node !== state.root && isRed(node.parent)) {
    const parent = node.parent;
    if (!parent) break;
    const grand = parent.parent;
    if (!grand) break;
    const parentIsLeft = grand.left === parent;
    const uncle = parentIsLeft ? grand.right : grand.left;

    if (isRed(uncle) && uncle) {
      parent.red = false;
      uncle.red = false;
      grand.red = true;
      yield ev(
        'recolor',
        `${node.key} and its parent ${parent.key} are both red, and so is the uncle ${uncle.key}: repaint ${parent.key} and ${uncle.key} black and ${grand.key} red, which keeps every black height the same`,
        [parent.id, uncle.id, grand.id],
      );
      node = grand;
      continue;
    }

    if (parentIsLeft && node === parent.right) {
      rotateLeft(state, parent);
      yield ev(
        'rotate',
        `${node.key} is the inner grandchild, so rotate left at ${parent.key} to move it to the outside`,
        [node.id, parent.id],
      );
      node = parent;
    } else if (!parentIsLeft && node === parent.left) {
      rotateRight(state, parent);
      yield ev(
        'rotate',
        `${node.key} is the inner grandchild, so rotate right at ${parent.key} to move it to the outside`,
        [node.id, parent.id],
      );
      node = parent;
    }

    const newParent = node.parent;
    const newGrand = newParent?.parent;
    if (!newParent || !newGrand) break;
    newParent.red = false;
    newGrand.red = true;
    const pivotKey = newGrand.key;
    if (newGrand.left === newParent) rotateRight(state, newGrand);
    else rotateLeft(state, newGrand);
    yield ev(
      'rotate',
      `The uncle is black, so repaint ${newParent.key} black and ${pivotKey} red, then rotate at ${pivotKey}: ${newParent.key} takes over the subtree with one red child on each side`,
      [newParent.id, newGrand.id],
    );
    break;
  }

  if (state.root && state.root.red) {
    state.root.red = false;
    yield ev('recolor', `The root has to be black, so repaint ${state.root.key}`, [state.root.id]);
  }
}

function* insertGen(state: RedBlackState, value: number): Generator<Event, void> {
  if (!state.root) {
    state.root = makeNode(state, value);
    state.root.red = false;
    yield ev('insert', `The tree was empty, so ${value} becomes the root and the root is always black`, [state.root.id]);
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
      fresh.red = true;
      fresh.parent = node;
      if (goLeft) node.left = fresh;
      else node.right = fresh;
      yield ev(
        'insert',
        `${value} ${goLeft ? '<' : '>'} ${node.key} and that slot is free, so ${value} goes in red: a red node adds no black to any path`,
        [fresh.id],
      );
      if (!isRed(node)) {
        yield ev('note', `Its parent ${node.key} is black, so nothing is broken and the insert is done`, [node.id, fresh.id]);
        return;
      }
      yield ev('note', `Its parent ${node.key} is red too, and two reds in a row are not allowed`, [node.id, fresh.id]);
      yield* insertFixup(state, fresh);
      return;
    }
    yield ev('compare', `${value} ${goLeft ? '<' : '>'} ${node.key}, so walk ${goLeft ? 'left' : 'right'}`, [node.id]);
    node = next;
  }
}

/**
 * `short` is the subtree that is one black short; it can be null, which is why
 * the parent has to be passed alongside it.
 */
function* fixDoubleBlack(
  state: RedBlackState,
  short: BinaryNode | null,
  shortParent: BinaryNode | null,
): Generator<Event, void> {
  let node = short;
  let parent = shortParent;

  while (node !== state.root && !isRed(node)) {
    if (!parent) break;
    const nodeIsLeft = parent.left === node;
    let sibling = nodeIsLeft ? parent.right : parent.left;

    if (isRed(sibling) && sibling) {
      sibling.red = false;
      parent.red = true;
      const pivotKey = parent.key;
      const siblingKey = sibling.key;
      if (nodeIsLeft) rotateLeft(state, parent);
      else rotateRight(state, parent);
      yield ev(
        'rotate',
        `The sibling ${siblingKey} is red: rotate at ${pivotKey} and swap their colours, so the short side ends up with a black sibling instead`,
        [parent.id, sibling.id],
      );
      sibling = nodeIsLeft ? parent.right : parent.left;
    }

    if (!sibling) {
      node = parent;
      parent = parent.parent;
      continue;
    }

    if (!isRed(sibling.left) && !isRed(sibling.right)) {
      sibling.red = true;
      const parentKey = parent.key;
      yield ev(
        'recolor',
        `The sibling ${sibling.key} is black with no red children: paint it red, which takes one black off both sides of ${parentKey} and moves the shortage up to ${parentKey}`,
        [sibling.id, parent.id],
      );
      node = parent;
      parent = parent.parent;
      continue;
    }

    if (nodeIsLeft) {
      if (!isRed(sibling.right)) {
        const near = sibling.left;
        if (near) near.red = false;
        sibling.red = true;
        const siblingKey = sibling.key;
        rotateRight(state, sibling);
        yield ev(
          'rotate',
          `The sibling's far child is black but its near child ${near?.key} is red, so rotate right at ${siblingKey} to swing that red child to the outside`,
          [sibling.id],
        );
        sibling = parent.right;
        if (!sibling) break;
      }
      sibling.red = parent.red;
      parent.red = false;
      if (sibling.right) sibling.right.red = false;
      const pivotKey = parent.key;
      rotateLeft(state, parent);
      yield ev(
        'rotate',
        `The sibling's far child is red: rotate left at ${pivotKey} and repaint, which hands the short side the black it was missing and ends the fixup`,
        [sibling.id, parent.id],
      );
    } else {
      if (!isRed(sibling.left)) {
        const near = sibling.right;
        if (near) near.red = false;
        sibling.red = true;
        const siblingKey = sibling.key;
        rotateLeft(state, sibling);
        yield ev(
          'rotate',
          `The sibling's far child is black but its near child ${near?.key} is red, so rotate left at ${siblingKey} to swing that red child to the outside`,
          [sibling.id],
        );
        sibling = parent.left;
        if (!sibling) break;
      }
      sibling.red = parent.red;
      parent.red = false;
      if (sibling.left) sibling.left.red = false;
      const pivotKey = parent.key;
      rotateRight(state, parent);
      yield ev(
        'rotate',
        `The sibling's far child is red: rotate right at ${pivotKey} and repaint, which hands the short side the black it was missing and ends the fixup`,
        [sibling.id, parent.id],
      );
    }

    node = state.root;
    parent = null;
  }

  if (node && node.red) {
    node.red = false;
    yield ev('recolor', `${node.key} was red, so painting it black absorbs the missing black and the tree is valid again`, [
      node.id,
    ]);
  }
}

function* removeGen(state: RedBlackState, value: number): Generator<Event, void> {
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

  yield ev('note', `Found ${value}, it is ${colour(node)}, ${describeChildren(node)}`, [node.id]);

  let victim = node;
  if (node.left && node.right) {
    const successor = minimum(node.right);
    yield ev(
      'swap',
      `${node.key} has two children, so its in-order successor ${successor.key} moves into this node and the successor node is the one that gets removed`,
      [node.id, successor.id],
    );
    node.key = successor.key;
    victim = successor;
  }

  const removedWasRed = victim.red;
  const parent = victim.parent;
  const child = victim.left ?? victim.right;
  const victimKey = victim.key;
  transplant(state, victim, child);
  yield ev(
    'remove',
    `Detach the ${colour(victim)} node ${victimKey}${child ? ` and pull ${child.key} up into its place` : ''}`,
    parent ? [parent.id] : [],
  );

  if (removedWasRed) {
    yield ev('note', `${victimKey} was red, so no path lost a black node and there is nothing to repair`, []);
  } else if (isRed(child) && child) {
    child.red = false;
    yield ev('recolor', `${victimKey} was black, but ${child.key} took its place and can simply be painted black`, [child.id]);
  } else {
    yield ev(
      'note',
      `${victimKey} was black, so every path through this spot is now one black short: that shortage has to be repaired`,
      parent ? [parent.id] : [],
    );
    yield* fixDoubleBlack(state, child, parent);
  }

  if (state.root && state.root.red) {
    state.root.red = false;
    yield ev('recolor', `The root has to be black, so repaint ${state.root.key}`, [state.root.id]);
  }
}

export const redBlackEngine: Engine<RedBlackState> = {
  id: 'redblack',
  label: 'Red-Black tree',
  invariant: 'No red node parents another, and every path from a node down to a leaf passes the same number of black nodes.',
  create: () => createBinaryState('color'),
  insert: (state, value) => collect(insertGen(state, value), () => binarySnapshot(state)),
  remove: (state, value) => collect(removeGen(state, value), () => binarySnapshot(state)),
  snapshot: (state): Snapshot => binarySnapshot(state),
  keys: (state) => inorderKeys(state.root),
};

/** Exported for the tests: root black, no red-red, and equal black heights. */
export function redBlackInvariantBroken(state: RedBlackState): string | null {
  if (state.root && state.root.red) return 'the root is red';
  const walk = (node: BinaryNode | null): number => {
    if (!node) return 1;
    if (node.red && (isRed(node.left) || isRed(node.right))) {
      throw new Error(`red node ${node.key} has a red child`);
    }
    const left = walk(node.left);
    const right = walk(node.right);
    if (left !== right) throw new Error(`black heights differ under ${node.key} (${left} vs ${right})`);
    return left + (node.red ? 0 : 1);
  };
  try {
    walk(state.root);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}
