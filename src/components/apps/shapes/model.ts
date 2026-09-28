/**
 * The shape itself, and every edit anyone can make to one.
 *
 * A shape is a plain graph — vertices, edges, and faces as unordered sets of vertices —
 * plus a palette of vertex kinds. A vertex carries only its kind, not its charge, so
 * retuning a kind retunes every vertex wearing it and the whole structure rearranges at
 * once. That is the point of having kinds at all.
 *
 * Every edit ends in a relaxation, because a shape that has not settled is not a shape.
 */
import {
  add,
  centroid,
  distance,
  faceOrder,
  openDirection,
  scale,
  settle as relax,
  settleBest,
  sub,
  unit,
  vec,
  type Body,
  type Link,
  type Rules,
  type Vec3,
} from './geometry';

export interface VertexKind {
  id: string;
  name: string;
  /** Repulsion strength, drawn size, and the square of an edge length to its own kind. */
  charge: number;
  colour: string;
  /** Built-in kinds cannot be deleted, only edited. */
  stock?: boolean;
}

export interface Vertex {
  id: number;
  kind: string;
  position: Vec3;
  /** Held where it is, so the rest of the shape has to accommodate it. */
  pinned?: boolean;
}

export interface Edge {
  id: number;
  a: number;
  b: number;
}

export interface Face {
  id: number;
  /** Unordered. The winding for drawing is recovered from the geometry. */
  vertices: number[];
}

export interface Shape {
  vertices: Vertex[];
  edges: Edge[];
  faces: Face[];
  kinds: VertexKind[];
  /**
   * Vertices are numbered on their own, because their numbers are shown and picked from a
   * list. Sharing one counter with the edges made a five-vertex shape come out labelled 1,
   * 2, 4, 7, 11, which is nobody's idea of a vertex list. Edges and faces are only ever
   * identified internally, so they can share.
   */
  nextVertex: number;
  next: number;
}

export const STOCK_KINDS: VertexKind[] = [
  { id: 'light', name: 'Light', charge: 0.55, colour: '#7dd3fc', stock: true },
  { id: 'plain', name: 'Plain', charge: 1, colour: '#e2e8f0', stock: true },
  { id: 'heavy', name: 'Heavy', charge: 1.8, colour: '#f59f0a', stock: true },
  { id: 'huge', name: 'Huge', charge: 3.2, colour: '#f472b6', stock: true },
];

export const EMPTY: Shape = { vertices: [], edges: [], faces: [], kinds: STOCK_KINDS, nextVertex: 1, next: 1 };

export const DEFAULT_RULES: Rules = { flatten: true };

/**
 * A vertex's drawn radius per unit of charge.
 *
 * Linear in charge, so that a vertex is always the same fraction of its own edges however
 * heavy it is — two vertices of any one kind sit `charge` apart and are each drawn at
 * `DRAW_SCALE · charge`, which is the same picture at every scale. Size and charge being
 * literally the same number is the point of the whole knob.
 */
export const DRAW_SCALE = 0.13;

/** Below this a vertex is too small to aim at, whatever its charge says. */
export const DRAW_FLOOR = 0.05;

export function kindOf(shape: Shape, vertex: Vertex): VertexKind {
  return shape.kinds.find((entry) => entry.id === vertex.kind) ?? shape.kinds[0] ?? STOCK_KINDS[1];
}

export function chargeOf(shape: Shape, vertex: Vertex): number {
  return kindOf(shape, vertex).charge;
}

export function vertexAt(shape: Shape, id: number): Vertex | undefined {
  return shape.vertices.find((vertex) => vertex.id === id);
}

export function edgesAt(shape: Shape, id: number): Edge[] {
  return shape.edges.filter((edge) => edge.a === id || edge.b === id);
}

export function facesAt(shape: Shape, id: number): Face[] {
  return shape.faces.filter((face) => face.vertices.includes(id));
}

export function neighbours(shape: Shape, id: number): number[] {
  return edgesAt(shape, id).map((edge) => (edge.a === id ? edge.b : edge.a));
}

