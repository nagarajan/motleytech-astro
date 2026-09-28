/** Scratch: re-check every number quoted in the article. Run with ./run.sh claims.ts */
import { energy, smallestEigen, type Rules } from './geometry';
import {
  DEFAULT_RULES,
  EMPTY,
  addEdge,
  addVertex,
  chargeOf,
  edgeLength,
  neighbours,
  report,
  setKind,
  setPinned,
  settle,
  tidy,
  upsertKind,
  type Shape,
} from './model';
import { PRESETS, toShape } from './presets';

const FLAT: Rules = { flatten: false };

/** The energy of a whole shape, which is what basin hopping compares candidates by. */
function energyOf(shape: Shape): number {
  const slot = new Map(shape.vertices.map((v, i) => [v.id, i]));
  const bodies = shape.vertices.map((v) => ({ position: v.position, charge: chargeOf(shape, v) }));
  const links = shape.edges.map((e) => ({ a: slot.get(e.a)!, b: slot.get(e.b)! }));
  const faces = shape.faces.map((f) => f.vertices.map((id) => slot.get(id)!));
  return energy(bodies, links, faces, DEFAULT_RULES);
}

/** A small deterministic generator, so the random starts below are reproducible. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function load(name: string, hops = 16, rules: Rules = DEFAULT_RULES): Shape {
  const preset = PRESETS.find((entry) => entry.name === name)!;
  return tidy(toShape(preset.build()), rules, hops);
}

function lengths(shape: Shape): Map<string, number> {
  const buckets = new Map<string, number>();
  for (const edge of shape.edges) {
    const key = edgeLength(shape, edge).toFixed(3);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return buckets;
}

/** The fraction of a point set's spread that points out of its best-fit plane. 0 = flat. */
function outOfPlane(points: Array<{ x: number; y: number; z: number }>): number {
  const n = points.length;
  const mid = points.reduce(
    (s, p) => ({ x: s.x + p.x / n, y: s.y + p.y / n, z: s.z + p.z / n }),
    { x: 0, y: 0, z: 0 },
  );
  const m = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of points) {
    const d = [p.x - mid.x, p.y - mid.y, p.z - mid.z];
    for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) m[i][j] += d[i] * d[j];
  }
  const trace = m[0][0] + m[1][1] + m[2][2];
  return trace < 1e-18 ? 0 : smallestEigen(m).value / trace;
}

function show(label: string, shape: Shape): void {
  const listed = [...lengths(shape).entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([len, count]) => `${count}\u00d7${len}`)
    .join('  ');
  console.log(`${label.padEnd(34)} spread ${(report(shape).spread * 100).toFixed(3)}%  ${listed}`);
}

console.log('\n== edge lengths quoted in the article ==');
show('Icosahedron (says 30\u00d71.313)', load('Icosahedron'));
show('Cube (says 1.378)', load('Cube'));
show('Truncated tetrahedron (1.268/2.062)', load('Truncated tetrahedron'));
show('Truncated icosahedron (2.360/3.181)', load('Truncated icosahedron'));
show('Square pyramid (apex 1.342)', load('Square pyramid'));
show('Cuboctahedron', load('Cuboctahedron'));

console.log('\n== square pyramid: Heavy from 1.8 to 4 ==');
{
  const base = load('Square pyramid');
  const retuned = tidy(
    upsertKind(base, { ...base.kinds.find((k) => k.id === 'heavy')!, charge: 4 }, DEFAULT_RULES),
    DEFAULT_RULES,
    16,
  );
  show('  apex edges should hit 2.000', retuned);
}

console.log('\n== hexagonal pyramid: Huge apex dropped to Heavy ==');
{
  const tall = load('Hexagonal pyramid');
  show('  with Huge apex', tall);
  const apex = tall.vertices.find((v) => neighbours(tall, v.id).length === 6)!;
  const dropped = tidy(setKind(tall, apex.id, 'heavy', DEFAULT_RULES), DEFAULT_RULES, 16);
  show('  with Heavy apex (says all 1.347)', dropped);
  console.log(`  whole shape out of plane   ${outOfPlane(dropped.vertices.map((v) => v.position)).toExponential(2)}`);
  console.log(`  same, with Huge apex       ${outOfPlane(tall.vertices.map((v) => v.position)).toExponential(2)}`);
}

console.log('\n== torus extremes ==');
{
  const torus = load('Torus', 16);
  const all = torus.edges.map((edge) => edgeLength(torus, edge));
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  console.log(`  shortest ${lo.toFixed(3)}  longest ${hi.toFixed(3)}  ratio ${(hi / lo).toFixed(2)} (says 2.9)`);
  console.log(`  distinct lengths ${lengths(torus).size} (says 7)`);
}

