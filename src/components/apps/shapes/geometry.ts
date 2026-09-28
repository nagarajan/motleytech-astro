/**
 * The engine. Three terms, one of which is optional, and every shape in the playground is
 * a minimum of their sum.
 *
 *   U = T·Σ r          over edges          a constant inward pull along every edge
 *     + K·Σ qq/r       over all pairs      Coulomb repulsion, charge times charge
 *     + W·Σ flatness   over faces          optional, and only bites on faces of 4 or more
 *
 * There is no rest length anywhere. Two vertices joined by an edge sit where the tension
 * and the repulsion cancel, which for the first two terms is at
 *
 *   T = K·q_a·q_b / r²   →   r = √(K·q_a·q_b / T)
 *
 * so with K and T both 1 an edge is exactly the geometric mean of the charges at its ends.
 * Charge 1 means an edge of 1. That is the whole of the size rule.
 *
 * Everything below is the gradient of `energy`, exactly and not approximately. The basin
 * hopping in `settleBest` compares candidates by that number, so a force that was not its
 * derivative would let the relaxer walk away from arrangements its own score preferred.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function vec(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: Vec3, k: number): Vec3 {
  return { x: a.x * k, y: a.y * k, z: a.z * k };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

export function unit(a: Vec3): Vec3 {
  const size = length(a);
  return size < 1e-9 ? vec(1, 0, 0) : scale(a, 1 / size);
}

/** The angle at `b` in the path a-b-c, in degrees. */
export function angleAt(a: Vec3, b: Vec3, c: Vec3): number {
  const cosine = dot(unit(sub(a, b)), unit(sub(c, b)));
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

export function centroid(points: Vec3[]): Vec3 {
  if (points.length === 0) return vec(0, 0, 0);
  let sum = vec(0, 0, 0);
  for (const point of points) sum = add(sum, point);
  return scale(sum, 1 / points.length);
}

/**
 * Points spread over a sphere by the golden-angle spiral. Deterministic, because the same
 * shape built by the same clicks has to come out the same every time.
 */
export function spherePoints(count: number): Vec3[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const points: Vec3[] = [];
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (2 * index) / (count - 1 || 1);
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * index;
    points.push(vec(Math.cos(theta) * ring, y, Math.sin(theta) * ring));
  }
  return points;
}

const CANDIDATES = spherePoints(512);

/** The direction furthest from every direction already taken. */
export function openDirection(taken: Vec3[]): Vec3 {
  if (taken.length === 0) return vec(1, 0, 0);
  if (taken.length === 1) return scale(unit(taken[0]), -1);

  const directions = taken.map(unit);
  let best = CANDIDATES[0];
  let bestScore = Infinity;
  for (const candidate of CANDIDATES) {
    let nearest = -Infinity;
    for (const direction of directions) nearest = Math.max(nearest, dot(candidate, direction));
    if (nearest < bestScore) {
      bestScore = nearest;
      best = candidate;
    }
  }
  return best;
}

// ---------------------------------------------------------------- linear algebra

/**
 * The eigenvector of the smallest eigenvalue of a symmetric 3x3 matrix, by cyclic Jacobi,
 * along with that eigenvalue. Used to find the plane a face is trying to lie in.
 *
 * Jacobi rather than the closed-form cubic because the closed form loses its footing on
 * exactly the inputs that matter here: a face already flat has a zero eigenvalue and a
 * face that is also regular has two equal ones, and the cubic's discriminant goes to
 * pieces at both.
 */
export function smallestEigen(m: number[][]): { value: number; vector: Vec3 } {
  const a = [
    [m[0][0], m[0][1], m[0][2]],
    [m[1][0], m[1][1], m[1][2]],
    [m[2][0], m[2][1], m[2][2]],
  ];
  const basis = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let sweep = 0; sweep < 24; sweep += 1) {
    const off = a[0][1] * a[0][1] + a[0][2] * a[0][2] + a[1][2] * a[1][2];
    if (off < 1e-24) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (Math.abs(a[p][q]) < 1e-18) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const sign = theta >= 0 ? 1 : -1;
      const t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;

      for (let k = 0; k < 3; k += 1) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k += 1) {
        const apk = a[p][k];
        const aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k += 1) {
        const vkp = basis[k][p];
        const vkq = basis[k][q];
        basis[k][p] = c * vkp - s * vkq;
        basis[k][q] = s * vkp + c * vkq;
      }
    }
  }

  let best = 0;
  for (let i = 1; i < 3; i += 1) if (a[i][i] < a[best][best]) best = i;
  return {
    value: a[best][best],
    vector: unit(vec(basis[0][best], basis[1][best], basis[2][best])),
  };
}