export function edgeBetween(shape: Shape, a: number, b: number): Edge | undefined {
  return shape.edges.find(
    (edge) => (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a),
  );
}

/** The length an edge would take if its two ends were alone in the world: √(q_a·q_b). */
export function naturalLength(shape: Shape, edge: Edge): number {
  const a = vertexAt(shape, edge.a);
  const b = vertexAt(shape, edge.b);
  if (!a || !b) return 0;
  return Math.sqrt(chargeOf(shape, a) * chargeOf(shape, b));
}

export function edgeLength(shape: Shape, edge: Edge): number {
  const a = vertexAt(shape, edge.a);
  const b = vertexAt(shape, edge.b);
  return a && b ? distance(a.position, b.position) : 0;
}

// ---------------------------------------------------------------- relaxation

interface Packed {
  bodies: Body[];
  links: Link[];
  faces: number[][];
}

function pack(shape: Shape): Packed {
  const slot = new Map<number, number>();
  shape.vertices.forEach((vertex, index) => slot.set(vertex.id, index));

  const bodies: Body[] = shape.vertices.map((vertex) => ({
    position: vertex.position,
    charge: chargeOf(shape, vertex),
    pinned: vertex.pinned,
  }));

  const links: Link[] = [];
  for (const edge of shape.edges) {
    const a = slot.get(edge.a);
    const b = slot.get(edge.b);
    if (a !== undefined && b !== undefined) links.push({ a, b });
  }

  const faces: number[][] = [];
  for (const face of shape.faces) {
    const members = face.vertices.map((id) => slot.get(id)).filter((index): index is number => index !== undefined);
    if (members.length >= 3) faces.push(members);
  }

  return { bodies, links, faces };
}

function unpack(shape: Shape, packed: Packed): Shape {
  return {
    ...shape,
    vertices: shape.vertices.map((vertex, index) => ({
      ...vertex,
      position: packed.bodies[index].position,
    })),
  };
}

/** One downhill relaxation. What every interactive edit uses. */
export function settle(shape: Shape, rules: Rules, steps = 900): Shape {
  const packed = pack(shape);
  relax(packed.bodies, packed.links, packed.faces, rules, steps);
  return unpack(shape, packed);
}

/** Downhill plus basin hopping. What the tidy-up button uses, and what presets load with. */
export function tidy(shape: Shape, rules: Rules, hops = 14): Shape {
  const packed = pack(shape);
  settleBest(packed.bodies, packed.links, packed.faces, rules, 1400, hops);
  return unpack(shape, packed);
}

/** Enough hops to get a shape this size unstuck, without making an edit feel slow. */
export function hopsFor(shape: Shape): number {
  if (shape.vertices.length > 40) return 4;
  if (shape.vertices.length > 20) return 8;
  return 14;
}

/**
 * Whether `a` and `b` are already joined by some path, so that an edge between them would
 * close a ring.
 *
 * Worth knowing before relaxing, because closing a ring is the one edit that reliably
 * lands in the wrong place. A chain of four vertices is nearly straight, and joining its
 * ends leaves a stretched quadrilateral where every vertex is in genuine equilibrium — a
 * real local minimum, at a 200% spread of edge lengths, that no amount of further rolling
 * escapes. Basin hopping takes the same four vertices to a perfect square. So a ring-
 * closing edit hops and every other one rolls.
 */
export function joined(shape: Shape, a: number, b: number): boolean {
  if (a === b) return true;
  const near = new Map<number, number[]>();
  for (const edge of shape.edges) {
    if (!near.has(edge.a)) near.set(edge.a, []);
    if (!near.has(edge.b)) near.set(edge.b, []);
    near.get(edge.a)!.push(edge.b);
    near.get(edge.b)!.push(edge.a);
  }
  const seen = new Set([a]);
  const stack = [a];
  while (stack.length) {
    const here = stack.pop()!;
    for (const there of near.get(here) ?? []) {
      if (there === b) return true;
      if (seen.has(there)) continue;
      seen.add(there);
      stack.push(there);
    }
  }
  return false;
}

