/**
 * The geometry engine. No chemistry here beyond one idea: things attached to the same atom
 * push each other away, and bonds have a preferred length. Everything else — methane's
 * tetrahedron, carbon dioxide's straight line, benzene's flat hexagon, water's 104.5° —
 * falls out of those two rules on its own.
 *
 * Which is a nicer result than it sounds. Repelling k points on a sphere with an
 * inverse-square force is the Thomson problem, and its answers for small k are exactly the
 * shapes VSEPR predicts: antipodal for two, a triangle for three, a tetrahedron for four, a
 * trigonal bipyramid for five, an octahedron for six. So the relaxation below is not
 * approximating a table of ideal angles, it is deriving them.
 *
 * Lone pairs join in as bodies like any other, distinguished only by a weight above 1 and a
 * flag saying they are not atoms. Nothing here knows what a lone pair is, and that is the
 * point: water bends because a heavier point on the same sphere shoves harder, not because
 * anything checks whether the molecule is water.
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

/**
 * Points spread evenly over a sphere by the golden-angle spiral. Deterministic, which
 * matters: the same molecule built the same way must come out identically every time.
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

/**
 * Where to put one more neighbour: the direction furthest from every direction already
 * taken. Relaxation will tidy it up afterwards, but starting in roughly the right place
 * stops the new atom from having to travel through the middle of the molecule to get
 * there.
 */
export function openDirection(taken: Vec3[]): Vec3 {
  if (taken.length === 0) return vec(1, 0, 0);
  if (taken.length === 1) return scale(unit(taken[0]), -1);

  const directions = taken.map(unit);
  let best = CANDIDATES[0];
  let bestScore = -Infinity;
  for (const candidate of CANDIDATES) {
    // The smallest angle to anything existing, as a dot product: lower is further away.
    let worst = -Infinity;
    for (const direction of directions) {
      worst = Math.max(worst, dot(candidate, direction));
    }
    if (worst < bestScore) continue;
    if (worst > bestScore) {
      bestScore = worst;
      best = candidate;
    }
  }
  return best;
}

export interface RelaxBody {
  position: Vec3;
  /** Bond lengths are measured between nuclei, as the sum of two covalent radii. */
  covalent: number;
  /**
   * How hard this thing shoves its fellow neighbours, relative to a bonding pair at 1.
   * Lone pairs come in above 1, which is what bends water.
   */
  weight?: number;
  /**
   * A lone pair: it takes part in the angle repulsion, because that is its entire purpose,
   * but it is not an atom. It has no van der Waals bulk to keep clear of anything, and it
   * does not count towards where the middle of the molecule is.
   */
  ghost?: boolean;
  /**
   * Held still. Forces on it are computed and then thrown away, which keeps the gradient
   * exact for everything that is still free to move. Used to place the lone pairs of a
   * terminal atom once the molecule around them has already been settled.
   */
  pinned?: boolean;
}

export interface RelaxLink {
  a: number;
  b: number;
  /** A multiple bond is shorter. 1 for single, and below 1 for anything stronger. */
  squeeze?: number;
}

const BOND_PULL = 2;
const NEIGHBOUR_PUSH = 1;
const CLASH_PUSH = 1.1;
/** How close two atoms that are not bonded may come, as a multiple of a bond length. */
const CLASH_RATIO = 1.15;
const STEP = 0.05;
const MAX_STEP = 0.2;
/** Enough momentum to coast through saddle points, which coiled rings otherwise stick on. */
const DRAG = 0.86;
const SETTLED = 1e-7;

/**
 * Settle the structure. Mutates the positions in place and returns the number of
 * iterations actually used, which is fewer than `steps` once nothing is moving.
 */
