/**
 * Scratch harness. Not part of the site build; run it with ./run.sh.
 *
 * Three things worth checking by machine rather than by eye: that the forces really are
 * the gradient of the energy, that an edge between two charges lands on the geometric
 * mean, and that every preset settles into the shape it is named after.
 */
import { detectFaces } from './faces';
import {
  add,
  angleAt,
  distance,
  energy,
  radius,
  scale,
  settle,
  vec,
  type Body,
  type Link,
  type Rules,
} from './geometry';
import { DEFAULT_RULES, edgeLength, naturalLength, report, tidy, type Shape } from './model';
import { PRESETS, toShape } from './presets';

const RULES: Rules = { flatten: true };

function line(label: string, value: string): void {
  console.log(`${label.padEnd(30)} ${value}`);
}

// ---------------------------------------------------------------- gradient check

/**
 * The forces must be exactly −∇U, or basin hopping is comparing shapes by a number the
 * relaxer is not actually minimising.
 */
function gradientCheck(): void {
  console.log('\n== forces against finite differences ==');
  const bodies: Body[] = [
    { position: vec(0.9, 0.2, -0.3), charge: 1 },
    { position: vec(-0.7, 0.8, 0.4), charge: 1.8 },
    { position: vec(0.1, -1.1, 0.6), charge: 0.55 },
    { position: vec(-0.4, -0.2, -1.2), charge: 1 },
    { position: vec(1.3, -0.6, 0.9), charge: 2.4 },
  ];
  const links: Link[] = [
    { a: 0, b: 1 },
    { a: 1, b: 2 },
    { a: 2, b: 3 },
    { a: 3, b: 0 },
    { a: 0, b: 4 },
    { a: 1, b: 4 },
  ];
  const faces = [[0, 1, 2, 3]];

  const step = 1e-6;
  let worst = 0;

  for (let index = 0; index < bodies.length; index += 1) {
    for (const axis of ['x', 'y', 'z'] as const) {
      const original = bodies[index].position;

      const shifted = { ...original, [axis]: original[axis] + step };
      bodies[index].position = shifted;
      const up = energy(bodies, links, faces, RULES);

      bodies[index].position = { ...original, [axis]: original[axis] - step };
      const down = energy(bodies, links, faces, RULES);
      bodies[index].position = original;

      const numeric = (up - down) / (2 * step);

      // One relaxation step of size h moves along the force, so recover the force by
      // taking a single step from rest with no momentum.
      const probe = bodies.map((body) => ({ ...body, position: body.position }));
      const analytic = -forceOn(probe, links, faces, index)[axis];

      worst = Math.max(worst, Math.abs(numeric - analytic) / Math.max(1, Math.abs(numeric)));
    }
  }
  line('worst relative error', worst.toExponential(2));
  line('verdict', worst < 1e-5 ? 'forces are the gradient' : 'MISMATCH');
}

/** The force on one body, read back by taking a single tiny relaxation step. */
function forceOn(bodies: Body[], links: Link[], faces: number[][], index: number): { x: number; y: number; z: number } {
  const before = bodies[index].position;
  const probe = bodies.map((body) => ({ ...body, position: { ...body.position } }));
  // A single step with everything else pinned isolates this body's own force, and the
  // relaxer's first step is exactly STEP × force with no momentum yet.
  probe.forEach((body, other) => {
    if (other !== index) body.pinned = true;
  });
  settle(probe, links, faces, RULES, 1);
  const moved = probe[index].position;
  const STEP = 0.02;
  return {
    x: (moved.x - before.x) / STEP,
    y: (moved.y - before.y) / STEP,
    z: (moved.z - before.z) / STEP,
  };
}

// ---------------------------------------------------------------- the size law

function sizeLaw(): void {
  console.log('\n== an edge is the geometric mean of its two charges ==');
  for (const [qa, qb] of [
    [1, 1],
    [1, 4],
    [0.55, 1.8],
    [2.5, 2.5],
    [0.25, 9],
  ]) {
    const bodies: Body[] = [
      { position: vec(-0.5, 0, 0), charge: qa },
      { position: vec(0.5, 0, 0), charge: qb },
    ];
    settle(bodies, [{ a: 0, b: 1 }], [], RULES, 40000);
    const got = distance(bodies[0].position, bodies[1].position);
    const want = Math.sqrt(qa * qb);
    line(`q=${qa} and q=${qb}`, `${got.toFixed(5)} against \u221a(qq) = ${want.toFixed(5)}`);
  }
}

