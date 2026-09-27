/*
 * The four simulators share one contract: an operation mutates the engine's own
 * mutable tree and returns a list of steps, where every step carries a caption
 * and a full snapshot of the tree at that moment. The player can then walk the
 * list in either direction without re-running any algorithm, and the renderer
 * only ever draws a snapshot.
 */

export type NodeId = number;

/** Stable across an operation, so the renderer can animate a node rather than replace it. */
export type BinaryNodeView = {
  id: NodeId;
  key: number;
  left: BinaryNodeView | null;
  right: BinaryNodeView | null;
  /** AVL only: distance to the deepest descendant leaf. */
  height?: number;
  /** Red-Black only. */
  red?: boolean;
  /** Treap only: the heap priority. */
  priority?: number;
};

export type BTreeNodeView = {
  id: NodeId;
  keys: number[];
  children: BTreeNodeView[];
};

export type Snapshot =
  | { shape: 'binary'; root: BinaryNodeView | null }
  | { shape: 'btree'; root: BTreeNodeView | null; maxKeys: number };

/** Drives the colour and the icon the step gets in the log. */
export type StepMark =
  | 'compare'
  | 'insert'
  | 'remove'
  | 'rotate'
  | 'recolor'
  | 'split'
  | 'merge'
  | 'borrow'
  | 'swap'
  | 'note';

export type Step = {
  caption: string;
  mark: StepMark;
  /** Nodes to highlight while this step is on screen. */
  focus: NodeId[];
  /** Keys to pick out inside the focused nodes, used by the B-tree. */
  focusKeys?: number[];
  snapshot: Snapshot;
};

export type EngineId = 'avl' | 'redblack' | 'treap' | 'btree';

export type EngineOptions = {
  /** B-tree only: keys per node before it has to split. */
  maxKeys?: number;
  /** Treap only: makes the random priorities reproducible. */
  seed?: number;
};

export type Engine<State> = {
  id: EngineId;
  label: string;
  /** One line under the tabs describing the invariant being maintained. */
  invariant: string;
  create(options?: EngineOptions): State;
  insert(state: State, value: number): Step[];
  remove(state: State, value: number): Step[];
  snapshot(state: State): Snapshot;
  keys(state: State): number[];
};

/** An engine with its state type erased, which is all the UI needs. */
export type AnyEngine = Engine<unknown>;