/** Two unit vectors perpendicular to `normal` and to each other. */
export function basisFor(normal: Vec3): { u: Vec3; w: Vec3 } {
  const seed = Math.abs(normal.z) < 0.9 ? vec(0, 0, 1) : vec(1, 0, 0);
  const u = unit(cross(normal, seed));
  return { u, w: cross(normal, u) };
}

/**
 * The vertices of a face in cyclic order around its own best-fit plane.
 *
 * Faces are stored as unordered sets of vertices, deliberately: it means a face made by
 * clicking four vertices in any order is the same face, and it means the preset builders
 * and the truncation below never have to keep a winding straight. The order is recovered
 * from the geometry wherever it is actually needed, which is drawing.
 */
export function faceOrder(points: Vec3[]): number[] {
  const indices = points.map((_, index) => index);
  if (points.length < 3) return indices;
  const middle = centroid(points);
  const spread = points.map((point) => sub(point, middle));
  const normal = smallestEigen(scatter(spread)).vector;
  const { u, w } = basisFor(normal);
  return indices.sort((a, b) => Math.atan2(dot(spread[a], w), dot(spread[a], u)) - Math.atan2(dot(spread[b], w), dot(spread[b], u)));
}

/** Σ dᵢdᵢᵀ for already-centred offsets. */
export function scatter(spread: Vec3[]): number[][] {
  const m = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const d of spread) {
    m[0][0] += d.x * d.x;
    m[0][1] += d.x * d.y;
    m[0][2] += d.x * d.z;
    m[1][1] += d.y * d.y;
    m[1][2] += d.y * d.z;
    m[2][2] += d.z * d.z;
  }
  m[1][0] = m[0][1];
  m[2][0] = m[0][2];
  m[2][1] = m[1][2];
  return m;
}

// ---------------------------------------------------------------- the relaxation

export interface Body {
  position: Vec3;
  /** Size, repulsion strength and half an edge length, all the same number. */
  charge: number;
  /** Held still: forces are computed for its neighbours' sake and then discarded. */
  pinned?: boolean;
}

export interface Link {
  a: number;
  b: number;
}

/** Edge tension, and the strength of the repulsion. Both 1, which is what makes charge readable. */
export const TENSION = 1;
export const COULOMB = 1;
/** How hard a face insists on being flat. Dimensionless, since the flatness measure is. */
export const FLATTEN = 6;

const STEP = 0.02;
const MAX_STEP = 0.15;
/** Enough momentum to coast over the saddles that a freshly closed ring lands on. */
const DRAG = 0.9;
const SETTLED = 1e-8;
/** Below this the Coulomb term is nonsense anyway, and the force would be enormous. */
const FLOOR = 1e-4;

export interface Rules {
  /** Whether faces of four or more vertices are held flat. */
  flatten: boolean;
}

/**
 * How far a face is from lying in a plane, between 0 and 1/3.
 *
 * The obvious measure — the sum of squared distances from the best-fit plane — has units
 * of area, which would make the term's weight mean something different on a big shape than
 * on a small one. Dividing by the face's own spread takes the units out: it is the
 * fraction of the face's variance that points out of its plane, so a weight chosen once
 * works at every scale. Triangles are always flat and are skipped.
 */
function flatness(points: Vec3[]): { value: number; normal: Vec3; middle: Vec3; spread: Vec3[]; trace: number } | null {
  if (points.length < 4) return null;
  const middle = centroid(points);
  const spread = points.map((point) => sub(point, middle));
  const m = scatter(spread);
  const trace = m[0][0] + m[1][1] + m[2][2];
  if (trace < 1e-12) return null;
  const { value, vector } = smallestEigen(m);
  return { value: Math.max(0, value) / trace, normal: vector, middle, spread, trace };
}

/**
 * The number every force below is the gradient of, and the number basin hopping compares
 * candidate shapes by.
 */
export function energy(bodies: Body[], links: Link[], faces: number[][], rules: Rules): number {
  let total = 0;

  for (const link of links) {
    total += TENSION * distance(bodies[link.a].position, bodies[link.b].position);
  }

  for (const [a, b] of repellingPairs(bodies, links)) {
    const gap = Math.max(FLOOR, distance(bodies[a].position, bodies[b].position));
    total += (COULOMB * bodies[a].charge * bodies[b].charge) / gap;
  }

  if (rules.flatten) {
    for (const face of faces) {
      const measure = flatness(face.map((index) => bodies[index].position));
      if (measure) total += FLATTEN * measure.value;
    }
  }

  return total;
}

