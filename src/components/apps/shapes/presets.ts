/**
 * The shapes that come with the playground.
 *
 * Almost none of them are typed in as coordinate tables. The five Platonic solids are
 * given as points and nothing else — the edges are "every pair at the shortest distance
 * that occurs", and the faces come from the detector — and the Archimedeans are not given
 * at all, but cut from the Platonics by a `truncate` that knows nothing about any of them.
 *
 * That is worth doing for more than tidiness. A coordinate table would be the answer
 * smuggled in; a graph and a relaxation is the shape being *found*. Every preset here
 * supplies a topology and a rough starting position, and what you see is where the
 * repulsion took it.
 */
import { add, centroid, cross, distance, dot, scale, sub, unit, vec, type Vec3 } from './geometry';
import { detectFaces } from './faces';
import { STOCK_KINDS, type Shape, type VertexKind } from './model';

export interface Blueprint {
  points: Vec3[];
  edges: Array<[number, number]>;
  faces: number[][];
  /** Per-vertex kind, where anything left out is 'plain'. */
  kinds?: Record<number, string>;
}

export interface Preset {
  name: string;
  group: string;
  note: string;
  build(): Blueprint;
}

const PHI = (1 + Math.sqrt(5)) / 2;

// ---------------------------------------------------------------- generic builders

/** Every pair of points as close as the closest pair, within a tolerance. */
function shortestEdges(points: Vec3[], tolerance = 0.08): Array<[number, number]> {
  let nearest = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      nearest = Math.min(nearest, distance(points[i], points[j]));
    }
  }
  const ceiling = nearest * (1 + tolerance);
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (distance(points[i], points[j]) <= ceiling) edges.push([i, j]);
    }
  }
  return edges;
}

/**
 * A solid from its vertices alone. The edges are the shortest distance that occurs and the
 * faces are whatever the detector makes of the result — which for the Platonic solids is
 * exactly right, and is the one place in this file where two separate pieces of the
 * program have to agree about what a face is.
 */
function fromPoints(points: Vec3[]): Blueprint {
  const edges = shortestEdges(points);
  return { points, edges, faces: detectFaces(points, edges) };
}

/** All sign combinations of a triple, skipping the zeros so nothing is duplicated. */
function signs(a: number, b: number, c: number): Vec3[] {
  const out: Vec3[] = [];
  for (const x of a === 0 ? [0] : [a, -a]) {
    for (const y of b === 0 ? [0] : [b, -b]) {
      for (const z of c === 0 ? [0] : [c, -c]) out.push(vec(x, y, z));
    }
  }
  return out;
}

/** The three cyclic rotations of a coordinate triple, each with all its sign changes. */
function cyclic(a: number, b: number, c: number): Vec3[] {
  return [...signs(a, b, c), ...signs(b, c, a), ...signs(c, a, b)];
}

function ring(count: number, radius: number, height: number, turn = 0): Vec3[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = turn + (index * 2 * Math.PI) / count;
    return vec(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
  });
}

/** The side of a regular n-gon inscribed in a circle of radius r. */
function side(count: number, radius: number): number {
  return 2 * radius * Math.sin(Math.PI / count);
}

// ---------------------------------------------------------------- the Platonic solids

function tetrahedron(): Blueprint {
  return fromPoints([vec(1, 1, 1), vec(1, -1, -1), vec(-1, 1, -1), vec(-1, -1, 1)]);
}

function cube(): Blueprint {
  return fromPoints(signs(1, 1, 1));
}

function octahedron(): Blueprint {
  return fromPoints(cyclic(1, 0, 0));
}

function dodecahedron(): Blueprint {
  return fromPoints([...signs(1, 1, 1), ...cyclic(0, 1 / PHI, PHI)]);
}

function icosahedron(): Blueprint {
  return fromPoints(cyclic(0, 1, PHI));
}

// ---------------------------------------------------------------- truncation

interface Adjacency {
  points: Vec3[];
  edges: Array<[number, number]>;
  faces: number[][];
  around: number[][];
}

/**
 * The edges at each vertex, in cyclic order around it.
 *
 * Needed because cutting a corner off leaves a polygon where the corner was, and a polygon
 * needs its rim in order. Every solid here is convex and centred on the origin, so the
 * outward direction at a vertex is the vertex itself, and sorting the edges by angle in
 * the plane across it is enough.
 */
