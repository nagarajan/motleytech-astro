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
  /**
   * Whether this bond resists being twisted about. Double and aromatic bonds do — that is
   * what makes a conjugated system flat and what stops ethene folding in half — and single
   * bonds instead prefer their neighbours staggered.
   */
  stiff?: boolean;
}

const BOND_PULL = 2;
const NEIGHBOUR_PUSH = 1;
const CLASH_PUSH = 1.1;
/**
 * How hard a double or aromatic bond holds its two ends in one plane, and how hard a single bond
 * prefers the groups at its two ends staggered.
 *
 * The first is the larger, as it should be — twisting about ethene's double bond costs something
 * like 65 kcal/mol and about ethane's single bond roughly 3 — but not by anything like the real
 * factor of twenty. Both are instead set as low as will still do their job, and the planarity
 * one has an upper limit that has nothing to do with chemistry: above roughly 0.25 the landscape
 * gets stiff enough that the relaxer stops reliably finding a regular hexagon for benzene, and
 * starts settling for a planar ring with bonds alternating by a tenth of an angstrom. A term
 * strong enough to beat the search is worse than a term that is merely too gentle.
 *
 * What they buy, measured: without them ethene settles fifty degrees twisted, ethane settles
 * eclipsed, and cyclohexane's chair is half flattened. With them at these values every bond
 * length, every bond angle and the whole AXnEm table are unchanged to the last digit.
 */
