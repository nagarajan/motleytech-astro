/**
 * Every part of the movement, drawn from its own numbers.
 *
 * There is no model file behind any of this. A wheel is its tooth count and its pitch
 * radius, and the profile is generated from them, so a 64-tooth centre wheel and a
 * 15-tooth escape wheel are the same function called twice. That is not showing off: the
 * tooth counts are the thing the whole movement is built out of, and a drawing that was
 * traced rather than generated could quietly disagree with the simulation about how many
 * teeth there are.
 *
 * Shapes are laid out in XY and extruded along Z, so a part's plan view is its shape and
 * its thickness is the extrusion.
 */
import * as THREE from 'three';

import { FORK, PALLET_STONES, PALLET_TO_ESCAPE, STONE, type Spot } from './layout';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- tooth profiles

/**
 * A tooth, as a list of [height above the pitch circle in modules, half-width as a
 * fraction of the angular pitch] running from the root to the tip.
 *
 * Measuring the height in *modules* rather than as a fraction of the wheel is the whole
 * reason this works for every wheel in the watch. A tooth's size is set by the pitch —
 * the distance from one tooth to the next — and not by how big the wheel is, so a
 * 64-tooth centre wheel and a 7-leaf pinion get teeth of very nearly the same size even
 * though one wheel is twelve times the other. Scale the profile by the radius instead and
 * the big wheels come out looking like circular saws, which is a mistake I made and could
 * see from across the room.
 *
 * The shape itself is ogival: wide at the root, narrowing through the pitch circle,
 * rounded off at the tip, with gaps wider than the teeth. That is not decoration either. A
 * pinion with seven leaves has very little room between them, so the wheel tooth has to be
 * slender enough to get in and back out again.
 */
const WHEEL_TOOTH: Array<[number, number]> = [
  [-1.15, 0.3],
  [-0.6, 0.268],
  [0.0, 0.222],
  [0.55, 0.184],
  [0.95, 0.136],
  [1.16, 0.076],
  [1.25, 0.0],
];

/**
 * A pinion leaf. Fat, because there are only seven or eight of them and each one carries
 * the whole train's torque, and deeply rounded, because the leaf is the driven half of the
 * pair and the contact rolls across its face.
 */
const PINION_LEAF: Array<[number, number]> = [
  [-1.5, 0.33],
  [-0.8, 0.315],
  [0.0, 0.275],
  [0.62, 0.215],
  [1.02, 0.13],
  [1.2, 0.0],
];

/** Mirror a half-profile into the closed outline of one tooth, in polar coordinates. */
function toothPoints(
  profile: Array<[number, number]>,
  pitchRadius: number,
  module: number,
  pitch: number,
  centre: number,
): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  const at = (height: number, halfWidth: number): THREE.Vector2 => {
    const angle = centre + halfWidth * pitch;
    const radius = pitchRadius + height * module;
    return new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius);
  };
  for (let i = 0; i < profile.length; i += 1) points.push(at(profile[i][0], -profile[i][1]));
  for (let i = profile.length - 2; i >= 0; i -= 1) points.push(at(profile[i][0], profile[i][1]));
  return points;
}

/** An arc of points, used for the root circle between teeth and for hubs. */
function arc(radius: number, from: number, to: number, steps: number): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = from + ((to - from) * i) / steps;
    points.push(new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius));
  }
  return points;
}

export interface WheelSpec {
  teeth: number;
  /** Pitch radius: half the module times the tooth count, and half the meshing distance. */
  radius: number;
  thickness: number;
  /** How many crossings — the openings between the arms. Zero for a solid wheel. */
  crossings?: number;
  /** Radius of the solid middle, as a fraction of the root radius. */
  hub?: number;
  /** The hole up the middle, for the arbor. */
  bore?: number;
  pinion?: boolean;
}