function edgeRings(points: Vec3[], edges: Array<[number, number]>): number[][] {
  const middle = centroid(points);
  return points.map((point, index) => {
    const out = unit(sub(point, middle));
    const seed = Math.abs(out.z) < 0.9 ? vec(0, 0, 1) : vec(1, 0, 0);
    const u = unit(cross(out, seed));
    const w = cross(out, u);
    const incident = edges
      .map((edge, edgeIndex) => ({ edge, edgeIndex }))
      .filter(({ edge }) => edge[0] === index || edge[1] === index);
    return incident
      .map(({ edge, edgeIndex }) => {
        const other = points[edge[0] === index ? edge[1] : edge[0]];
        const along = sub(other, point);
        return { edgeIndex, angle: Math.atan2(dot(along, w), dot(along, u)) };
      })
      .sort((a, b) => a.angle - b.angle)
      .map((entry) => entry.edgeIndex);
  });
}

function prepare(blueprint: Blueprint): Adjacency {
  return { ...blueprint, around: edgeRings(blueprint.points, blueprint.edges) };
}

/**
 * Cut every corner off, `t` of the way along each edge.
 *
 * Each edge becomes two vertices, one near each of its ends. A corner of degree d becomes
 * a d-gon; a face of n sides becomes a 2n-gon. At t = 1/2 the two vertices on an edge
 * would coincide, which is `rectify` below and a different answer, so this stops short.
 *
 * Nothing in here is specific to any solid. Truncating a tetrahedron at 1/3 gives the
 * truncated tetrahedron and truncating an icosahedron at 1/3 gives the football, and the
 * function cannot tell the difference.
 */
function truncate(blueprint: Blueprint, t = 1 / 3): Blueprint {
  const { points, edges, faces, around } = prepare(blueprint);
  const cut: Vec3[] = [];
  /** Where the vertex cut from end `v` of edge `e` ended up. */
  const slot = new Map<string, number>();

  edges.forEach(([a, b], edgeIndex) => {
    slot.set(`${edgeIndex}:${a}`, cut.length);
    cut.push(add(points[a], scale(sub(points[b], points[a]), t)));
    slot.set(`${edgeIndex}:${b}`, cut.length);
    cut.push(add(points[b], scale(sub(points[a], points[b]), t)));
  });

  const newEdges: Array<[number, number]> = [];
  // What is left of each original edge, now shortened at both ends.
  edges.forEach(([a, b], edgeIndex) => {
    newEdges.push([slot.get(`${edgeIndex}:${a}`)!, slot.get(`${edgeIndex}:${b}`)!]);
  });

  const newFaces: number[][] = [];
  // The polygon exposed at each corner, whose rim is the corner's edges in order.
  points.forEach((_, index) => {
    const rim = around[index].map((edgeIndex) => slot.get(`${edgeIndex}:${index}`)!);
    for (let i = 0; i < rim.length; i += 1) newEdges.push([rim[i], rim[(i + 1) % rim.length]]);
    newFaces.push(rim);
  });

  // Each original face keeps its identity, with twice as many vertices.
  for (const face of faces) {
    const members = new Set(face);
    const grown: number[] = [];
    edges.forEach(([a, b], edgeIndex) => {
      if (!members.has(a) || !members.has(b)) return;
      grown.push(slot.get(`${edgeIndex}:${a}`)!, slot.get(`${edgeIndex}:${b}`)!);
    });
    newFaces.push(grown);
  }

  return { points: cut, edges: newEdges, faces: newFaces };
}

/**
 * Truncation taken all the way to the midpoints, so each edge collapses to a single
 * vertex. Rectifying a cube gives a cuboctahedron; rectifying an icosahedron gives an
 * icosidodecahedron.
 */
function rectify(blueprint: Blueprint): Blueprint {
  const { points, edges, faces, around } = prepare(blueprint);
  const mid = edges.map(([a, b]) => scale(add(points[a], points[b]), 0.5));

  const newEdges: Array<[number, number]> = [];
  const newFaces: number[][] = [];

  // Each corner becomes a polygon on the midpoints of its own edges, and those polygons
  // between them already account for every edge of the result.
  around.forEach((rim) => {
    for (let i = 0; i < rim.length; i += 1) newEdges.push([rim[i], rim[(i + 1) % rim.length]]);
    newFaces.push([...rim]);
  });

  for (const face of faces) {
    const members = new Set(face);
    const grown = edges
      .map((edge, edgeIndex) => ({ edge, edgeIndex }))
      .filter(({ edge }) => members.has(edge[0]) && members.has(edge[1]))
      .map(({ edgeIndex }) => edgeIndex);
    newFaces.push(grown);
  }

  return { points: mid, edges: newEdges, faces: newFaces };
}

