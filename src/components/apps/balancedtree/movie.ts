/**
 * The AVL animation from the 2020 version of this post, rebuilt so a whole run
 * can be precomputed instead of played straight out of a generator onto the
 * DOM. The algorithm and its narration are deliberately the original ones —
 * `../trees/avl.ts` is the general purpose engine behind the newer simulator.
 *
 * Every yield of the insert generator becomes one frame holding the position of
 * each value, which is what makes stepping backwards and jumping possible: the
 * player only ever reads frames, it never runs the algorithm.
 */

/** The tree is drawn in percentages of the stage, one row per level. */
const FIRST_ROW = 27;
const ROW_GAP = 12;

/** Matched by the `.head` chip, which the player positions from here. */
export const HEAD_SPOT = { top: 15, left: 40 };

/** The floating node trails this far to the right of whatever it is visiting. */
const CURSOR_NUDGE = 5;

/** Values still waiting sit in a row along the top, this far apart. */
const QUEUE_GAP = 4;
const QUEUE_INSET = 2;

export const MAX_VALUES = 24;

type Point = { top: number; left: number };

type MovieNode = {
  index: number;
  value: number;
  left: MovieNode | null;
  right: MovieNode | null;
  parent: MovieNode | null;
  height: number;
};

type Tree = { root: MovieNode | null };

/** A caption and the node it is about, or null for the head of the tree. */
type Event = [caption: string, target: MovieNode | null];

/** Captions describing the walk down: these annotate the value being inserted. */
const WALKING = new Set([
  'Inserting into tree',
  'Compare',
  'Go left',
  'Go right',
  'Insert at left',
  'Insert at right',
]);

export type Connector = {
  left: string;
  top: string;
  width: string;
  height: string;
  mirrored: boolean;
};

export type Placement = {
  index: number;
  value: number;
  top: string;
  left: string;
  /** The subscript, or null while the value is not in the tree yet. */
  height: number | null;
  walking: boolean;
  /** The line up to the parent, absent until the value has a parent to join. */
  line: Connector | null;
};

export type Frame = {
  caption: string;
  /** Which chip carries the tooltip: an input index, the head, or nothing. */
  tooltipOn: number | 'head' | null;
  /** One entry per input value, in input order, so React keys stay put. */
  nodes: Placement[];
};

function makeNode(value: number, index: number): MovieNode {
  return { index, value, left: null, right: null, parent: null, height: 0 };
}

function setLeft(parent: MovieNode, child: MovieNode | null): void {
  parent.left = child;
  if (child) child.parent = parent;
}

function setRight(parent: MovieNode, child: MovieNode | null): void {
  parent.right = child;
  if (child) child.parent = parent;
}

function childHeights(node: MovieNode): [number, number] {
  return [node.left ? node.left.height : -1, node.right ? node.right.height : -1];
}

function refreshHeight(node: MovieNode): void {
  const [left, right] = childHeights(node);
  node.height = Math.max(left, right) + 1;
}

function leansLeft(node: MovieNode): boolean {
  const [left, right] = childHeights(node);
  return left > right;
}

function leansRight(node: MovieNode): boolean {
  const [left, right] = childHeights(node);
  return right > left;
}

/**
 * Hangs `now` where `was` used to hang. The caller captures the parent before
 * rewiring, because by this point `was.parent` already points at its new home.
 */
function replaceChild(tree: Tree, parent: MovieNode | null, was: MovieNode, now: MovieNode): void {
  if (!parent) {
    tree.root = now;
    now.parent = null;
    return;
  }
  if (parent.left === was) setLeft(parent, now);
  else setRight(parent, now);
}

function* rotateLeft(tree: Tree, node: MovieNode, recurse = true): Generator<Event, void> {
  // An inner heavy grandchild has to swing outwards first, or one rotation just
  // tips the tree the other way.
  if (recurse && node.right && leansLeft(node.right)) {
    yield* rotateRight(tree, node.right, false);
  }

  yield ['Rotate left', node];
  const newRoot = node.right;
  if (!newRoot) return;
  const parent = node.parent;
  setRight(node, newRoot.left);
  setLeft(newRoot, node);
  replaceChild(tree, parent, node, newRoot);
  refreshHeight(node);
  refreshHeight(newRoot);
  yield ['Rotate left', node];
}

function* rotateRight(tree: Tree, node: MovieNode, recurse = true): Generator<Event, void> {
  if (recurse && node.left && leansRight(node.left)) {
    yield* rotateLeft(tree, node.left, false);
  }

  yield ['Rotate right', node];
  const newRoot = node.left;
  if (!newRoot) return;
  const parent = node.parent;
  setLeft(node, newRoot.right);
  setRight(newRoot, node);
  replaceChild(tree, parent, node, newRoot);
  refreshHeight(node);
  refreshHeight(newRoot);
  yield ['Rotate right', node];
}

function* balance(tree: Tree, node: MovieNode): Generator<Event, void> {
  const [left, right] = childHeights(node);
  if (left - right > 1) yield* rotateRight(tree, node);
  else if (right - left > 1) yield* rotateLeft(tree, node);
}