/**
 * A toothed wheel with its crossings cut out.
 *
 * The crossings are not there to look like a watch. A wheel's job in a train is to carry
 * torque, and the metal between the hub and the rim does none of that once it is more than
 * a few tenths of a millimetre wide — but it does carry inertia, and inertia in the train
 * is energy the balance never sees. So it is cut away, and what is left is the three or
 * four arms that are actually in tension.
 */
export function wheelGeometry(spec: WheelSpec): THREE.ExtrudeGeometry {
  const profile = spec.pinion ? PINION_LEAF : WHEEL_TOOTH;
  const pitch = TAU / spec.teeth;
  const module = (2 * spec.radius) / spec.teeth;
  const rootRadius = spec.radius + profile[0][0] * module;

  const outline: THREE.Vector2[] = [];
  for (let tooth = 0; tooth < spec.teeth; tooth += 1) {
    const centre = tooth * pitch;
    outline.push(...toothPoints(profile, spec.radius, module, pitch, centre));
    // The root circle carries on round to the next tooth.
    outline.push(...arc(rootRadius, centre + profile[0][1] * pitch, centre + pitch - profile[0][1] * pitch, 3));
  }

  const shape = new THREE.Shape(outline);

  const bore = spec.bore ?? 0;
  const hub = (spec.hub ?? 0.42) * rootRadius;
  const crossings = spec.crossings ?? 0;

  if (crossings > 0 && hub > bore) {
    // A watch wheel's rim is a couple of modules of metal behind the teeth and no more,
    // so it is measured in modules too rather than as a share of the radius.
    const rim = Math.max(hub + 0.2, rootRadius - 2.2 * module);
    // The arms have to be wide enough near the hub to be believable and the openings are
    // what is left over, so both are set as a share of the pitch rather than a fixed angle.
    const armHalf = 0.13;
    for (let i = 0; i < crossings; i += 1) {
      const from = (i * TAU) / crossings + armHalf;
      const to = ((i + 1) * TAU) / crossings - armHalf;
      // Pull the opening in a little at each end, which rounds the inside corners of the
      // arms the way a cut wheel is rounded rather than leaving them as sharp wedges.
      const inset = 0.055;
      const hole = new THREE.Path([
        ...arc(hub, from + inset, to - inset, 10),
        ...arc(rim, to, from, 18),
      ]);
      shape.holes.push(hole);
    }
  }

  if (bore > 0) shape.holes.push(new THREE.Path(arc(bore, 0, TAU, 28)));

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: spec.thickness,
    bevelEnabled: false,
    curveSegments: 4,
  });
  geometry.translate(0, 0, -spec.thickness / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The escape wheel, which is the only wheel in the movement whose teeth are not there to
 * mesh with anything.
 *
 * A club tooth does two quite different jobs with two different faces. Its nearly radial
 * back is the *locking* face, which rests against the flat of a pallet jewel and holds the
 * whole train still. Its sloped top is the *impulse* face, which slides across the jewel
 * and is the only place in the entire watch where the mainspring's energy is handed to the
 * balance. Between them the tooth is cut away to almost nothing, because that metal would
 * be inertia the escapement has to start and stop ten times a second.
 */
export function escapeWheelGeometry(teeth: number, radius: number, thickness: number): THREE.ExtrudeGeometry {
  const pitch = TAU / teeth;
  const rim = radius * 0.7;

  // [radius fraction, angle in fractions of the pitch]. The wheel runs towards negative
  // angles, so the leading edge of each tooth is the club at the front of this list: the
  // locking corner first, then the impulse face sloping back off it.
  const tooth: Array<[number, number]> = [
    [0.7, -0.36],
    [0.88, -0.33],
    [0.97, -0.3],
    [1.0, -0.275], // the locking corner, which is what the pallet jewel rests against
    [1.0, -0.075], // and the impulse face, which is what pushes it
    [0.93, -0.05],
    [0.8, 0.02],
    [0.71, 0.1],
  ];

  const outline: THREE.Vector2[] = [];
  for (let i = 0; i < teeth; i += 1) {
    const centre = i * pitch;
    for (const [r, a] of tooth) {
      const angle = centre + a * pitch;
      outline.push(new THREE.Vector2(Math.cos(angle) * r * radius, Math.sin(angle) * r * radius));
    }
    outline.push(...arc(rim, centre + 0.1 * pitch, centre + (1 - 0.36) * pitch, 4));
  }

  const shape = new THREE.Shape(outline);
  const hub = radius * 0.2;
  for (let i = 0; i < 3; i += 1) {
    const from = (i * TAU) / 3 + 0.17;
    const to = ((i + 1) * TAU) / 3 - 0.17;
    shape.holes.push(new THREE.Path([...arc(hub, from + 0.08, to - 0.08, 8), ...arc(rim * 0.94, to, from, 16)]));
  }
  shape.holes.push(new THREE.Path(arc(radius * 0.085, 0, TAU, 20)));

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 3 });
  geometry.translate(0, 0, -thickness / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The pallet fork: pivoted at the origin, the fork slot out along +X where the balance is,
 * the two pallet arms out along −X where the escape wheel is.
 *
 * It is one rigid bar and that is the whole idea. The escape wheel pushes the pallets, the
 * pallets push the bar, the bar pushes the balance, and in between beats the bar is held
 * hard against a banking pin by the draw on the locking face and does nothing whatsoever.
 * The balance is detached from it for nine tenths of every swing, which is what "detached
 * lever" means and why the escapement is worth its complication.
 *
 * The arms are not drawn freehand: each one ends in a pad built around the stone it
 * carries, so the metal wraps the jewel on three sides and leaves only the working face
 * looking at the escape wheel. That is what a pallet arm is, and drawing it any other way
 * leaves the stone apparently floating off the end of the arm.
 */
export function palletForkGeometry(): THREE.Shape {
  const { horn, boss, armWide, slotHalf, hornFlare } = FORK;

  /** The pad of metal around one stone: flush with the working face, proud of the rest. */
  const pad = (stone: { at: Spot; tilt: number }): Spot[] => {
    const [c, s] = [Math.cos(stone.tilt), Math.sin(stone.tilt)];
    const local = (x: number, y: number): Spot => ({
      x: stone.at.x + c * x - s * y,
      y: stone.at.y + s * x + c * y,
    });
    // Which way the escape wheel lies, in the stone's own axes: that face stays flush.
    const toWheel = -(PALLET_TO_ESCAPE + stone.at.x) * s - stone.at.y * c;
    const [half, thick, rim] = [STONE.length / 2, STONE.thick / 2, 0.07];
    const [face, back] = toWheel > 0 ? [thick, -thick - rim] : [thick + rim, -thick];
    return [
      local(-half - rim, back),
      local(half + rim, back),
      local(half + rim, face),
      local(-half - rim, face),
    ];
  };

  /**
   * Walk an arm: from one side of the boss, out and round the pad, and back to the other.
   *
   * The pad's corners come out of `pad` in rectangle order, which bears no relation to the
   * order the outline needs to visit them in, and threading them in blind folds the arm
   * over itself. So they are sorted by angle about the stone, measured from the direction
   * that points back at the boss, which walks them from one side of the arm round the far
   * end to the other side whichever way the stone happens to be turned.
   */
  const arm = (stone: { at: Spot; tilt: number }, from: Spot, to: Spot): Spot[] => {
    const len = Math.hypot(stone.at.x, stone.at.y);
    const back = { x: -stone.at.x / len, y: -stone.at.y / len };
    const side = { x: -back.y, y: back.x };
    const angle = (p: Spot) => {
      const [dx, dy] = [p.x - stone.at.x, p.y - stone.at.y];
      const a = Math.atan2(dx * side.x + dy * side.y, dx * back.x + dy * back.y);
      return a < 0 ? a + TAU : a;
    };
    const round = [...pad(stone)].sort((p, q) => angle(p) - angle(q));
    const fromSide = (from.x - stone.at.x) * side.x + (from.y - stone.at.y) * side.y;
    return [from, ...(fromSide > 0 ? round : round.reverse()), to];
  };

  // One closed loop: out the upper arm and round its stone, back to the boss, across to
  // the fork, round the notch, back, out the lower arm, and round the back of the boss.
  const points: Spot[] = [
    ...arm(
      PALLET_STONES[0],
      { x: -boss * 0.5, y: boss * 0.86 },
      { x: -boss * 0.95, y: boss * 0.52 },
    ),
    { x: boss * 0.6, y: boss * 0.38 },
    { x: horn * 0.52, y: armWide },
    { x: horn * 0.64, y: hornFlare },
    { x: horn, y: hornFlare },
    { x: horn, y: slotHalf },
    { x: horn * 0.87, y: slotHalf },
    { x: horn * 0.87, y: -slotHalf },
    { x: horn, y: -slotHalf },
    { x: horn, y: -hornFlare },
    { x: horn * 0.64, y: -hornFlare },
    { x: horn * 0.52, y: -armWide },
    { x: boss * 0.6, y: -boss * 0.38 },
    ...arm(
      PALLET_STONES[1],
      { x: -boss * 0.95, y: -boss * 0.52 },
      { x: -boss * 0.5, y: -boss * 0.86 },
    ),
  ];

  const shape = new THREE.Shape(points.map(({ x, y }) => new THREE.Vector2(x, y)));
  // Round the back of the boss, between the two arms.
  shape.absarc(0, 0, boss, -Math.PI * 0.6, Math.PI * 0.6, true);
  shape.closePath();
  shape.holes.push(new THREE.Path(arc(boss * 0.34, 0, TAU, 16)));
  return shape;
}

export function extrude(shape: THREE.Shape, thickness: number, segments = 6): THREE.ExtrudeGeometry {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: segments,
  });
  geometry.translate(0, 0, -thickness / 2);
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------- springs