/**
 * Split every triangle into four, and push the new midpoints out onto the sphere. Applied
 * to an icosahedron this is how a geodesic dome is laid out, and it is the one preset here
 * with vertices of two different degrees — twelve of five and the rest of six — which is
 * not a choice but a theorem: no arrangement of hexagons alone closes up.
 */
function subdivide(blueprint: Blueprint): Blueprint {
  const points = [...blueprint.points];
  const middle = centroid(blueprint.points);
  const reach = blueprint.points.reduce((most, point) => Math.max(most, distance(point, middle)), 0);

  const mids = new Map<string, number>();
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const found = mids.get(key);
    if (found !== undefined) return found;
    const at = scale(add(blueprint.points[a], blueprint.points[b]), 0.5);
    const index = points.length;
    points.push(add(middle, scale(unit(sub(at, middle)), reach)));
    mids.set(key, index);
    return index;
  };

  const faces: number[][] = [];
  const edges = new Map<string, [number, number]>();
  const link = (a: number, b: number): void => {
    edges.set(a < b ? `${a}:${b}` : `${b}:${a}`, [a, b]);
  };

  for (const face of blueprint.faces) {
    if (face.length !== 3) continue;
    const [a, b, c] = ringOrder(face, blueprint.edges);
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    for (const triangle of [
      [a, ab, ca],
      [b, bc, ab],
      [c, ca, bc],
      [ab, bc, ca],
    ]) {
      faces.push(triangle);
      link(triangle[0], triangle[1]);
      link(triangle[1], triangle[2]);
      link(triangle[2], triangle[0]);
    }
  }

  return { points, edges: [...edges.values()], faces };
}

/**
 * Raise a pyramid on every face. The apexes are given their own kind, so turning that
 * kind's charge up and down drives the spikes in and out.
 */
function augment(blueprint: Blueprint, apexKind: string, lift = 0.6): Blueprint {
  const points = [...blueprint.points];
  const edges = [...blueprint.edges];
  const faces: number[][] = [];
  const kinds: Record<number, string> = { ...(blueprint.kinds ?? {}) };
  const middle = centroid(blueprint.points);

  for (const face of blueprint.faces) {
    const corners = face.map((index) => blueprint.points[index]);
    const seat = centroid(corners);
    const apex = points.length;
    points.push(add(seat, scale(unit(sub(seat, middle)), lift)));
    kinds[apex] = apexKind;

    const rim = ringOrder(face, blueprint.edges);
    for (const index of rim) edges.push([apex, index]);
    for (let i = 0; i < rim.length; i += 1) {
      faces.push([apex, rim[i], rim[(i + 1) % rim.length]]);
    }
  }

  return { points, edges, faces, kinds };
}

/** A face's vertices walked in rim order through the edges it sits on. */
function ringOrder(face: number[], edges: Array<[number, number]>): number[] {
  const members = new Set(face);
  const near = new Map<number, number[]>(face.map((index) => [index, []]));
  for (const [a, b] of edges) {
    if (!members.has(a) || !members.has(b)) continue;
    near.get(a)!.push(b);
    near.get(b)!.push(a);
  }
  const order = [face[0]];
  const seen = new Set(order);
  while (order.length < face.length) {
    const next = (near.get(order[order.length - 1]) ?? []).find((candidate) => !seen.has(candidate));
    if (next === undefined) return face;
    order.push(next);
    seen.add(next);
  }
  return order;
}

// ---------------------------------------------------------------- families

function prism(count: number): Blueprint {
  const radius = 1;
  const half = side(count, radius) / 2;
  const points = [...ring(count, radius, -half), ...ring(count, radius, half)];
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < count; i += 1) {
    edges.push([i, (i + 1) % count]);
    edges.push([count + i, count + ((i + 1) % count)]);
    edges.push([i, count + i]);
  }
  const faces: number[][] = [
    Array.from({ length: count }, (_, index) => index),
    Array.from({ length: count }, (_, index) => count + index),
  ];
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    faces.push([i, next, count + next, count + i]);
  }
  return { points, edges, faces };
}