function* insertBelow(tree: Tree, at: MovieNode, node: MovieNode): Generator<Event, void> {
  yield ['Compare', at];
  if (node.value < at.value) {
    if (at.left) {
      yield ['Go left', at];
      yield ['Go left', at.left];
      yield* insertBelow(tree, at.left, node);
    } else {
      yield ['Insert at left', at];
      setLeft(at, node);
      yield ['Inserted', node];
    }
  } else {
    if (at.right) {
      yield ['Go right', at];
      yield ['Go right', at.right];
      yield* insertBelow(tree, at.right, node);
    } else {
      yield ['Insert at right', at];
      setRight(at, node);
      yield ['Inserted', node];
    }
  }
  // Unwinding the recursion is what retraces the heights up to the root.
  yield ['Check Heights and Balance', at];
  refreshHeight(at);
  yield* balance(tree, at);
}

function* insert(tree: Tree, node: MovieNode): Generator<Event, void> {
  yield ['Inserting into tree', null];
  if (tree.root) {
    yield* insertBelow(tree, tree.root, node);
  } else {
    tree.root = node;
  }
  yield ['Completed Insertion', null];
}

function spotOf(depth: number, offset: number): Point {
  return { top: depth * ROW_GAP + FIRST_ROW, left: (100 * (offset + 0.5)) / 2 ** depth };
}

function connector(child: Point, parent: Point): Connector {
  return {
    left: `${Math.min(child.left, parent.left)}%`,
    top: `${Math.min(child.top, parent.top)}%`,
    width: `${Math.abs(child.left - parent.left)}%`,
    height: `${Math.abs(child.top - parent.top)}%`,
    // The drawn curve runs top left to bottom right, so a child on the left of
    // its parent needs it flipped.
    mirrored: child.left < parent.left,
  };
}

function queueSpot(rank: number): { top: string; left: string } {
  return { top: '1em', left: `${rank * QUEUE_GAP + QUEUE_INSET}em` };
}

/** Walks the tree breadth first, recording where each node is drawn. */
function placements(tree: Tree): Map<number, { point: Point; height: number; parent: number | null }> {
  const found = new Map<number, { point: Point; height: number; parent: number | null }>();
  if (!tree.root) return found;

  const queue: Array<[MovieNode, number, number]> = [[tree.root, 0, 0]];
  while (queue.length) {
    const [node, depth, offset] = queue.shift()!;
    found.set(node.index, {
      point: spotOf(depth, offset),
      height: node.height,
      parent: node.parent ? node.parent.index : null,
    });
    if (node.left) queue.push([node.left, depth + 1, offset * 2]);
    if (node.right) queue.push([node.right, depth + 1, offset * 2 + 1]);
  }
  return found;
}

function frameOf(
  values: number[],
  tree: Tree,
  caption: string,
  target: MovieNode | null,
  current: MovieNode | null,
  waiting: number[],
): Frame {
  const placed = placements(tree);
  const walkingNow = current !== null && !placed.has(current.index);

  // The floating value shadows whatever it is being compared against.
  const visiting = target ? placed.get(target.index)?.point ?? HEAD_SPOT : HEAD_SPOT;
  const cursorPoint = { top: visiting.top, left: visiting.left + CURSOR_NUDGE };

  const nodes = values.map((value, index) => {
    const here = placed.get(index);
    if (here) {
      const parentPoint = here.parent === null ? HEAD_SPOT : placed.get(here.parent)?.point ?? HEAD_SPOT;
      return {
        index,
        value,
        top: `${here.point.top}%`,
        left: `${here.point.left}%`,
        height: here.height,
        walking: false,
        line: connector(here.point, parentPoint),
      };
    }
    if (walkingNow && current && current.index === index) {
      return {
        index,
        value,
        top: `${cursorPoint.top}%`,
        left: `${cursorPoint.left}%`,
        height: null,
        walking: true,
        line: null,
      };
    }
    const rank = waiting.indexOf(index);
    return { index, value, ...queueSpot(rank < 0 ? 0 : rank), height: null, walking: false, line: null };
  });

  let tooltipOn: number | 'head' | null = null;
  if (WALKING.has(caption)) tooltipOn = current ? current.index : 'head';
  else if (caption) tooltipOn = target ? target.index : 'head';

  return { caption, tooltipOn, nodes };
}

/**
 * Runs every insertion up front and returns one frame per narrated moment. The
 * first frame is the line-up, before anything has been inserted.
 */
export function buildFrames(values: number[]): Frame[] {
  const tree: Tree = { root: null };
  const nodes = values.map((value, index) => makeNode(value, index));
  const everyone = values.map((_, index) => index);

  const frames: Frame[] = [frameOf(values, tree, '', null, null, everyone)];
  frames[0].caption = values.length ? 'Waiting to start' : 'No values to insert';

  for (let i = 0; i < nodes.length; i += 1) {
    const waiting = everyone.slice(i + 1);
    for (const [caption, target] of insert(tree, nodes[i])) {
      frames.push(frameOf(values, tree, caption, target, nodes[i], waiting));
    }
  }
  return frames;
}

export type ParsedInput = { values: number[]; error: string };

export function parseInput(text: string): ParsedInput {
  const pieces = text
    .split(',')
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);

  const values: number[] = [];
  for (const piece of pieces) {
    const value = Number(piece);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return { values: [], error: `"${piece}" is not a whole number.` };
    }
    values.push(value);
  }

  if (!values.length) return { values: [], error: 'Enter some comma separated numbers.' };
  if (values.length > MAX_VALUES) {
    return { values: [], error: `That is ${values.length} values; ${MAX_VALUES} is as many as fits on the stage.` };
  }
  return { values, error: '' };
}