/** Settle, hopping out of the local minimum that closing a ring drops the shape into. */
function rest(shape: Shape, rules: Rules, closedARing: boolean): Shape {
  return closedARing ? tidy(shape, rules, hopsFor(shape)) : settle(shape, rules);
}

// ---------------------------------------------------------------- editing

/**
 * Add a vertex. With vertices selected, the new one arrives joined to all of them and
 * placed on the far side of the shape from their middle, which is where it is going to end
 * up anyway; with nothing selected it lands in the emptiest direction available.
 */
export function addVertex(
  shape: Shape,
  kind: string,
  attachTo: number[],
  rules: Rules,
): { shape: Shape; id: number } {
  const id = shape.nextVertex;
  const anchors = attachTo
    .map((anchor) => vertexAt(shape, anchor))
    .filter((vertex): vertex is Vertex => Boolean(vertex));

  const charge = shape.kinds.find((entry) => entry.id === kind)?.charge ?? 1;
  let position: Vec3;

  if (anchors.length === 0) {
    const taken = shape.vertices.map((vertex) => vertex.position);
    position = scale(openDirection(taken), Math.max(1, reachOf(shape) + Math.sqrt(charge)));
  } else {
    const from = centroid(anchors.map((vertex) => vertex.position));
    const middle = centroid(shape.vertices.map((vertex) => vertex.position));
    const out = distance(from, middle) > 1e-6 ? unit(sub(from, middle)) : openDirection(anchors.map((a) => a.position));
    position = add(from, scale(out, Math.sqrt(charge)));
  }

  const vertices = [...shape.vertices, { id, kind, position }];
  const edges = [...shape.edges];
  let next = shape.next;
  for (const anchor of anchors) {
    edges.push({ id: next, a: anchor.id, b: id });
    next += 1;
  }

  // Hanging a vertex off two anchors that were already connected closes a ring through it.
  const ring = anchors.some((anchor, index) => anchors.slice(index + 1).some((other) => joined(shape, anchor.id, other.id)));

  return { shape: rest({ ...shape, vertices, edges, next, nextVertex: id + 1 }, rules, ring), id };
}

/**
 * Delete a vertex, along with its edges and every face that used it.
 *
 * Taking the vertex out of its faces and keeping them, which is the other obvious reading,
 * turns a square into a triangle that is not bounded by any edges — a face floating free
 * of the graph it is supposed to describe. A face without its corner is not a smaller
 * face; it is gone.
 */
export function deleteVertex(shape: Shape, id: number, rules: Rules): Shape {
  return settle(
    {
      ...shape,
      vertices: shape.vertices.filter((vertex) => vertex.id !== id),
      edges: shape.edges.filter((edge) => edge.a !== id && edge.b !== id),
      faces: shape.faces.filter((face) => !face.vertices.includes(id)),
    },
    rules,
  );
}

export function addEdge(shape: Shape, a: number, b: number, rules: Rules): Shape {
  if (a === b || edgeBetween(shape, a, b)) return shape;
  if (!vertexAt(shape, a) || !vertexAt(shape, b)) return shape;
  return rest(
    { ...shape, edges: [...shape.edges, { id: shape.next, a, b }], next: shape.next + 1 },
    rules,
    joined(shape, a, b),
  );
}

/** Join every selected vertex to every other, which is how a small clique gets built. */
export function addEdges(shape: Shape, ids: number[], rules: Rules): Shape {
  const edges = [...shape.edges];
  let next = shape.next;
  let ring = false;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      if (edges.some((edge) => sameEdge(edge, ids[i], ids[j]))) continue;
      ring = ring || joined({ ...shape, edges }, ids[i], ids[j]);
      edges.push({ id: next, a: ids[i], b: ids[j] });
      next += 1;
    }
  }
  return rest({ ...shape, edges, next }, rules, ring);
}

function sameEdge(edge: Edge, a: number, b: number): boolean {
  return (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a);
}