function antiprism(count: number): Blueprint {
  const radius = 1;
  const half = side(count, radius) / 2;
  const points = [...ring(count, radius, -half), ...ring(count, radius, half, Math.PI / count)];
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < count; i += 1) {
    edges.push([i, (i + 1) % count]);
    edges.push([count + i, count + ((i + 1) % count)]);
    edges.push([i, count + i]);
    edges.push([count + i, (i + 1) % count]);
  }
  const faces: number[][] = [
    Array.from({ length: count }, (_, index) => index),
    Array.from({ length: count }, (_, index) => count + index),
  ];
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    faces.push([i, count + i, next]);
    faces.push([count + i, next, count + next]);
  }
  return { points, edges, faces };
}

function pyramid(count: number, apexKind: string): Blueprint {
  const points = [...ring(count, 1, -0.4), vec(0, 1, 0)];
  const apex = count;
  const edges: Array<[number, number]> = [];
  const faces: number[][] = [Array.from({ length: count }, (_, index) => index)];
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    edges.push([i, next], [i, apex]);
    faces.push([i, next, apex]);
  }
  return { points, edges, faces, kinds: { [apex]: apexKind } };
}

function bipyramid(count: number, apexKind: string): Blueprint {
  const points = [...ring(count, 1, 0), vec(0, 1.1, 0), vec(0, -1.1, 0)];
  const top = count;
  const bottom = count + 1;
  const edges: Array<[number, number]> = [];
  const faces: number[][] = [];
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    edges.push([i, next], [i, top], [i, bottom]);
    faces.push([i, next, top], [i, next, bottom]);
  }
  return { points, edges, faces, kinds: { [top]: apexKind, [bottom]: apexKind } };
}

function torus(around: number, through: number): Blueprint {
  const big = 2;
  const small = 0.9;
  const points: Vec3[] = [];
  for (let i = 0; i < around; i += 1) {
    const theta = (i * 2 * Math.PI) / around;
    for (let j = 0; j < through; j += 1) {
      const phi = (j * 2 * Math.PI) / through;
      const reach = big + small * Math.cos(phi);
      points.push(vec(reach * Math.cos(theta), small * Math.sin(phi), reach * Math.sin(theta)));
    }
  }
  const at = (i: number, j: number): number => ((i + around) % around) * through + ((j + through) % through);
  const edges: Array<[number, number]> = [];
  const faces: number[][] = [];
  for (let i = 0; i < around; i += 1) {
    for (let j = 0; j < through; j += 1) {
      edges.push([at(i, j), at(i + 1, j)], [at(i, j), at(i, j + 1)]);
      faces.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
    }
  }
  return { points, edges, faces };
}

function polygon(count: number): Blueprint {
  const points = ring(count, 1, 0);
  const edges: Array<[number, number]> = Array.from({ length: count }, (_, index) => [
    index,
    (index + 1) % count,
  ]);
  return { points, edges, faces: [Array.from({ length: count }, (_, index) => index)] };
}

/** A hexagonal patch of the triangular lattice, `reach` rings out from the middle. */
function lattice(reach: number): Blueprint {
  const points: Vec3[] = [];
  for (let q = -reach; q <= reach; q += 1) {
    for (let r = -reach; r <= reach; r += 1) {
      if (Math.abs(q + r) > reach) continue;
      points.push(vec(q + r / 2, 0, (r * Math.sqrt(3)) / 2));
    }
  }
  const edges = shortestEdges(points, 0.02);
  return { points, edges, faces: detectFaces(points, edges) };
}

// ---------------------------------------------------------------- the list