/**
 * A spring drawn as a standing ribbon: a strip of metal on edge, following a path in the
 * plane. Both the hairspring and the mainspring are this, at different sizes.
 *
 * The geometry is allocated once and rewritten in place, because both of them change shape
 * every frame — the hairspring breathes in and out at 2.5 Hz and the mainspring coils
 * tighter every time the crown is turned — and rebuilding a few thousand vertices sixty
 * times a second is exactly the kind of thing that turns a page into a fan heater.
 */
export class Ribbon {
  readonly geometry: THREE.BufferGeometry;
  private readonly samples: number;
  private readonly position: THREE.BufferAttribute;
  private readonly normal: THREE.BufferAttribute;

  constructor(samples: number, private readonly height: number) {
    this.samples = samples;
    const vertices = samples * 2;
    this.position = new THREE.BufferAttribute(new Float32Array(vertices * 3), 3);
    this.normal = new THREE.BufferAttribute(new Float32Array(vertices * 3), 3);

    const index: number[] = [];
    for (let i = 0; i < samples - 1; i += 1) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', this.position);
    this.geometry.setAttribute('normal', this.normal);
    this.geometry.setIndex(index);
  }

  /** `path` fills in where the spine is at t ∈ [0, 1]. */
  update(path: (t: number, out: THREE.Vector2) => void): void {
    const here = new THREE.Vector2();
    const next = new THREE.Vector2();
    const positions = this.position.array as Float32Array;
    const normals = this.normal.array as Float32Array;
    const half = this.height / 2;

    for (let i = 0; i < this.samples; i += 1) {
      const t = i / (this.samples - 1);
      path(t, here);
      // The face of the ribbon looks sideways out of the path, so the normal is the
      // tangent turned a quarter turn in the plane.
      path(Math.min(1, t + 1e-3), next);
      let dx = next.x - here.x;
      let dy = next.y - here.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;

      const base = i * 6;
      positions[base] = here.x;
      positions[base + 1] = here.y;
      positions[base + 2] = -half;
      positions[base + 3] = here.x;
      positions[base + 4] = here.y;
      positions[base + 5] = half;
      normals[base] = -dy;
      normals[base + 1] = dx;
      normals[base + 2] = 0;
      normals[base + 3] = -dy;
      normals[base + 4] = dx;
      normals[base + 5] = 0;
    }

    this.position.needsUpdate = true;
    this.normal.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }
}