const TWIST_FLAT = 0.12;
const STAGGER_PUSH = 0.008;
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

  const adjacency = adjacencyOf(count, links);
  const wedges = wedgesOf(adjacency);
  const clashes = loosePairs(bodies, adjacency);
  const flats = flatsOf(links, adjacency);
  const staggers = staggersOf(links, adjacency);

  const force: Vec3[] = bodies.map(() => vec(0, 0, 0));
  const drift: Vec3[] = bodies.map(() => vec(0, 0, 0));
  let used = 0;

  for (let iteration = 0; iteration < steps; iteration += 1) {
    used = iteration + 1;
    gather(force, bodies, links, wedges, clashes, flats, staggers);

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

interface Wedge {
  centre: number;
  a: number;
  b: number;
}

/**
 * Every force, summed into `force`, which is overwritten.
 *
 * This is the one place forces are computed, and it must be the exact negative gradient of
 * `strain`. That is not a style preference: basin hopping compares candidate shapes using
 * `strain`, so if the two disagree the relaxer walks away from arrangements its own scoring
 * calls better. It has happened, it cost a week, and there is now a test that differentiates
 * `strain` numerically and checks it against this function term by term.
 */
function gather(
  force: Vec3[],
  bodies: RelaxBody[],
  links: RelaxLink[],
  wedges: Wedge[],
  clashes: Array<[number, number]>,
  flats: Flat[],
  staggers: Stagger[],
): void {
  for (let index = 0; index < bodies.length; index += 1) force[index] = vec(0, 0, 0);

  for (const link of links) {
    const ideal = idealLength(bodies, link);
    apply(force, bodies, link.a, link.b, (gap) => BOND_PULL * (gap - ideal));
  }

  for (const wedge of wedges) push(force, bodies, wedge);

  for (const [a, b] of clashes) {
    const floor = CLASH_RATIO * (bodies[a].covalent + bodies[b].covalent);
    apply(force, bodies, a, b, (gap) => (gap < floor ? CLASH_PUSH * (gap - floor) : 0));
  }

  for (const flat of flats) flatForce(force, bodies, flat);

  for (const term of staggers) staggerForce(force, bodies, term);
}

/** Neighbours of `adjacency` sharing a middle: the pairs whose shoving creates angles. */
function wedgesOf(adjacency: number[][]): Wedge[] {
  const wedges: Wedge[] = [];
  for (let middle = 0; middle < adjacency.length; middle += 1) {
    const ring = adjacency[middle];
    for (let i = 0; i < ring.length; i += 1) {
      for (let j = i + 1; j < ring.length; j += 1) {
        wedges.push({ centre: middle, a: ring[i], b: ring[j] });
      }
    }
  }
  return wedges;
}

function adjacencyOf(count: number, links: RelaxLink[]): number[][] {
  const adjacency: number[][] = Array.from({ length: count }, () => []);
  for (const link of links) {
    adjacency[link.a].push(link.b);
    adjacency[link.b].push(link.a);
  }
  return adjacency;
}

/**
 * The forces on a given arrangement, for anything that needs them without running the
 * relaxation — which in practice means the test that checks they are the gradient of
 * `strain`.
 */
export function forcesOn(bodies: RelaxBody[], links: RelaxLink[]): Vec3[] {
  const adjacency = adjacencyOf(bodies.length, links);
  const force: Vec3[] = bodies.map(() => vec(0, 0, 0));
  gather(
    force,
    bodies,
    links,
    wedgesOf(adjacency),
    loosePairs(bodies, adjacency),
    flatsOf(links, adjacency),
    staggersOf(links, adjacency),
  );
  return force;
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
      // A pinned body is pinned between hops as well, or it is not pinned at all.
      if (body.pinned) return;
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
  const adjacency = adjacencyOf(bodies.length, links);

  let total = 0;
  for (const link of links) {
    const stretch = distance(bodies[link.a].position, bodies[link.b].position) - idealLength(bodies, link);
    total += 0.5 * BOND_PULL * stretch * stretch;
  }

  for (const wedge of wedgesOf(adjacency)) {
    total +=
      (NEIGHBOUR_PUSH * shove(bodies, wedge.a, wedge.b)) / apart(bodies, wedge.centre, wedge.a, wedge.b);
  }

  for (const [a, b] of loosePairs(bodies, adjacency)) {
    const floor = CLASH_RATIO * (bodies[a].covalent + bodies[b].covalent);
    const overlap = distance(bodies[a].position, bodies[b].position) - floor;
    if (overlap < 0) total += 0.5 * CLASH_PUSH * overlap * overlap;
  }

  for (const flat of flatsOf(links, adjacency)) {
    const found = boxiness(bodies, flat);
    if (found) total += TWIST_FLAT * found.amount * found.amount;
  }

  for (const term of staggersOf(links, adjacency)) {
    const found = staggerAt(bodies, term);
    if (found) total += found.energy;
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

export function cross(a: Vec3, b: Vec3): Vec3 {
  return vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

/** Some unit vector at right angles to `axis`. Which one is arbitrary and never matters. */
export function perpendicular(axis: Vec3): Vec3 {
  const away = Math.abs(axis.x) < 0.9 ? vec(1, 0, 0) : vec(0, 1, 0);
  return unit(cross(axis, away));
}

/**
 * Four bodies in a chain a-b-c-d whose bond to bond twist is being resisted.
 *
 * The obvious way to write this down is as a dihedral angle, and it is a trap. The derivative
 * of a dihedral carries a factor of 1/|b1 x b2|, which blows up the instant three of the four
 * bodies line up — and during a relaxation they transiently do. Benzene came apart into a
 * three-dimensional tangle because of it, and clamping the denominator only traded the
 * explosion for a discontinuity in the energy, which basin hopping then got stuck against.
 *
 * So it is written a different way instead. What the term really wants to say is "these four
 * should be coplanar", and coplanarity has a clean algebraic measure: the volume of the box
 * spanned by the three bond vectors, which is zero exactly when they lie in a plane. Dividing
 * by the three lengths makes it a pure shape, independent of how long the bonds are.
 *
 * The two turn out to be the same thing. Because (b1 x b2) x (b2 x b3) = det[b1,b2,b3] b2, the
 * normalised volume equals sin(dihedral) sin(angle at b) sin(angle at c) — a dihedral term that
 * has already been faded out near collinearity, which is precisely where a dihedral stops
 * meaning anything. No cutoff, no singularity, nothing to tune.
 */
interface Flat {
  a: number;
  b: number;
  c: number;
  d: number;
}

/**
 * The normalised box volume of the three bond vectors, and its derivative with respect to each
 * of the four positions. Zero when the four bodies are coplanar, plus or minus one when the
 * three bonds are mutually square on.
 */
function boxiness(
  bodies: RelaxBody[],
  flat: Flat,
): { amount: number; slope: [Vec3, Vec3, Vec3, Vec3] } | null {
  const first = sub(bodies[flat.b].position, bodies[flat.a].position);
  const middle = sub(bodies[flat.c].position, bodies[flat.b].position);
  const last = sub(bodies[flat.d].position, bodies[flat.c].position);

  const firstSize = dot(first, first);
  const middleSize = dot(middle, middle);
  const lastSize = dot(last, last);
  // Only ever true if two bodies are exactly on top of each other, which the springs prevent.
  if (firstSize < 1e-12 || middleSize < 1e-12 || lastSize < 1e-12) return null;

  const volume = dot(first, cross(middle, last));
  const shrink = 1 / Math.sqrt(firstSize * middleSize * lastSize);
  const amount = volume * shrink;

  // d(volume)/d(bond) is the cross product of the other two, and the normalisation contributes
  // a term along the bond itself.
  const onFirst = scale(sub(cross(middle, last), scale(first, volume / firstSize)), shrink);
  const onMiddle = scale(sub(cross(last, first), scale(middle, volume / middleSize)), shrink);
  const onLast = scale(sub(cross(first, middle), scale(last, volume / lastSize)), shrink);

  // The bonds are differences of positions, so each body picks up the bonds it takes part in.
  return {
    amount,
    slope: [
      scale(onFirst, -1),
      sub(onFirst, onMiddle),
      sub(onMiddle, onLast),
      onLast,
    ],
  };
}

function flatForce(force: Vec3[], bodies: RelaxBody[], flat: Flat): void {
  const found = boxiness(bodies, flat);
  if (!found) return;
  // E = TWIST_FLAT * amount^2, so dE/d(amount) = 2 * TWIST_FLAT * amount.
  const rate = 2 * TWIST_FLAT * found.amount;
  const indices = [flat.a, flat.b, flat.c, flat.d];
  indices.forEach((index, which) => {
    force[index] = sub(force[index], scale(found.slope[which], rate));
  });
}

/**
 * Every planarity term in the structure: one per pair of outer neighbours across each bond
 * with pi character. Lone pairs count as neighbours here as they do everywhere else.
 */
function flatsOf(links: RelaxLink[], adjacency: number[][]): Flat[] {
  const flats: Flat[] = [];
  for (const link of links) {
    if (!link.stiff) continue;
    const b = link.a;
    const c = link.b;
    for (const a of adjacency[b]) {
      if (a === c) continue;
      for (const d of adjacency[c]) {
        if (d === b || d === a) continue;
        flats.push({ a, b, c, d });
      }
    }
  }
  return flats;
}

/**
 * A single bond's preference for having the groups at its two ends staggered rather than
 * eclipsed, which is what makes ethane ethane.
 *
 * This one cannot be dodged. Ethane has nine of these across its central bond, and if you write
 * down what a onefold or twofold term contributes summed over all nine, it comes to a constant:
 * the three substituents at each end are 120 degrees apart, so everything but a threefold
 * harmonic cancels exactly. Simply having the far atoms push each other apart does work, and was
 * tried, but a repulsion between two atoms three bonds apart acts partly along the bonds and so
 * stretches them — it put a fifth of an angstrom into ethanol — which is the same mistake the
 * angle term is written on the unit sphere to avoid.
 *
 * So: a real threefold term, in a form with nothing to blow up. Writing S for the product of the
 * sines of the two bond angles, the two combinations
 *
 *     u = S sin(dihedral)      the normalised box volume used above
 *     w = S cos(dihedral)      cos(angle at b) cos(angle at c) - cos(angle from b1 to b3)
 *
 * are both free of small denominators, and
 *
 *     S^3 (1 + cos 3*dihedral) = S^3 + 4w^3 - 3w S^2
 *
 * which is the whole term. S^2 is a plain rational function; S^3 is its three-halves power,
 * whose derivative carries a factor of S and therefore vanishes quietly at collinearity instead
 * of exploding there. Zero when staggered, and flat as well as zero, so it perturbs nothing it
 * was not asked to.
 */
interface Stagger {
  a: number;
  b: number;
  c: number;
  d: number;
}

/**
 * The energy of one staggering term and its derivative with respect to each position.
 *
 * Everything is routed through six scalars — the three dot products between the bond vectors and
 * their three squared lengths — because then the derivative is six scalar partials and a little
 * bookkeeping, rather than a page of vector calculus with a mistake hidden in it.
 */
function staggerAt(
  bodies: RelaxBody[],
  term: Stagger,
): { energy: number; slope: [Vec3, Vec3, Vec3, Vec3] } | null {
  const first = sub(bodies[term.b].position, bodies[term.a].position);
  const middle = sub(bodies[term.c].position, bodies[term.b].position);
  const last = sub(bodies[term.d].position, bodies[term.c].position);

  const lengthFirst = dot(first, first);
  const lengthMiddle = dot(middle, middle);
  const lengthLast = dot(last, last);
  if (lengthFirst < 1e-12 || lengthMiddle < 1e-12 || lengthLast < 1e-12) return null;

  const nearDot = dot(first, middle);
  const farDot = dot(middle, last);
  const acrossDot = dot(first, last);

  // The two squared sines, and their product.
  const sineNear = 1 - (nearDot * nearDot) / (lengthFirst * lengthMiddle);
  const sineFar = 1 - (farDot * farDot) / (lengthMiddle * lengthLast);
  const square = sineNear * sineFar;
  if (square <= 0) return { energy: 0, slope: [vec(0, 0, 0), vec(0, 0, 0), vec(0, 0, 0), vec(0, 0, 0)] };

  const reach = Math.sqrt(lengthFirst * lengthLast);
  const lean = ((nearDot * farDot) / lengthMiddle - acrossDot) / reach;

  const energy =
    STAGGER_PUSH * (Math.pow(square, 1.5) + 4 * lean * lean * lean - 3 * lean * square);

  const bySquare = STAGGER_PUSH * (1.5 * Math.sqrt(square) - 3 * lean);
  const byLean = STAGGER_PUSH * (12 * lean * lean - 3 * square);

  // How the two shape numbers depend on each of the six scalars.
  const squareByNear = sineFar * ((-2 * nearDot) / (lengthFirst * lengthMiddle));
  const squareByFar = sineNear * ((-2 * farDot) / (lengthMiddle * lengthLast));
  const squareByLengthFirst = (sineFar * (nearDot * nearDot)) / (lengthFirst * lengthFirst * lengthMiddle);
  const squareByLengthMiddle =
    (sineFar * (nearDot * nearDot)) / (lengthFirst * lengthMiddle * lengthMiddle) +
    (sineNear * (farDot * farDot)) / (lengthMiddle * lengthMiddle * lengthLast);
  const squareByLengthLast = (sineNear * (farDot * farDot)) / (lengthMiddle * lengthLast * lengthLast);

  const leanByNear = farDot / (lengthMiddle * reach);
  const leanByFar = nearDot / (lengthMiddle * reach);
  const leanByAcross = -1 / reach;
  const leanByLengthMiddle = -(nearDot * farDot) / (lengthMiddle * lengthMiddle * reach);
  const leanByLengthFirst = -lean / (2 * lengthFirst);
  const leanByLengthLast = -lean / (2 * lengthLast);

  const byNear = bySquare * squareByNear + byLean * leanByNear;
  const byFar = bySquare * squareByFar + byLean * leanByFar;
  const byAcross = byLean * leanByAcross;
  const byLengthFirst = bySquare * squareByLengthFirst + byLean * leanByLengthFirst;
  const byLengthMiddle = bySquare * squareByLengthMiddle + byLean * leanByLengthMiddle;
  const byLengthLast = bySquare * squareByLengthLast + byLean * leanByLengthLast;

  // And how each scalar depends on the three bond vectors.
  const onFirst = add(
    add(scale(middle, byNear), scale(last, byAcross)),
    scale(first, 2 * byLengthFirst),
  );
  const onMiddle = add(
    add(scale(first, byNear), scale(last, byFar)),
    scale(middle, 2 * byLengthMiddle),
  );
  const onLast = add(
    add(scale(middle, byFar), scale(first, byAcross)),
    scale(last, 2 * byLengthLast),
  );

  return {
    energy,
    slope: [scale(onFirst, -1), sub(onFirst, onMiddle), sub(onMiddle, onLast), onLast],
  };
}

function staggerForce(force: Vec3[], bodies: RelaxBody[], term: Stagger): void {
  const found = staggerAt(bodies, term);
  if (!found) return;
  const indices = [term.a, term.b, term.c, term.d];
  indices.forEach((index, which) => {
    force[index] = sub(force[index], found.slope[which]);
  });
}

/** Every staggering term: one per pair of outer neighbours across each single bond. */
function staggersOf(links: RelaxLink[], adjacency: number[][]): Stagger[] {
  const terms: Stagger[] = [];
  for (const link of links) {
    if (link.stiff) continue;
    const b = link.a;
    const c = link.b;
    for (const a of adjacency[b]) {
      if (a === c) continue;
      for (const d of adjacency[c]) {
        if (d === b || d === a) continue;
        terms.push({ a, b, c, d });
      }
    }
  }
  return terms;
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