/**
 * Cut an edge, and drop any face it was part of.
 *
 * Faces are chordless, so an edge with both ends in a face is always one of that face's
 * rim, and a rim with a gap in it does not enclose anything. Cutting an edge of a cube
 * therefore takes both the squares that met along it, which is what makes the hexagon
 * underneath findable.
 */
export function deleteEdge(shape: Shape, id: number, rules: Rules): Shape {
  const going = shape.edges.find((edge) => edge.id === id);
  if (!going) return shape;
  return settle(
    {
      ...shape,
      edges: shape.edges.filter((edge) => edge.id !== id),
      faces: shape.faces.filter(
        (face) => !(face.vertices.includes(going.a) && face.vertices.includes(going.b)),
      ),
    },
    rules,
  );
}

/**
 * Make a face from the selected vertices, and fill in any edge the face implies but the
 * graph is missing, since a face with a hole in its rim is never what anyone meant.
 */
export function addFace(shape: Shape, ids: number[], rules: Rules): { shape: Shape; error?: string } {
  const members = [...new Set(ids)].filter((id) => vertexAt(shape, id));
  if (members.length < 3) return { shape, error: 'A face needs at least three vertices.' };
  const already = shape.faces.find((face) => sameSet(face.vertices, members));
  if (already) return { shape, error: 'Those vertices already carry a face.' };

  const ordered = orderAround(shape, members);
  const edges = [...shape.edges];
  let next = shape.next + 1;
  let ring = false;
  for (let i = 0; i < ordered.length; i += 1) {
    const a = ordered[i];
    const b = ordered[(i + 1) % ordered.length];
    if (edges.some((edge) => sameEdge(edge, a, b))) continue;
    ring = ring || joined({ ...shape, edges }, a, b);
    edges.push({ id: next, a, b });
    next += 1;
  }

  return {
    shape: rest(
      { ...shape, edges, faces: [...shape.faces, { id: shape.next, vertices: members }], next },
      rules,
      // A face is a ring by definition, so it always gets the hops — the rim it just
      // closed is exactly the case that needs them.
      true,
    ),
  };
}

export function deleteFace(shape: Shape, id: number, rules: Rules): Shape {
  return settle({ ...shape, faces: shape.faces.filter((face) => face.id !== id) }, rules);
}

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/** The rim order of a would-be face, so the edges filled in are the rim and not the diagonals. */
function orderAround(shape: Shape, ids: number[]): number[] {
  const points = ids.map((id) => vertexAt(shape, id)!.position);
  return faceOrder(points).map((index) => ids[index]);
}

export function setKind(shape: Shape, id: number, kind: string, rules: Rules): Shape {
  const vertices = shape.vertices.map((vertex) => (vertex.id === id ? { ...vertex, kind } : vertex));
  return settle({ ...shape, vertices }, rules);
}

export function setPinned(shape: Shape, id: number, pinned: boolean, rules: Rules): Shape {
  const vertices = shape.vertices.map((vertex) => (vertex.id === id ? { ...vertex, pinned } : vertex));
  return settle({ ...shape, vertices }, rules);
}

export function moveVertex(shape: Shape, id: number, to: Vec3): Shape {
  return {
    ...shape,
    vertices: shape.vertices.map((vertex) => (vertex.id === id ? { ...vertex, position: to } : vertex)),
  };
}

// ---------------------------------------------------------------- kinds

export function upsertKind(shape: Shape, kind: VertexKind, rules: Rules): Shape {
  const kinds = shape.kinds.some((entry) => entry.id === kind.id)
    ? shape.kinds.map((entry) => (entry.id === kind.id ? { ...entry, ...kind } : entry))
    : [...shape.kinds, kind];
  // A charge change is a change of geometry, so the shape has to be resettled.
  return settle({ ...shape, kinds }, rules);
}

export function deleteKind(shape: Shape, id: string, rules: Rules): Shape {
  const kind = shape.kinds.find((entry) => entry.id === id);
  if (!kind || kind.stock) return shape;
  const fallback = shape.kinds.find((entry) => entry.id !== id)?.id ?? 'plain';
  return settle(
    {
      ...shape,
      kinds: shape.kinds.filter((entry) => entry.id !== id),
      vertices: shape.vertices.map((vertex) => (vertex.kind === id ? { ...vertex, kind: fallback } : vertex)),
    },
    rules,
  );
}

