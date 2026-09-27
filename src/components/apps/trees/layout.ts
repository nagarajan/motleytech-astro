import type { BinaryNodeView, BTreeNodeView, NodeId, Snapshot } from './types';

/*
 * Turns a snapshot into positions. Binary nodes are placed by in-order rank, so
 * the keys read left to right and the drawing stays compact however lopsided the
 * tree is mid-rotation. B-tree nodes are boxes whose width follows their key
 * count, and a parent is centred over the children it separates.
 *
 * Positions are the centre of a node, which is what the tween works on.
 */

export const BINARY_GEOMETRY = { radius: 19, xGap: 52, yGap: 68, pad: 26 };
export const BTREE_GEOMETRY = { keyWidth: 36, height: 36, pad: 8, siblingGap: 26, yGap: 78, margin: 22 };

export type LayoutNode =
  | { shape: 'binary'; id: NodeId; key: number; annotation: string | null; red: boolean | null }
  | { shape: 'btree'; id: NodeId; keys: number[]; width: number };

/** `slot` is the gap in the parent's key list that this edge leaves from. */
export type LayoutEdge = { key: string; parent: NodeId; child: NodeId; slot: number };

export type Point = { x: number; y: number };

export type Layout = {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  positions: Map<NodeId, Point>;
  /** Lets a freshly inserted node grow out of its parent instead of popping in. */
  parentOf: Map<NodeId, NodeId>;
  width: number;
  height: number;
};

const emptyLayout = (): Layout => ({
  nodes: [],
  edges: [],
  positions: new Map(),
  parentOf: new Map(),
  width: 0,
  height: 0,
});

function annotationFor(node: BinaryNodeView): string | null {
  if (node.height !== undefined) return String(node.height);
  if (node.priority !== undefined) return String(node.priority);
  return null;
}

function layoutBinary(root: BinaryNodeView | null): Layout {
  if (!root) return emptyLayout();
  const { xGap, yGap, pad, radius } = BINARY_GEOMETRY;
  const layout = emptyLayout();
  let rank = 0;
  let deepest = 0;

  const walk = (node: BinaryNodeView, depth: number, parent: NodeId | null): void => {
    if (node.left) walk(node.left, depth + 1, node.id);
    const x = pad + radius + rank * xGap;
    const y = pad + radius + depth * yGap;
    rank += 1;
    deepest = Math.max(deepest, depth);
    layout.nodes.push({
      shape: 'binary',
      id: node.id,
      key: node.key,
      annotation: annotationFor(node),
      red: node.red === undefined ? null : node.red,
    });
    layout.positions.set(node.id, { x, y });
    if (parent !== null) {
      layout.parentOf.set(node.id, parent);
      layout.edges.push({ key: `${parent}-${node.id}`, parent, child: node.id, slot: 0 });
    }
    if (node.right) walk(node.right, depth + 1, node.id);
  };

  walk(root, 0, null);
  layout.width = pad * 2 + radius * 2 + Math.max(0, rank - 1) * xGap;
  layout.height = pad * 2 + radius * 2 + deepest * yGap;
  return layout;
}

export function bTreeNodeWidth(keyCount: number): number {
  const { keyWidth, pad } = BTREE_GEOMETRY;
  return Math.max(1, keyCount) * keyWidth + pad * 2;
}

function layoutBTree(root: BTreeNodeView | null): Layout {
  if (!root) return emptyLayout();
  const { height, siblingGap, yGap, margin } = BTREE_GEOMETRY;
  const layout = emptyLayout();
  let cursor = margin;
  let deepest = 0;
  let rightEdge = margin;

  const place = (node: BTreeNodeView, depth: number, parent: NodeId | null): number => {
    const width = bTreeNodeWidth(node.keys.length);
    deepest = Math.max(deepest, depth);

    let centre: number;
    if (node.children.length === 0) {
      centre = cursor + width / 2;
      cursor += width + siblingGap;
    } else {
      const childCentres = node.children.map((child) => place(child, depth + 1, node.id));
      centre = (childCentres[0] + childCentres[childCentres.length - 1]) / 2;
      // A wide parent over narrow children would otherwise spill into the next
      // subtree, so keep the running cursor past its right edge.
      cursor = Math.max(cursor, centre + width / 2 + siblingGap);
    }

    layout.nodes.push({ shape: 'btree', id: node.id, keys: [...node.keys], width });
    layout.positions.set(node.id, { x: centre, y: margin + height / 2 + depth * yGap });
    rightEdge = Math.max(rightEdge, centre + width / 2);
    if (parent !== null) layout.parentOf.set(node.id, parent);
    node.children.forEach((child, slot) => {
      layout.edges.push({ key: `${node.id}-${child.id}`, parent: node.id, child: child.id, slot });
    });
    return centre;
  };

  place(root, 0, null);
  layout.width = rightEdge + margin;
  layout.height = margin * 2 + height + deepest * yGap;
  return layout;
}

export function layoutSnapshot(snapshot: Snapshot): Layout {
  return snapshot.shape === 'binary' ? layoutBinary(snapshot.root) : layoutBTree(snapshot.root);
}

/** Where an edge leaves its parent: the centre of a circle, or a key boundary of a box. */
export function edgeStart(parent: LayoutNode, position: Point, slot: number): Point {
  if (parent.shape === 'binary') return position;
  const { keyWidth, pad, height } = BTREE_GEOMETRY;
  return { x: position.x - parent.width / 2 + pad + slot * keyWidth, y: position.y + height / 2 };
}

export function edgeEnd(child: LayoutNode, position: Point): Point {
  if (child.shape === 'binary') return position;
  return { x: position.x, y: position.y - BTREE_GEOMETRY.height / 2 };
}
