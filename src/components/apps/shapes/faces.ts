/**
 * Finding the faces of a shape that has only vertices and edges.
 *
 * The naive answer — every short cycle is a face — is wrong, and an octahedron is the
 * counterexample that shows why. Its eight triangles are the faces, but its three
 * equatorial squares are also perfectly good chordless four-cycles, and nothing local
 * distinguishes them. Adding "smallest first" is not enough on its own either.
 *
 * What settles it is a property of polyhedra rather than of cycles: **every edge borders
 * exactly two faces**. So collect the chordless cycles, sort them shortest and flattest
 * first, and accept one only if every edge it uses still has room. The octahedron's eight
 * triangles fill all twelve edges twice over, and the equatorial squares arrive to find
 * nothing left to claim.
 *
 * The same rule does the right thing at a boundary. A flat hexagon of six vertices has one
 * cycle and takes one face, not two, because there is no second cycle to claim the other
 * side; a patch of triangles keeps its rim edges at one face each.
 */
import { centroid, scatter, smallestEigen, sub, type Vec3 } from './geometry';

/** Long cycles are not faces of anything anyone is going to build here. */
const LONGEST = 8;
/** How far out of plane a cycle may be and still count, as a fraction of its own spread. */
const WOBBLE = 0.06;
/** A ceiling on the search, so a dense graph cannot lock the page up. */
const MAX_CYCLES = 20000;

export interface Candidate {
  vertices: number[];
  flatness: number;
}

/**
 * Every chordless cycle of at most `LONGEST` vertices.
 *
 * Chordlessness is enforced while the path is being built rather than checked afterwards:
 * a vertex may only be added if it touches the path's last vertex and nothing else in it,
 * except the start, and touching the start closes the cycle and ends that branch. Each
 * cycle is found from its lowest-numbered vertex, and the two directions round it are
 * separated by insisting the second vertex be lower than the last.
 */
function chordlessCycles(count: number, adjacency: Set<number>[]): number[][] {
  const found: number[][] = [];
  const path: number[] = [];

  function walk(start: number): void {
    const last = path[path.length - 1];
    if (found.length >= MAX_CYCLES) return;

    for (const next of adjacency[last]) {
      if (next < start || path.includes(next)) continue;

      // A chord is an edge to anything in the path other than the vertex we came from and
      // the start we are trying to get back to.
      let chorded = false;
      for (let i = 1; i < path.length - 1; i += 1) {
        if (adjacency[next].has(path[i])) {
          chorded = true;
          break;
        }
      }
      if (chorded) continue;

      // Every first step is adjacent to the start, so closing is only on the table once
      // there is a path long enough to close into a triangle.
      if (path.length >= 2 && adjacency[next].has(start)) {
        // Anything beyond this point would have this edge as a chord, so the branch ends
        // here whether the cycle is kept or not.
        if (path[1] < next) found.push([...path, next]);
        continue;
      }

      if (path.length + 1 >= LONGEST) continue;
      path.push(next);
      walk(start);
      path.pop();
    }
  }

  for (let start = 0; start < count; start += 1) {
    path.length = 0;
    path.push(start);
    walk(start);
  }
  return found;
}

/** How far a set of points is from lying in a plane, between 0 and 1/3. */
export function wobble(points: Vec3[]): number {
  if (points.length < 4) return 0;
  const middle = centroid(points);
  const spread = points.map((point) => sub(point, middle));
  const m = scatter(spread);
  const trace = m[0][0] + m[1][1] + m[2][2];
  if (trace < 1e-12) return 0;
  return Math.max(0, smallestEigen(m).value) / trace;
}

/**
 * The faces implied by a set of vertices and edges, as index arrays.
 *
 * `existing` are faces already present: they still consume their edges' two slots, so
 * running this on a half-built shape completes it rather than duplicating what is there.
 */
export function detectFaces(
  positions: Vec3[],
  edges: Array<[number, number]>,
  existing: number[][] = [],
): number[][] {
  const count = positions.length;
  if (count < 3 || edges.length < 3) return [];

  const adjacency: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
  for (const [a, b] of edges) {
    if (a === b) continue;
    adjacency[a].add(b);
    adjacency[b].add(a);
  }

  const used = new Map<string, number>();
  const claim = (a: number, b: number): void => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    used.set(key, (used.get(key) ?? 0) + 1);
  };
  const room = (a: number, b: number): boolean => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    return (used.get(key) ?? 0) < 2;
  };

  const taken = new Set<string>();
  for (const face of existing) {
    taken.add(signature(face));
    const ordered = rim(face, adjacency);
    for (let i = 0; i < ordered.length; i += 1) claim(ordered[i], ordered[(i + 1) % ordered.length]);
  }

  const candidates: Candidate[] = chordlessCycles(count, adjacency)
    .map((cycle) => ({ vertices: cycle, flatness: wobble(cycle.map((index) => positions[index])) }))
    .filter((candidate) => candidate.flatness <= WOBBLE && !taken.has(signature(candidate.vertices)));

  // Shortest first, because a face is the smallest thing its edges close around. Flattest
  // next, which is what separates two cycles of equal length when the geometry has an
  // opinion. Then vertex order, so the answer does not depend on the traversal.
  candidates.sort(
    (a, b) =>
      a.vertices.length - b.vertices.length ||
      a.flatness - b.flatness ||
      Math.min(...a.vertices) - Math.min(...b.vertices),
  );

  const accepted: number[][] = [];
  for (const candidate of candidates) {
    const cycle = candidate.vertices;
    let fits = true;
    for (let i = 0; i < cycle.length && fits; i += 1) {
      fits = room(cycle[i], cycle[(i + 1) % cycle.length]);
    }
    if (!fits) continue;
    for (let i = 0; i < cycle.length; i += 1) claim(cycle[i], cycle[(i + 1) % cycle.length]);
    accepted.push(cycle);
  }
  return accepted;
}

function signature(face: number[]): string {
  return [...face].sort((a, b) => a - b).join(',');
}

/**
 * A face's vertices in rim order, walked through the edge graph. Only needed for faces
 * that arrived from somewhere else and may be in any order; the cycles found above are
 * already rims.
 */
function rim(face: number[], adjacency: Set<number>[]): number[] {
  const members = new Set(face);
  const order = [face[0]];
  const seen = new Set([face[0]]);
  while (order.length < face.length) {
    const here = order[order.length - 1];
    const next = [...adjacency[here]].find((candidate) => members.has(candidate) && !seen.has(candidate));
    if (next === undefined) return face;
    order.push(next);
    seen.add(next);
  }
  return order;
}