// ---------------------------------------------------------------- the presets

interface Expectation {
  vertices: number;
  edges: number;
  faces: number;
  /** Distinct edge lengths expected. The Platonic solids have one. */
  uniform?: boolean;
  euler?: number;
}

const EXPECTED: Record<string, Expectation> = {
  Tetrahedron: { vertices: 4, edges: 6, faces: 4, uniform: true },
  Cube: { vertices: 8, edges: 12, faces: 6, uniform: true },
  Octahedron: { vertices: 6, edges: 12, faces: 8, uniform: true },
  Dodecahedron: { vertices: 20, edges: 30, faces: 12, uniform: true },
  Icosahedron: { vertices: 12, edges: 30, faces: 20, uniform: true },
  'Truncated tetrahedron': { vertices: 12, edges: 18, faces: 8 },
  Cuboctahedron: { vertices: 12, edges: 24, faces: 14, uniform: true },
  Icosidodecahedron: { vertices: 30, edges: 60, faces: 32, uniform: true },
  'Truncated icosahedron': { vertices: 60, edges: 90, faces: 32 },
  'Geodesic sphere': { vertices: 42, edges: 120, faces: 80 },
  Torus: { vertices: 48, edges: 96, faces: 48, euler: 0 },
};

function presets(): void {
  console.log('\n== presets ==');
  console.log(
    ['shape'.padEnd(24), 'V'.padStart(3), 'E'.padStart(4), 'F'.padStart(3), 'V-E+F'.padStart(6), 'edge spread'.padStart(12), 'kinds'.padStart(5), 'note'].join(
      ' ',
    ),
  );

  for (const preset of PRESETS) {
    const started = Date.now();
    const shape = tidy(toShape(preset.build()), DEFAULT_RULES, 16);
    const stats = report(shape);
    const want = EXPECTED[preset.name];

    const notes: string[] = [];
    if (want) {
      if (stats.vertices !== want.vertices || stats.edges !== want.edges || stats.faces !== want.faces) {
        notes.push(`WRONG COUNTS, wanted ${want.vertices}/${want.edges}/${want.faces}`);
      }
      if (want.uniform && stats.spread > 1e-3) notes.push(`NOT UNIFORM (${(stats.spread * 100).toFixed(2)}%)`);
      if (want.euler !== undefined && stats.euler !== want.euler) notes.push(`euler ${stats.euler} wanted ${want.euler}`);
    }
    notes.push(`${Date.now() - started}ms`);

    // How many edge lengths actually occur, which should be the number of orbits the
    // graph's symmetry group has on its edges.
    const distinct = new Set(shape.edges.map((edge) => edgeLength(shape, edge).toFixed(3))).size;

    console.log(
      [
        preset.name.padEnd(24),
        String(stats.vertices).padStart(3),
        String(stats.edges).padStart(4),
        String(stats.faces).padStart(3),
        String(stats.euler ?? '-').padStart(6),
        `${(stats.spread * 100).toFixed(3)}%`.padStart(12),
        String(distinct).padStart(5),
        notes.join(' '),
      ].join(' '),
    );
  }
}

/** The tetrahedral angle, and the rest, without anybody having been told them. */
function angles(): void {
  console.log('\n== angles nobody supplied ==');
  const checks: Array<[string, (shape: Shape) => number, number]> = [
    [
      'Tetrahedron, at a vertex',
      (shape) => angleAt(shape.vertices[1].position, shape.vertices[0].position, shape.vertices[2].position),
      60,
    ],
    [
      'Cube, at a vertex',
      (shape) => {
        const first = shape.vertices[0];
        const near = shape.edges
          .filter((edge) => edge.a === first.id || edge.b === first.id)
          .map((edge) => shape.vertices.find((vertex) => vertex.id === (edge.a === first.id ? edge.b : edge.a))!);
        return angleAt(near[0].position, first.position, near[1].position);
      },
      90,
    ],
  ];

  for (const [label, measure, want] of checks) {
    const preset = PRESETS.find((entry) => entry.name.startsWith(label.split(',')[0]))!;
    const shape = tidy(toShape(preset.build()), DEFAULT_RULES, 16);
    line(label, `${measure(shape).toFixed(3)}\u00b0 against ${want}\u00b0`);
  }
}