/** A slug that is not already taken, so two kinds called the same thing cannot collide. */
export function kindId(shape: Shape, name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'kind';
  if (!shape.kinds.some((entry) => entry.id === base)) return base;
  let suffix = 2;
  while (shape.kinds.some((entry) => entry.id === `${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

// ---------------------------------------------------------------- measurements

export function reachOf(shape: Shape): number {
  if (shape.vertices.length === 0) return 0;
  const middle = centroid(shape.vertices.map((vertex) => vertex.position));
  let furthest = 0;
  for (const vertex of shape.vertices) furthest = Math.max(furthest, distance(vertex.position, middle));
  return furthest;
}

export interface Report {
  vertices: number;
  edges: number;
  faces: number;
  shortest: number;
  longest: number;
  /** How far the longest edge is above the shortest, as a fraction. 0 means every edge is equal. */
  spread: number;
  /** Vertices − edges + faces. 2 for anything topologically a sphere. */
  euler: number | null;
}

export function report(shape: Shape): Report {
  const lengths = shape.edges.map((edge) => edgeLength(shape, edge)).filter((value) => value > 0);
  const shortest = lengths.length ? Math.min(...lengths) : 0;
  const longest = lengths.length ? Math.max(...lengths) : 0;
  return {
    vertices: shape.vertices.length,
    edges: shape.edges.length,
    faces: shape.faces.length,
    shortest,
    longest,
    spread: shortest > 0 ? longest / shortest - 1 : 0,
    euler: shape.faces.length > 0 ? shape.vertices.length - shape.edges.length + shape.faces.length : null,
  };
}

// ---------------------------------------------------------------- saving

export interface SavedShape {
  vertices: Array<{ id: number; kind: string; at: [number, number, number]; pinned?: boolean }>;
  edges: Array<[number, number, number]>;
  faces: Array<{ id: number; v: number[] }>;
  kinds: VertexKind[];
  nextVertex?: number;
  next: number;
}

export function encode(shape: Shape): SavedShape {
  return {
    vertices: shape.vertices.map((vertex) => ({
      id: vertex.id,
      kind: vertex.kind,
      at: [round(vertex.position.x), round(vertex.position.y), round(vertex.position.z)],
      ...(vertex.pinned ? { pinned: true } : {}),
    })),
    edges: shape.edges.map((edge) => [edge.id, edge.a, edge.b] as [number, number, number]),
    faces: shape.faces.map((face) => ({ id: face.id, v: face.vertices })),
    // Saved with the shape, so a shape still loads correctly after its kinds are retuned
    // or deleted from the palette.
    kinds: shape.kinds,
    nextVertex: shape.nextVertex,
    next: shape.next,
  };
}

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

export function decode(saved: SavedShape): Shape | null {
  if (!saved || !Array.isArray(saved.vertices) || !Array.isArray(saved.edges)) return null;
  try {
    const vertices: Vertex[] = saved.vertices.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      position: vec(entry.at[0], entry.at[1], entry.at[2]),
      ...(entry.pinned ? { pinned: true } : {}),
    }));
    const edges: Edge[] = saved.edges.map(([id, a, b]) => ({ id, a, b }));
    const faces: Face[] = (saved.faces ?? []).map((face) => ({ id: face.id, vertices: face.v }));
    const kinds = Array.isArray(saved.kinds) && saved.kinds.length ? saved.kinds : STOCK_KINDS;
    const highestVertex = Math.max(0, ...vertices.map((vertex) => vertex.id));
    const highest = Math.max(0, ...edges.map((edge) => edge.id), ...faces.map((face) => face.id));
    return {
      vertices,
      edges,
      faces,
      kinds,
      nextVertex: Math.max(saved.nextVertex ?? 0, highestVertex + 1),
      next: Math.max(saved.next ?? 0, highest + 1),
    };
  } catch {
    return null;
  }
}