/**
 * Where the hairspring is, given how far the balance has turned.
 *
 * The outer end is pinned to a stud on the balance cock and never moves; the inner end is
 * clamped to the balance staff and moves with it. Everything between is assumed to take up
 * the difference evenly along its length, which is why the whole coil opens and closes
 * together instead of one end doing all the work. That is the *point* of a spiral spring
 * and the reason a watch is not a pendulum: the restoring torque is proportional to the
 * angle over hundreds of degrees, not a few.
 */
export function hairspringPath(
  balance: number,
  turns: number,
  inner: number,
  outer: number,
): (t: number, out: THREE.Vector2) => void {
  const studAngle = Math.PI * 0.5;
  return (t, out) => {
    const radius = inner + (outer - inner) * t;
    // Linear in t: the extra turn the balance has put in is shared out along the spring.
    const angle = balance + t * (studAngle + turns * TAU - balance);
    out.set(Math.cos(angle) * radius, Math.sin(angle) * radius);
  };
}

/**
 * Where the mainspring is, given the state of wind.
 *
 * This one is a picture rather than a result, and it is worth being honest about which.
 * The inner end really is on the arbor and the outer end really is hooked to the barrel
 * wall, and the number of coils really does grow by one for every turn wound in — all of
 * that is read straight out of the simulation. What is faked is the *distribution*: a
 * wound spring is drawn bunched against the arbor and a run-down one bunched against the
 * wall, by bending the radius profile, rather than by solving for how a coiled strip
 * actually settles against itself.
 */