export const PRESETS: Preset[] = [
  {
    name: 'Tetrahedron',
    group: 'Platonic',
    note: 'Four vertices, all joined. The one shape whose graph leaves the geometry no choice at all.',
    build: tetrahedron,
  },
  {
    name: 'Cube',
    group: 'Platonic',
    note: 'A cube. Its square faces are floppy on their own; what squares them is the face diagonals pushing apart.',
    build: cube,
  },
  { name: 'Octahedron', group: 'Platonic', note: 'Six vertices, eight triangles. Also what four charges do around a middle.', build: octahedron },
  { name: 'Dodecahedron', group: 'Platonic', note: 'Twelve pentagons. The one that needs a tidy-up most often.', build: dodecahedron },
  { name: 'Icosahedron', group: 'Platonic', note: 'Twenty triangles — and the answer to the Thomson problem for twelve points.', build: icosahedron },

  { name: 'Triangular prism', group: 'Prisms', note: 'Two triangles and three squares.', build: () => prism(3) },
  { name: 'Pentagonal prism', group: 'Prisms', note: 'Watch the squares stay square without anything telling them to.', build: () => prism(5) },
  { name: 'Hexagonal prism', group: 'Prisms', note: 'Six squares around two hexagons.', build: () => prism(6) },
  { name: 'Square antiprism', group: 'Prisms', note: 'Two squares, twisted, with eight triangles between them.', build: () => antiprism(4) },
  { name: 'Pentagonal antiprism', group: 'Prisms', note: 'An icosahedron with its two caps taken off.', build: () => antiprism(5) },

  {
    name: 'Truncated tetrahedron',
    group: 'Archimedean',
    note: 'The tetrahedron with its corners cut a third of the way along each edge. Cut, not tabulated.',
    build: () => truncate(tetrahedron(), 1 / 3),
  },
  {
    name: 'Cuboctahedron',
    group: 'Archimedean',
    note: 'A cube truncated all the way to its edge midpoints. Eight triangles and six squares.',
    build: () => rectify(cube()),
  },
  {
    name: 'Icosidodecahedron',
    group: 'Archimedean',
    note: 'An icosahedron truncated to its midpoints: twenty triangles and twelve pentagons.',
    build: () => rectify(icosahedron()),
  },
  {
    name: 'Truncated icosahedron',
    group: 'Archimedean',
    note: 'The football. Sixty vertices, and the same cut that made the truncated tetrahedron.',
    build: () => truncate(icosahedron(), 1 / 3),
  },
  {
    name: 'Geodesic sphere',
    group: 'Archimedean',
    note: 'An icosahedron with every triangle split in four. Twelve vertices still have five neighbours and the other thirty have six, which is why a dome needs those twelve pentagons.',
    build: () => subdivide(icosahedron()),
  },

  { name: 'Square pyramid', group: 'Pyramids', note: 'A heavy apex over a plain square. Change the apex kind and the slope changes.', build: () => pyramid(4, 'heavy') },
  {
    name: 'Hexagonal pyramid',
    group: 'Pyramids',
    note: 'Needs a huge apex to stand up at all: a regular hexagon has its side and its radius the same, so an apex with plain edges lies flat in the middle. Drop it to heavy and watch it collapse.',
    build: () => pyramid(6, 'huge'),
  },
  { name: 'Trigonal bipyramid', group: 'Pyramids', note: 'Three at the equator, two at the poles — the shape five charges find on a sphere.', build: () => bipyramid(3, 'heavy') },
  { name: 'Pentagonal bipyramid', group: 'Pyramids', note: 'Seven vertices. Try making the poles light and watch it flatten.', build: () => bipyramid(5, 'heavy') },

  {
    name: 'Spiked octahedron',
    group: 'Open',
    note: 'A pyramid raised on each of the octahedron\u2019s eight faces. The spikes are their own kind, so their charge sets how far they stick out.',
    build: () => augment(octahedron(), 'light', 0.7),
  },
  {
    name: 'Torus',
    group: 'Open',
    note: 'A grid wrapped round twice, and the one shape here the model will not make regular. Its hole survives, but the ring stretches: nothing sits inside it to push back.',
    build: () => torus(8, 6),
  },

  { name: 'Hexagon', group: 'Flat', note: 'Six vertices, one face. The simplest thing that has a face at all.', build: () => polygon(6) },
  { name: 'Decagon', group: 'Flat', note: 'Ten in a ring. Left to itself a long ring buckles; the face is what holds it flat.', build: () => polygon(10) },
  { name: 'Triangle patch', group: 'Flat', note: 'A piece of the triangular lattice, with a rim that is free to curl.', build: () => lattice(2) },
];

export const PRESET_GROUPS = ['Platonic', 'Prisms', 'Archimedean', 'Pyramids', 'Open', 'Flat'];

/** A blueprint as a shape, with the current palette carried over. */
export function toShape(blueprint: Blueprint, kinds: VertexKind[] = STOCK_KINDS): Shape {
  const vertices = blueprint.points.map((point, index) => ({
    id: index + 1,
    kind: blueprint.kinds?.[index] ?? 'plain',
    position: point,
  }));
  const offset = blueprint.points.length + 1;
  const edges = blueprint.edges.map(([a, b], index) => ({
    id: offset + index,
    a: a + 1,
    b: b + 1,
  }));
  const faceOffset = offset + blueprint.edges.length;
  const faces = blueprint.faces
    .filter((face) => face.length >= 3)
    .map((face, index) => ({ id: faceOffset + index, vertices: face.map((member) => member + 1) }));

  return {
    vertices,
    edges,
    faces,
    kinds,
    nextVertex: blueprint.points.length + 1,
    next: faceOffset + faces.length,
  };
}