/**
 * How edge length grows with vertex count. Repulsion scales with N² while the edge count
 * only scales with N, so a big solid has to swell; the question is how fast.
 */
function scaling(): void {
  console.log('\n== edge length against vertex count, on the degree-3 solids ==');
  const measured: Array<[number, number]> = [];
  for (const name of ['Tetrahedron', 'Cube', 'Dodecahedron', 'Truncated icosahedron']) {
    const preset = PRESETS.find((entry) => entry.name === name)!;
    const shape = tidy(toShape(preset.build()), DEFAULT_RULES, 12);
    const mean = shape.edges.reduce((sum, edge) => sum + edgeLength(shape, edge), 0) / shape.edges.length;
    measured.push([shape.vertices.length, mean]);
    line(name, `N=${String(shape.vertices.length).padStart(3)}  mean edge=${mean.toFixed(3)}`);
  }
  for (let i = 1; i < measured.length; i += 1) {
    const [n0, e0] = measured[i - 1];
    const [n1, e1] = measured[i];
    line(`  slope ${n0}\u2192${n1}`, (Math.log(e1 / e0) / Math.log(n1 / n0)).toFixed(3));
  }

  console.log('\n== the same, on the all-triangle solids ==');
  const triangular: Array<[number, number]> = [];
  for (const name of ['Tetrahedron', 'Octahedron', 'Icosahedron', 'Geodesic sphere']) {
    const preset = PRESETS.find((entry) => entry.name === name)!;
    const shape = tidy(toShape(preset.build()), DEFAULT_RULES, 10);
    const mean = shape.edges.reduce((sum, edge) => sum + edgeLength(shape, edge), 0) / shape.edges.length;
    triangular.push([shape.vertices.length, mean]);
    line(name, `N=${String(shape.vertices.length).padStart(3)}  mean edge=${mean.toFixed(3)}  spread=${(report(shape).spread * 100).toFixed(2)}%`);
  }
  for (let i = 1; i < triangular.length; i += 1) {
    const [n0, e0] = triangular[i - 1];
    const [n1, e1] = triangular[i];
    line(`  slope ${n0}\u2192${n1}`, (Math.log(e1 / e0) / Math.log(n1 / n0)).toFixed(3));
  }
}

/** Does the detector find the faces of a solid given only its vertices and edges? */
function detection(): void {
  console.log('\n== face detection from edges alone ==');
  for (const name of ['Tetrahedron', 'Cube', 'Octahedron', 'Dodecahedron', 'Icosahedron', 'Truncated icosahedron', 'Cuboctahedron', 'Torus', 'Triangle patch']) {
    const preset = PRESETS.find((entry) => entry.name === name)!;
    const blueprint = preset.build();
    const shape = tidy(toShape(blueprint), DEFAULT_RULES, 12);
    const positions = shape.vertices.map((vertex) => vertex.position);
    const slot = new Map(shape.vertices.map((vertex, index) => [vertex.id, index]));
    const edges = shape.edges.map((edge) => [slot.get(edge.a)!, slot.get(edge.b)!] as [number, number]);
    const found = detectFaces(positions, edges);
    const sizes = new Map<number, number>();
    for (const face of found) sizes.set(face.length, (sizes.get(face.length) ?? 0) + 1);
    const shape_of = [...sizes.entries()].sort((a, b) => a[0] - b[0]).map(([n, count]) => `${count}\u00d7${n}-gon`).join(', ');
    line(name, `${found.length} faces (blueprint has ${blueprint.faces.length}) \u2014 ${shape_of}`);
  }
}

gradientCheck();
sizeLaw();
detection();
presets();
angles();
scaling();