export function mainspringPath(
  arborAngle: number,
  wind: number,
  baseTurns: number,
  arborRadius: number,
  wallRadius: number,
): (t: number, out: THREE.Vector2) => void {
  const sweep = -TAU * (baseTurns + wind);
  // Wound: stays near the arbor and sweeps out at the end. Run down: leaves the arbor at
  // once and lies against the wall.
  const bend = 0.45 + 2.6 * Math.min(1, Math.max(0, wind / 5.5));
  return (t, out) => {
    const radius = arborRadius + (wallRadius - arborRadius) * Math.pow(t, bend);
    const angle = arborAngle + sweep * t;
    out.set(Math.cos(angle) * radius, Math.sin(angle) * radius);
  };
}

// ---------------------------------------------------------------- odds and ends

/** A disc with holes in it: main plate, bridges, barrel lid, dial. */
export function plateGeometry(
  outline: THREE.Vector2[],
  holes: Array<{ x: number; y: number; r: number }>,
  thickness: number,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(outline);
  for (const hole of holes) {
    shape.holes.push(new THREE.Path(arc(hole.r, 0, TAU, 20).map((p) => p.add(new THREE.Vector2(hole.x, hole.y)))));
  }
  return extrude(shape, thickness, 8);
}

export function disc(radius: number, thickness: number, segments = 48): THREE.CylinderGeometry {
  const geometry = new THREE.CylinderGeometry(radius, radius, thickness, segments);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

export function ring(inner: number, outer: number, thickness: number, segments = 64): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(arc(outer, 0, TAU, segments));
  shape.holes.push(new THREE.Path(arc(inner, 0, TAU, segments)));
  return extrude(shape, thickness, 8);
}

/**
 * The crown: a knurled cylinder. The grooves are the whole reason a crown works, so they
 * are cut rather than painted on — and they are also what makes it obvious at a glance
 * that the thing has been turned.
 */