/**
 * Settle the shape. Mutates positions in place, returns the iterations actually used.
 */
export function settle(
  bodies: Body[],
  links: Link[],
  faces: number[][],
  rules: Rules,
  steps = 1200,
): number {
  const count = bodies.length;
  if (count < 2) {
    if (count === 1) bodies[0].position = vec(0, 0, 0);
    return 0;
  }

  const pairs = repellingPairs(bodies, links);
  const force: Vec3[] = bodies.map(() => vec(0, 0, 0));
  const drift: Vec3[] = bodies.map(() => vec(0, 0, 0));
  let used = 0;

  for (let iteration = 0; iteration < steps; iteration += 1) {
    used = iteration + 1;
    for (let index = 0; index < count; index += 1) force[index] = vec(0, 0, 0);

    // Every edge pulls with the same force whatever its length. That is what "no rest
    // length" means: an edge never pushes, and never stops pulling.
    for (const link of links) {
      apply(force, bodies, link.a, link.b, () => TENSION);
    }

    for (const [a, b] of pairs) {
      const shove = COULOMB * bodies[a].charge * bodies[b].charge;
      apply(force, bodies, a, b, (gap) => -shove / (Math.max(FLOOR, gap) * Math.max(FLOOR, gap)));
    }

    if (rules.flatten) flatten(force, bodies, faces);

    let largest = 0;
    for (let index = 0; index < count; index += 1) {
      if (bodies[index].pinned) continue;
      let shift = add(scale(drift[index], DRAG), scale(force[index], STEP));
      const size = length(shift);
      if (size > MAX_STEP) shift = scale(shift, MAX_STEP / size);
      drift[index] = shift;
      bodies[index].position = add(bodies[index].position, shift);
      largest = Math.max(largest, size);
    }
    if (largest < SETTLED) break;
  }

  if (!bodies.some((body) => body.pinned)) centre(bodies);
  return used;
}

/**
 * The flattening force, as the exact gradient of `FLATTEN · λ_min / trace`.
 *
 * Both derivatives come out clean. The eigenvalue's is Hellmann–Feynman — hold the
 * eigenvector fixed and differentiate the quadratic form — and the centroid's contribution
 * cancels in both because the offsets sum to zero by construction:
 *
 *   ∂λ/∂xᵢ = 2(n̂·dᵢ)n̂        ∂τ/∂xᵢ = 2dᵢ
 *   ∂(λ/τ)/∂xᵢ = (2/τ)·[(n̂·dᵢ)n̂ − (λ/τ)·dᵢ]
 *
 * which says, readably, that a vertex is pulled towards the plane and the whole face is
 * allowed to grow to reduce the ratio. The second half is why the term is unitless.
 */
function flatten(force: Vec3[], bodies: Body[], faces: number[][]): void {
  for (const face of faces) {
    const measure = flatness(face.map((index) => bodies[index].position));
    if (!measure) continue;
    const { value, normal, spread, trace } = measure;
    face.forEach((vertexIndex, slot) => {
      const d = spread[slot];
      const out = dot(normal, d);
      const gradient = scale(sub(scale(normal, out), scale(d, value)), 2 / trace);
      force[vertexIndex] = sub(force[vertexIndex], scale(gradient, FLATTEN));
    });
  }
}

/**
 * Basin hopping: settle, then repeatedly shove the calmest shape found so far and settle
 * again, keeping anything better.
 *
 * Downhill alone is not enough. A graph with a cycle in it has real local minima that are
 * the wrong shape — a cube that has settled into a twisted antiprism with every vertex in
 * genuine equilibrium — and no amount of further rolling escapes one. The shoves are drawn
 * from a fixed seed and a hop is only kept when it strictly improves, so this is
 * deterministic and cannot make an answer worse.
 *
 * `hops` of 1 is pure downhill, which is what an interactive edit uses: it keeps the shape
 * from leaping about while someone is building it.
 */