console.log('\n== triangle patch: rim against interior ==');
{
  const patch = load('Triangle patch');
  // An edge is on the rim if it borders only one face; interior edges border two.
  const uses = new Map<string, number>();
  const key = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;
  for (const face of patch.faces) {
    for (let i = 0; i < face.vertices.length; i += 1) {
      const a = face.vertices[i];
      for (let j = i + 1; j < face.vertices.length; j += 1) {
        const k = key(a, face.vertices[j]);
        uses.set(k, (uses.get(k) ?? 0) + 1);
      }
    }
  }
  const rim: number[] = [];
  const inner: number[] = [];
  for (const edge of patch.edges) {
    ((uses.get(key(edge.a, edge.b)) ?? 0) < 2 ? rim : inner).push(edgeLength(patch, edge));
  }
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  console.log(
    `  rim n=${rim.length} mean ${mean(rim).toFixed(3)}   interior n=${inner.length} mean ${mean(inner).toFixed(3)}` +
      `   rim is ${((mean(rim) / mean(inner) - 1) * 100).toFixed(1)}% longer`,
  );
  const all = patch.edges.map((e) => edgeLength(patch, e));
  console.log(`  shortest ${Math.min(...all).toFixed(3)}  longest ${Math.max(...all).toFixed(3)}  longest is ${((Math.max(...all) / Math.min(...all) - 1) * 100).toFixed(1)}% longer`);
  console.log(`  out of plane ${outOfPlane(patch.vertices.map((v) => v.position)).toExponential(2)}`);

  // Where do the long edges actually sit? Bin by each edge's distance from the centre.
  const mid = patch.vertices.reduce(
    (s, v) => ({ x: s.x + v.position.x / patch.vertices.length, y: s.y + v.position.y / patch.vertices.length, z: s.z + v.position.z / patch.vertices.length }),
    { x: 0, y: 0, z: 0 },
  );
  const at = (id: number) => patch.vertices.find((v) => v.id === id)!.position;
  const rows = patch.edges
    .map((e) => {
      const a = at(e.a);
      const b = at(e.b);
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
      return { r: Math.hypot(c.x - mid.x, c.y - mid.y, c.z - mid.z), len: edgeLength(patch, e), rim: (uses.get(key(e.a, e.b)) ?? 0) < 2 };
    })
    .sort((p, q) => p.r - q.r);
  console.log('  edge length against distance from centre (one line per distinct ring):');
  let seen = '';
  for (const row of rows) {
    const stamp = `${row.r.toFixed(2)}/${row.len.toFixed(3)}`;
    if (stamp === seen) continue;
    seen = stamp;
    console.log(`    r=${row.r.toFixed(2)}  len=${row.len.toFixed(3)}  ${row.rim ? 'on the rim' : ''}`);
  }

  // And the vertex spacing: how far apart are neighbours near the centre vs near the rim?
  const rimV = patch.vertices.filter((v) => neighbours(patch, v.id).length < 6);
  console.log(`  ${rimV.length} of ${patch.vertices.length} vertices are on the boundary`);
}

console.log('\n== does the flattening term do anything? ==');
{
  const flatness = (shape: Shape): number => {
    let worst = 0;
    for (const face of shape.faces) {
      if (face.vertices.length < 4) continue;
      const points = face.vertices.map((id) => shape.vertices.find((v) => v.id === id)!.position);
      worst = Math.max(worst, outOfPlane(points));
    }
    return worst;
  };
  for (const preset of PRESETS) {
    const on = load(preset.name, 12, DEFAULT_RULES);
    const off = load(preset.name, 12, FLAT);
    if (on.faces.every((f) => f.vertices.length < 4)) continue;
    // Biggest disagreement between the two runs, edge by edge.
    let worst = 0;
    for (let i = 0; i < on.edges.length; i += 1) {
      worst = Math.max(worst, Math.abs(edgeLength(on, on.edges[i]) - edgeLength(off, off.edges[i])));
    }
    console.log(
      `  ${preset.name.padEnd(22)} flatness on ${flatness(on).toExponential(2)}  off ${flatness(off).toExponential(2)}` +
        `   worst edge difference ${worst.toExponential(2)}`,
    );
  }

  // Two opposite corners of a cube made Huge: the one place the term can matter.
  const skew = (rules: Rules): number => {
    let shape = load('Cube', 12, rules);
    const first = shape.vertices[0];
    const far = shape.vertices
      .filter((v) => !neighbours(shape, first.id).includes(v.id) && v.id !== first.id)
      .map((v) => ({ v, d: Math.hypot(v.position.x - first.position.x, v.position.y - first.position.y, v.position.z - first.position.z) }))
      .sort((a, b) => b.d - a.d)[0].v;
    shape = setKind(shape, first.id, 'huge', rules);
    shape = setKind(shape, far.id, 'huge', rules);
    shape = tidy(shape, rules, 16);
    return flatness(shape);
  };
  console.log(`  cube with two Huge corners: on ${skew(DEFAULT_RULES).toFixed(4)}  off ${skew(FLAT).toFixed(4)} (says 0.0033 / 0.0050)`);
}