export function crownGeometry(radius: number, length: number, grooves: number): THREE.ExtrudeGeometry {
  const points: THREE.Vector2[] = [];
  const steps = grooves * 6;
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * TAU;
    // A gentle scallop rather than a sawtooth, which is what knurling on a crown looks
    // like once it has been polished.
    const r = radius * (1 + 0.075 * Math.cos(angle * grooves));
    points.push(new THREE.Vector2(Math.cos(angle) * r, Math.sin(angle) * r));
  }
  const geometry = extrude(new THREE.Shape(points), length, 2);
  geometry.rotateY(Math.PI / 2);
  return geometry;
}

/** A watch hand: a tapered blade with a counterweighted tail and a boss at the middle. */
export function handGeometry(length: number, width: number, tail: number, thickness: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, width);
  shape.lineTo(length * 0.72, width * 0.55);
  shape.lineTo(length, 0);
  shape.lineTo(length * 0.72, -width * 0.55);
  shape.lineTo(0, -width);
  shape.lineTo(-tail * 0.55, -width * 0.9);
  shape.lineTo(-tail, 0);
  shape.lineTo(-tail * 0.55, width * 0.9);
  shape.closePath();
  const geometry = extrude(shape, thickness, 4);
  // Hands point up the Y axis at zero, because twelve o'clock is up.
  geometry.rotateZ(Math.PI / 2);
  return geometry;
}

/**
 * The click: the pawl that lets the ratchet wheel turn one way and not the other, and
 * therefore the single part standing between a wound mainspring and the crown being torn
 * out of your fingers.
 */
export function clickGeometry(reach: number, thickness: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-reach * 0.22, reach * 0.2);
  shape.lineTo(reach * 0.62, reach * 0.26);
  shape.lineTo(reach * 1.0, reach * 0.06);
  shape.lineTo(reach * 1.0, -reach * 0.06);
  shape.lineTo(reach * 0.55, -reach * 0.2);
  shape.lineTo(-reach * 0.22, -reach * 0.2);
  shape.absarc(-reach * 0.22, 0, reach * 0.2, -Math.PI / 2, Math.PI / 2, true);
  shape.closePath();
  shape.holes.push(new THREE.Path(arc(reach * 0.09, 0, TAU, 12).map((p) => p.add(new THREE.Vector2(-reach * 0.22, 0)))));

  const geometry = extrude(shape, thickness, 6);
  // Slid so the screw hole is at the origin rather than the tail of the pawl, because the
  // caller rotates this about its origin and a lever that pivots somewhere other than its
  // pivot hole is a lever that will not line up with anything.
  geometry.translate(reach * 0.22, 0, 0);
  return geometry;
}

/** Where the nose ends up, measured from the pivot hole, for a click of this size. */
export const CLICK_NOSE = 1.22;

/**
 * The ratchet wheel, which is the one wheel in the watch that is not a gear.
 *
 * Every other wheel here has symmetrical teeth because every other wheel has to work in
 * both directions and roll smoothly through the mesh. This one has exactly the opposite
 * job: it must turn one way and refuse to turn the other, and it is not meshing with a
 * wheel at all but with a single pawl. So its teeth are saw teeth — a long shallow back
 * for the click to ride up, and a cliff at the end of it, cut on a radius so that the
 * wheel pushing against the click cannot lever it out.
 *
 * They are also about four times the size of a going-train tooth, which is not decoration.
 * The notch has to be deep enough for a click to sit in and be *seen* to sit in, and when
 * I first drew this wheel with the ordinary tooth profile the pawl looked like it was
 * resting on a smooth disc.
 */
/** The bottom of a ratchet notch. Shared, because the click has to be sized against it. */
export function ratchetRoot(teeth: number, radius: number): number {
  return radius - 2.1 * ((2 * radius) / teeth);
}