export function relax(bodies: RelaxBody[], links: RelaxLink[], steps = 900): number {
  const count = bodies.length;
  if (count < 2) {
    if (count === 1) bodies[0].position = vec(0, 0, 0);
    return 0;
  }

  const adjacency: number[][] = bodies.map(() => []);
  for (const link of links) {
    adjacency[link.a].push(link.b);
    adjacency[link.b].push(link.a);
  }

  // Atoms sharing a neighbour: these are the pairs whose mutual shoving creates angles.
  const wedges: Array<{ centre: number; a: number; b: number }> = [];
  for (let middle = 0; middle < count; middle += 1) {
    const ring = adjacency[middle];
    for (let i = 0; i < ring.length; i += 1) {
      for (let j = i + 1; j < ring.length; j += 1) {
        wedges.push({ centre: middle, a: ring[i], b: ring[j] });
      }
    }
  }

  const clashes = loosePairs(bodies, adjacency);

  const force: Vec3[] = bodies.map(() => vec(0, 0, 0));
  const drift: Vec3[] = bodies.map(() => vec(0, 0, 0));
  let used = 0;

  for (let iteration = 0; iteration < steps; iteration += 1) {
    used = iteration + 1;
    for (let index = 0; index < count; index += 1) force[index] = vec(0, 0, 0);

    for (const link of links) {
      const ideal = idealLength(bodies, link);
      apply(force, bodies, link.a, link.b, (gap) => BOND_PULL * (gap - ideal));
    }

    for (const wedge of wedges) {
      push(force, bodies, wedge);
    }

    for (const [a, b] of clashes) {
      const floor = CLASH_RATIO * (bodies[a].covalent + bodies[b].covalent);
      apply(force, bodies, a, b, (gap) => (gap < floor ? CLASH_PUSH * (gap - floor) : 0));
    }

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

  // Recentring would move the pinned bodies, which is the one thing they are for.
  if (!bodies.some((body) => body.pinned)) centre(bodies);
  return used;
}

/**
 * Basin hopping: relax, then repeatedly shove the best arrangement found so far and
 * relax again, keeping any result that is calmer.
 *
 * Plain downhill is not enough once the molecule contains a ring. Closing a ring yanks
 * together two ends that the incremental build left far apart, and the strain of that
 * settles into a symmetric twist which is a real local minimum — every atom in
 * equilibrium, benzene sitting at 115° in a shallow saddle instead of the flat 120°
 * hexagon it should be. Independent random restarts turned out not to fix it either; what
 * works is shoving the *current best* and re-relaxing, so each hop starts from somewhere
 * already sensible. The shoves come from a fixed seed and a hop is only accepted when it
 * strictly improves, so this is deterministic and can never make the answer worse.
 *
 * `hops` of 1 means pure downhill, which is what interactive edits use: it keeps the
 * molecule from leaping about while someone is building it.
 */
export function relaxBest(bodies: RelaxBody[], links: RelaxLink[], steps = 900, hops = 1): void {
  relax(bodies, links, steps);
  if (hops <= 1 || links.length < 2) return;

  let best = bodies.map((body) => body.position);
  let calmest = strain(bodies, links);
  const random = seeded(0x5eed1e);

  for (let hop = 1; hop < hops; hop += 1) {
    // Big shoves explore, small ones polish, so alternate between the two.
    const reach = hop % 2 === 0 ? 0.5 : 1.6;
    bodies.forEach((body, index) => {
      body.position = add(best[index], scale(vec(random() - 0.5, random() - 0.5, random() - 0.5), reach));
    });
    relax(bodies, links, steps);
    const score = strain(bodies, links);
    if (score < calmest - 1e-9) {
      calmest = score;
      best = bodies.map((body) => body.position);
    }
  }

  bodies.forEach((body, index) => (body.position = best[index]));
  centre(bodies);
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

/**
 * How badly the structure violates the rules, as one number, and the thing the forces
 * below are the gradient of. Basin hopping compares candidates with this, so the two must
 * agree: an earlier version applied a sideways-projected repulsion while scoring with the
 * straight-line distance between neighbours, which is not the gradient of anything. The
 * relaxer then walked away from geometries the score called better, and benzene never
 * flattened.
 */
export function strain(bodies: RelaxBody[], links: RelaxLink[]): number {
  const adjacency: number[][] = bodies.map(() => []);
  for (const link of links) {
    adjacency[link.a].push(link.b);
    adjacency[link.b].push(link.a);
  }

  let total = 0;
  for (const link of links) {
    const stretch = distance(bodies[link.a].position, bodies[link.b].position) - idealLength(bodies, link);
    total += 0.5 * BOND_PULL * stretch * stretch;
  }

  for (let middle = 0; middle < bodies.length; middle += 1) {
    const ring = adjacency[middle];
    for (let i = 0; i < ring.length; i += 1) {
      for (let j = i + 1; j < ring.length; j += 1) {
        total += (NEIGHBOUR_PUSH * shove(bodies, ring[i], ring[j])) / apart(bodies, middle, ring[i], ring[j]);
      }
    }
  }

  for (const [a, b] of loosePairs(bodies, adjacency)) {
    const floor = CLASH_RATIO * (bodies[a].covalent + bodies[b].covalent);
    const overlap = distance(bodies[a].position, bodies[b].position) - floor;
    if (overlap < 0) total += 0.5 * CLASH_PUSH * overlap * overlap;
  }

  return total;
}

/**
 * The separation between two neighbours of the same atom, measured on the unit sphere
 * around that atom rather than in space — which is to say 2·sin(θ/2) for the angle θ
 * between them.
 *
 * Using the unit sphere is the whole trick. It makes the repulsion a pure function of
 * angles, so it cannot stretch a bond however hard it pushes, and it makes the resting
 * arrangement of k neighbours the Thomson problem for k points, whose answers are the
 * VSEPR shapes exactly — not approximately, and not dependent on the neighbours being
 * the same distance out. Fluoromethane's angles come out tetrahedral even though the C-F
 * bond is half again as long as the C-H bonds.
 */
function apart(bodies: RelaxBody[], centreIndex: number, a: number, b: number): number {
  const middle = bodies[centreIndex].position;
  return Math.max(1e-9, length(sub(unit(sub(bodies[a].position, middle)), unit(sub(bodies[b].position, middle)))));
}

/**
 * How hard a particular pair shoves, as the product of the two weights.
 *
 * Multiplying is what gives VSEPR's ordering for free: with lone pairs above 1, a
 * lone-lone pair comes out strongest, lone-bond next, bond-bond weakest, which is exactly
 * the hierarchy the textbooks have to state as a separate rule.
 */
function shove(bodies: RelaxBody[], a: number, b: number): number {
  return (bodies[a].weight ?? 1) * (bodies[b].weight ?? 1);
}

/**
 * The sideways shove between two neighbours of the same atom, as the exact gradient of
 * `NEIGHBOUR_PUSH / apart(...)`.
 *
 * The chain rule does the projecting for free: a unit vector can only change
 * perpendicular to itself, so d(û)/d(position) is already the projection that keeps the
 * bond length out of it. No hand-applied projection, and therefore a real potential.
 */
function push(
  force: Vec3[],
  bodies: RelaxBody[],
  wedge: { centre: number; a: number; b: number },
): void {
  const middle = bodies[wedge.centre].position;
  const spokeA = sub(bodies[wedge.a].position, middle);
  const spokeB = sub(bodies[wedge.b].position, middle);
  const reachA = length(spokeA);
  const reachB = length(spokeB);
  if (reachA < 1e-6 || reachB < 1e-6) return;

  const hatA = scale(spokeA, 1 / reachA);
  const hatB = scale(spokeB, 1 / reachB);
  const between = sub(hatA, hatB);
  const gap = length(between);
  if (gap < 1e-6) {
    // Two neighbours in exactly the same direction: shove one off the line arbitrarily
    // but deterministically, and let the next iteration take over.
    const nudge = unit(vec(hatA.y - hatA.z, hatA.z - hatA.x, hatA.x - hatA.y));
    const shock = NEIGHBOUR_PUSH * shove(bodies, wedge.a, wedge.b);
    force[wedge.a] = add(force[wedge.a], scale(nudge, shock));
    force[wedge.b] = sub(force[wedge.b], scale(nudge, shock));
    return;
  }

  // Energy NEIGHBOUR_PUSH*shove/gap, so the pull on each unit vector is this, outward.
  const slope = scale(between, (NEIGHBOUR_PUSH * shove(bodies, wedge.a, wedge.b)) / (gap * gap * gap));
  const onA = scale(across(slope, hatA), 1 / reachA);
  const onB = scale(across(scale(slope, -1), hatB), 1 / reachB);

  force[wedge.a] = add(force[wedge.a], onA);
  force[wedge.b] = add(force[wedge.b], onB);
  // Newton's third law, so the molecule cannot push itself across the screen.
  force[wedge.centre] = sub(force[wedge.centre], add(onA, onB));
}

/** The part of `force` perpendicular to `spoke`, which must already be a unit vector. */
function across(force: Vec3, spoke: Vec3): Vec3 {
  return sub(force, scale(spoke, dot(force, spoke)));
}

export function idealLength(bodies: RelaxBody[], link: RelaxLink): number {
  return (bodies[link.a].covalent + bodies[link.b].covalent) * (link.squeeze ?? 1);
}

/**
 * Slide the whole thing so the camera has something to orbit around. Measured over the
 * atoms only: lone pairs are not evenly spread, so counting them would drag the middle of
 * a molecule like water off to one side.
 */
export function centre(bodies: RelaxBody[]): void {
  const real = bodies.filter((body) => !body.ghost);
  if (real.length === 0) return;
  let sum = vec(0, 0, 0);
  for (const body of real) sum = add(sum, body.position);
  const middle = scale(sum, 1 / real.length);
  for (const body of bodies) body.position = sub(body.position, middle);
}

/** The radius of the smallest sphere at the origin holding every shell. */
export function extent(bodies: RelaxBody[], shells: number[]): number {
  let furthest = 0;
  bodies.forEach((body, index) => {
    furthest = Math.max(furthest, length(body.position) + (shells[index] ?? 0));
  });
  return furthest;
}

function apply(
  force: Vec3[],
  bodies: RelaxBody[],
  a: number,
  b: number,
  magnitude: (gap: number) => number,
): void {
  const along = sub(bodies[b].position, bodies[a].position);
  const gap = length(along);
  if (gap < 1e-6) {
    // Exactly coincident atoms have no direction to separate along, so nudge them onto
    // different axes and let the next iteration do the work.
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

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Pairs that are neither bonded nor sharing a neighbour, and so have nothing holding them
 * apart but a plain no-overlap rule. Restricted to atoms in the same connected piece, so
 * that two separate fragments are never pushed away from each other into the distance.
 */
function loosePairs(bodies: RelaxBody[], adjacency: number[][]): Array<[number, number]> {
  const count = bodies.length;
  const close = new Set<string>();
  for (let middle = 0; middle < count; middle += 1) {
    const ring = adjacency[middle];
    for (const neighbour of ring) close.add(pairKey(middle, neighbour));
    for (let i = 0; i < ring.length; i += 1) {
      for (let j = i + 1; j < ring.length; j += 1) close.add(pairKey(ring[i], ring[j]));
    }
  }

  const piece = fragments(count, adjacency);
  const pairs: Array<[number, number]> = [];
  for (let a = 0; a < count; a += 1) {
    if (bodies[a].ghost) continue;
    for (let b = a + 1; b < count; b += 1) {
      if (bodies[b].ghost) continue;
      if (piece[a] !== piece[b]) continue;
      if (close.has(pairKey(a, b))) continue;
      pairs.push([a, b]);
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