console.log('\n== pinned octahedron at charge 2 ==');
{
  const base = load('Octahedron');
  console.log(`  free, charge 1                    spread ${(report(base).spread * 100).toFixed(1)}%`);
  const free = tidy(upsertKind(base, { ...base.kinds.find((k) => k.id === 'plain')!, charge: 2 }, DEFAULT_RULES), DEFAULT_RULES, 16);
  console.log(`  free, charge 2                    spread ${(report(free).spread * 100).toFixed(1)}%`);

  for (const [label, pick] of [
    ['adjacent pair', (s: Shape) => [s.vertices[0].id, neighbours(s, s.vertices[0].id)[0]]],
    ['opposite pair', (s: Shape) => [s.vertices[0].id, s.vertices.find((v) => v.id !== s.vertices[0].id && !neighbours(s, s.vertices[0].id).includes(v.id))!.id]],
    ['first three', (s: Shape) => [s.vertices[0].id, s.vertices[1].id, s.vertices[2].id]],
    ['three in a face', (s: Shape) => [s.vertices[0].id, ...neighbours(s, s.vertices[0].id).slice(0, 2)]],
    ['a different three', (s: Shape) => [s.vertices[0].id, ...neighbours(s, s.vertices[0].id).slice(2, 4)]],
    ['four', (s: Shape) => [s.vertices[0].id, ...neighbours(s, s.vertices[0].id).slice(0, 3)]],
  ] as const) {
    for (const charge of [2, 4]) {
      let shape = base;
      for (const id of pick(shape)) shape = setPinned(shape, id, true, DEFAULT_RULES);
      shape = upsertKind(shape, { ...shape.kinds.find((k) => k.id === 'plain')!, charge }, DEFAULT_RULES);
      shape = tidy(shape, DEFAULT_RULES, 16);
      const mean = shape.edges.reduce((s, e) => s + edgeLength(shape, e), 0) / shape.edges.length;
      console.log(`  pinned ${label.padEnd(18)} charge ${charge}  spread ${(report(shape).spread * 100).toFixed(1).padStart(6)}%  mean edge ${mean.toFixed(3)}`);
    }
  }
}

console.log('\n== closing a ring by hand ==');
for (const size of [3, 4, 5, 6, 8]) {
  // Grow a chain one vertex at a time, each attached to the last, then join the ends.
  let shape: Shape = EMPTY;
  const ids: number[] = [];
  for (let i = 0; i < size; i += 1) {
    const grown = addVertex(shape, 'plain', i === 0 ? [] : [ids[i - 1]], DEFAULT_RULES);
    shape = grown.shape;
    ids.push(grown.id);
  }
  const plain = settle(shape, DEFAULT_RULES);
  const straight = addEdgeRaw(plain, ids[size - 1], ids[0]);
  console.log(
    `  ${size}-ring: downhill only ${(report(settle(straight, DEFAULT_RULES, 20000)).spread * 100).toFixed(1)}%` +
      `   with hopping ${(report(addEdge(shape, ids[size - 1], ids[0], DEFAULT_RULES)).spread * 100).toFixed(3)}%`,
  );
}

/** Join two vertices without letting the model relax, so the plain roll can be timed alone. */
function addEdgeRaw(shape: Shape, a: number, b: number): Shape {
  return { ...shape, edges: [...shape.edges, { id: shape.next, a, b }], next: shape.next + 1 };
}

console.log('\n== random starts: how often does hopping rescue a solid? ==');
{
  const TRIES = 40;
  for (const name of ['Cube', 'Octahedron', 'Icosahedron', 'Dodecahedron']) {
    const preset = PRESETS.find((entry) => entry.name === name)!;
    const truth = tidy(toShape(preset.build()), DEFAULT_RULES, 16);
    const target = energyOf(truth);

    const results: Record<number, { stuck: number; worst: number }> = {};
    for (const hops of [1, 16, 40]) {
      let stuck = 0;
      let worst = 0;
      for (let seed = 0; seed < TRIES; seed += 1) {
        const random = seeded(0x1234 + seed * 7919);
        const start = toShape(preset.build());
        const scrambled: Shape = {
          ...start,
          vertices: start.vertices.map((v) => ({
            ...v,
            position: { x: (random() - 0.5) * 4, y: (random() - 0.5) * 4, z: (random() - 0.5) * 4 },
          })),
        };
        const got = tidy(scrambled, DEFAULT_RULES, hops);
        if (report(got).spread > 1e-3) {
          stuck += 1;
          worst = Math.max(worst, energyOf(got));
        }
        if (energyOf(got) < target - 1e-6) console.log(`    !! beat the symmetric shape: ${energyOf(got).toFixed(2)} < ${target.toFixed(2)}`);
      }
      results[hops] = { stuck, worst };
    }
    console.log(
      `  ${name.padEnd(14)} true energy ${target.toFixed(2)}   stuck: ${results[1].stuck}/${TRIES} at 1 hop, ` +
        `${results[16].stuck}/${TRIES} at 16, ${results[40].stuck}/${TRIES} at 40` +
        (results[1].worst ? `   worst wrong energy ${results[1].worst.toFixed(2)}` : ''),
    );
  }
}