export function settleBest(
  bodies: Body[],
  links: Link[],
  faces: number[][],
  rules: Rules,
  steps = 1200,
  hops = 1,
): void {
  settle(bodies, links, faces, rules, steps);
  if (hops <= 1 || links.length < 2) return;

  let best = bodies.map((body) => body.position);
  let calmest = energy(bodies, links, faces, rules);
  const random = seeded(0x5eed1e);
  // Shoves in proportion to the shape, so this behaves the same on a tetrahedron of edge 1
  // and a buckyball of edge 2.
  const reach = Math.max(0.2, radius(bodies) * 0.5);

  /**
   * Three sizes of shove in rotation: a nudge to polish, a push to cross a nearby ridge,
   * and every third hop a shove so large it amounts to starting again.
   *
   * The big one is what earns its keep. Every hop restarts from the best shape found so
   * far, so without it a deep wrong minimum is a trap: of forty cubes dropped in at random
   * positions, five settle wrong, and forty hops of the two smaller kicks rescue none of
   * them. With the scramble, sixteen hops rescue all five.
   */
  const KICKS = [0.3, 1, 3];

  for (let hop = 1; hop < hops; hop += 1) {
    const kick = reach * KICKS[hop % KICKS.length];
    bodies.forEach((body, index) => {
      // A pinned vertex is held even through a shove, or hopping would quietly undo the pin.
      body.position = body.pinned
        ? best[index]
        : add(best[index], scale(vec(random() - 0.5, random() - 0.5, random() - 0.5), kick));
    });
    settle(bodies, links, faces, rules, steps);
    const score = energy(bodies, links, faces, rules);
    if (score < calmest - 1e-9) {
      calmest = score;
      best = bodies.map((body) => body.position);
    }
  }

  bodies.forEach((body, index) => (body.position = best[index]));
  if (!bodies.some((body) => body.pinned)) centre(bodies);
}

/**
 * Which pairs repel.
 *
 * Every pair does, bonded or not — that is the difference between this and a
 * ball-and-stick model, and it is what makes a face regular rather than merely closed.
 * The one restriction is that two vertices in separate, unconnected pieces are left alone.
 * Nothing attracts across that gap, so without the restriction two disconnected fragments
 * would simply accelerate away from each other for ever.
 */
function repellingPairs(bodies: Body[], links: Link[]): Array<[number, number]> {
  const count = bodies.length;
  const adjacency: number[][] = bodies.map(() => []);
  for (const link of links) {
    adjacency[link.a].push(link.b);
    adjacency[link.b].push(link.a);
  }
  const piece = fragments(count, adjacency);

  const pairs: Array<[number, number]> = [];
  for (let a = 0; a < count; a += 1) {
    for (let b = a + 1; b < count; b += 1) {
      if (piece[a] === piece[b]) pairs.push([a, b]);
    }
  }
  return pairs;
}

function fragments(count: number, adjacency: number[][]): number[] {
  const label = new Array<number>(count).fill(-1);
  let next = 0;
  for (let start = 0; start < count; start += 1) {
    if (label[start] !== -1) continue;
    const stack = [start];
    label[start] = next;
    while (stack.length) {
      const here = stack.pop()!;
      for (const there of adjacency[here]) {
        if (label[there] !== -1) continue;
        label[there] = next;
        stack.push(there);
      }
    }
    next += 1;
  }
  return label;
}

/** Mulberry32: small, fast, and identical on every machine, which is the point. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let drawn = Math.imul(state ^ (state >>> 15), 1 | state);
    drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn;
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296;
  };
}

function apply(
  force: Vec3[],
  bodies: Body[],
  a: number,
  b: number,
  magnitude: (gap: number) => number,
): void {
  const along = sub(bodies[b].position, bodies[a].position);
  const gap = length(along);
  if (gap < 1e-6) {
    // Exactly coincident, so there is no direction to separate along. Nudge them apart on
    // an axis and let the next iteration do the real work.
    force[a] = add(force[a], vec(-0.1, 0, 0));
    force[b] = add(force[b], vec(0.1, 0, 0));
    return;
  }
  const strength = magnitude(gap);
  if (strength === 0) return;
  const push = scale(along, strength / gap);
  force[a] = add(force[a], push);
  force[b] = sub(force[b], push);
}

export function centre(bodies: Body[]): void {
  if (bodies.length === 0) return;
  const middle = centroid(bodies.map((body) => body.position));
  for (const body of bodies) body.position = sub(body.position, middle);
}

/** The distance from the middle to the furthest vertex. */
export function radius(bodies: Body[]): number {
  const middle = centroid(bodies.map((body) => body.position));
  let furthest = 0;
  for (const body of bodies) furthest = Math.max(furthest, distance(body.position, middle));
  return furthest;
}

/** The radius of the smallest sphere at the origin containing every vertex and its ball. */
export function extent(bodies: Body[], radii: number[]): number {
  let furthest = 0;
  bodies.forEach((body, index) => {
    furthest = Math.max(furthest, length(body.position) + (radii[index] ?? 0));
  });
  return furthest;
}