export function ratchetGeometry(teeth: number, radius: number, thickness: number): THREE.ExtrudeGeometry {
  const pitch = TAU / teeth;
  const root = ratchetRoot(teeth, radius);

  const at = (r: number, a: number): THREE.Vector2 => new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);

  const outline: THREE.Vector2[] = [];
  for (let i = 0; i < teeth; i += 1) {
    const a = i * pitch;
    outline.push(at(root, a));
    // The back, rising away from the root in a slight hollow rather than a straight ramp.
    outline.push(at(root + (radius - root) * 0.22, a + 0.28 * pitch));
    outline.push(at(root + (radius - root) * 0.62, a + 0.58 * pitch));
    outline.push(at(radius, a + 0.84 * pitch));
    // And the cliff: straight back down to the root on a radius.
    outline.push(at(root, a + 0.84 * pitch));
  }

  const shape = new THREE.Shape(outline);
  shape.holes.push(new THREE.Path(arc(radius * 0.19, 0, TAU, 20)));

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 4 });
  geometry.translate(0, 0, -thickness / 2);
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------- the rotor

/**
 * The rotor's arm: a disc with most of it cut away, leaving a hub, a ring at the rim and
 * a pair of spokes between them.
 *
 * All of this is the wrong way round from every other wheel in the watch. A train wheel is
 * lightened because inertia there is energy the balance never sees, so the crossings are
 * cut to leave as little metal as possible. The rotor is lightened for the opposite
 * reason: the metal that matters is the heavy segment on one side, and every gram anywhere
 * else is a gram that is *symmetrical*, and symmetrical mass is mass that produces no
 * turning moment at all while still having to be accelerated. Cutting the arm away does not
 * make the rotor lighter in any useful sense — it makes it more lopsided, which is the only
 * property a rotor has.
 */
export function rotorArmGeometry(radius: number, thickness: number): THREE.ExtrudeGeometry {
  const hub = radius * 0.19;
  // The ring left at the rim is thin, because the arm is not there to be metal. Everything
  // between the hub and that ring comes out, and what shows through the gap on the side
  // away from the weight is the movement — which is the only reason to skeletonise a rotor
  // rather than just making it lighter.
  const rim = radius * 0.93;
  const shape = new THREE.Shape(arc(radius, 0, TAU, 96));
  shape.holes.push(new THREE.Path(arc(hub * 0.4, 0, TAU, 24)));

  // Two openings, so what is left is two spokes on the axis of the weight. Along that axis
  // rather than across it because the spokes have to carry the weight's moment back to the
  // bearing, and a spoke is only stiff along its own length.
  const spokeHalf = 0.28;
  for (const side of [0, Math.PI]) {
    shape.holes.push(
      new THREE.Path([
        ...arc(hub, side + spokeHalf, side + Math.PI - spokeHalf, 14),
        ...arc(rim, side + Math.PI - spokeHalf, side + spokeHalf, 30),
      ]),
    );
  }

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 8,
  });
  geometry.translate(0, 0, -thickness / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The weight: a thick segment of tungsten filling a little under half the circle.
 *
 * Under half, and that is the point. A half-disc has its centre of gravity at 4r/3π, about
 * 42% of the radius; pulling the segment in to a crescent that hugs the rim moves it out
 * past 70%, and since the only number the physics cares about is mass times that distance,
 * the same metal bought nearly twice the torque by being put somewhere else.
 *
 * It grows upwards from the arm rather than straddling it, because downwards is the balance
 * cock, and there is about a third of a millimetre between them.
 */
export function rotorWeightGeometry(
  radius: number,
  inner: number,
  span: number,
  thickness: number,
): THREE.ExtrudeGeometry {
  const from = -span / 2;
  const to = span / 2;
  const shape = new THREE.Shape([...arc(radius, from, to, 48), ...arc(inner, to, from, 32)]);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 8,
  });
  geometry.computeVertexNormals();
  return geometry;
}

export { TAU, arc };
