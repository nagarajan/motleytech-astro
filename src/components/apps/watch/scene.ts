/**
 * The movement in three dimensions: building it, turning it, and letting you see through it.
 *
 * Two things here are worth knowing before reading the rest.
 *
 * The first is that every part owns its own materials. Sharing one brass material between
 * forty parts would be the obvious thing to do, and would make it impossible to fade any
 * one of them — and fading one of them is most of the point. A movement is five layers of
 * overlapping metal in four millimetres, and the only way to watch the escape wheel work
 * is to look through the bridge sitting on top of it.
 *
 * The second is that nothing in here decides anything. Every angle arrives from the
 * simulation each frame. If the picture and the simulation ever disagree about which way
 * a wheel is turning, the picture is wrong.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  CASE_RADIUS,
  CROWN_PULL,
  MOTION,
  PINION,
  R,
  SLIDING_IN,
  SPOT,
  STEM,
  THICK,
  Z,
  type Spot,
} from './layout';
import {
  arc,
  CLICK_NOSE,
  clickGeometry,
  crownGeometry,
  disc,
  escapeWheelGeometry,
  extrude,
  hairspringPath,
  handGeometry,
  mainspringPath,
  palletForkGeometry,
  plateGeometry,
  ratchetGeometry,
  ratchetRoot,
  Ribbon,
  ring,
  rotorArmGeometry,
  rotorWeightGeometry,
  wheelGeometry,
} from './parts';
import {
  AUTO,
  KEYLESS,
  MOTION_WORK,
  TRAIN,
  type Hands,
  type Pose,
  type Reading,
} from './movement';

const TAU = Math.PI * 2;

const FINISH = {
  brass: { color: 0xb88b30, metalness: 0.88, roughness: 0.3 },
  gilt: { color: 0xcda245, metalness: 0.9, roughness: 0.26 },
  steel: { color: 0x9aa3b0, metalness: 0.92, roughness: 0.19 },
  blued: { color: 0x3a5fc4, metalness: 0.82, roughness: 0.28 },
  // The plate is frosted and the bridges on top of it are polished. Real movements are
  // finished that way and here it earns its keep twice over, because two parts of the same
  // colour, a millimetre apart and both filling the frame, are otherwise one grey shape.
  nickel: { color: 0x9aa0aa, metalness: 0.62, roughness: 0.62 },
  bridge: { color: 0xa4abb6, metalness: 0.86, roughness: 0.22 },
  // The automatic work is rhodium-plated rather than gilt, which is how these modules are
  // usually finished and which here does a second job: the whole of the going train and the
  // barrel are yellow, and a reduction train in the same yellow, sitting directly on top of
  // them, is one continuous brass blur.
  rhodium: { color: 0xc3c9d2, metalness: 0.9, roughness: 0.17 },
  /** The rotor's weight. Dense, dark and deliberately unlike everything around it. */
  tungsten: { color: 0x565b66, metalness: 0.78, roughness: 0.38 },
  spring: { color: 0x8f99a7, metalness: 0.9, roughness: 0.25 },
  ruby: { color: 0xc42f4c, metalness: 0.15, roughness: 0.12 },
  dial: { color: 0xf6f1e4, metalness: 0.04, roughness: 0.8 },
  ink: { color: 0x22252c, metalness: 0.1, roughness: 0.7 },
} as const;

type Finish = keyof typeof FINISH;

export interface View {
  /** 0 assembled, 1 lifted apart along the axis it was built on. */
  exploded: number;
  /** 0 assembled, 1 with the plan dilated so no two parts overlap from the front. */
  spread: number;
  /** Per part, 0 invisible through 1 solid. */
  opacity: Record<string, number>;
  selected: string | null;
  /** How far the crown has been pulled, 0 to 1, animated by the caller. */
  crownOut: number;
}

export type Viewpoint = 'movement' | 'dial' | 'escapement' | 'keyless' | 'edge';

export interface Viewer {
  draw(pose: Pose, wheels: Record<string, number>, hands: Hands, reading: Reading, view: View): void;
  pick(clientX: number, clientY: number): string | null;
  /** Is the pointer over the crown? Dragging it is how the watch is wound and set. */
  onCrown(clientX: number, clientY: number): boolean;
  look(where: Viewpoint): void;
  /** Fly the camera in until the named part fills the frame, wherever it has got to. */
  study(id: string): void;
  /** Turned off while the crown is being dragged, so the view does not spin with it. */
  setOrbit(enabled: boolean): void;
  resize(): void;
  setBackground(colour: string): void;
  dispose(): void;
}

/** Somewhere to stand, chosen so the subject fills the frame. */
const VIEWPOINTS: Record<Viewpoint, { at: [number, number, number]; target: [number, number, number] }> = {
  movement: { at: [3, -9, 45], target: [0.5, 0, 0.6] },
  dial: { at: [0, 0, -46], target: [0, 0, -1.5] },
  escapement: { at: [-12.0, -16.4, 20.5], target: [-5.2, -5.3, 0.6] },
  // Low and from outside the case, because the pinions that do the switching live on the
  // stem itself and the crown wheel sits directly over them.
  keyless: { at: [19.0, 9.5, 17.0], target: [8.6, 0.6, 1.0] },
  edge: { at: [5, -42, 8], target: [0, -1, 0.6] },
};

// ---------------------------------------------------------------- part assembly

/**
 * How far the plan is stretched at full spread. Exploding sideways is a dilation about the
 * middle of the watch — every part is moved to `home × (1 + SPREAD)` — and a dilation is
 * the right transform here because it multiplies *every* distance between *every* pair of
 * parts by the same factor. Push each part out by a fixed amount instead and two wheels
 * that happen to lie on the same bearing from the centre never separate at all.
 */
const SPREAD = 0.62;

/** And how far it lifts, per millimetre of assembly height. */
const LIFT = 4.5;

interface Part {
  id: string;
  /** Moved bodily when the movement is exploded; everything else hangs off it. */
  holder: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
  meshes: THREE.Mesh[];
  /** The height the part lives at, which sets how far it lifts when exploded. */
  level: number;
  /** Where it sits in plan, which sets which way it travels when the plan is spread. */
  home: THREE.Vector2;
  /**
   * Pieces that are scattered across the movement rather than gathered at one arbor, and
   * so have to be moved one at a time. Only the jewels: there are eleven of them and the
   * whole point of them is that they are in eleven different places.
   */
  scattered: Array<{ object: THREE.Object3D; home: THREE.Vector3 }>;
  opacity: number;
  ghosted: boolean;
  chosen: boolean;
}

function circle(radius: number, steps = 72): THREE.Vector2[] {
  return arc(radius, 0, TAU, steps);
}

/**
 * The outline of a bridge: the convex hull of a few circles.
 *
 * At every direction the furthest point of the union is on whichever circle sticks out
 * most that way, and it is that circle's centre plus its radius. Stepping the direction
 * round traces the hull, and where the winning circle changes the trace jumps — which
 * draws, exactly, the straight tangent line between them. A bridge is what you get by
 * asking for enough metal around each pivot and as little as possible in between, and
 * this is a surprisingly good imitation of what a designer draws by hand.
 */
function bridgeOutline(circles: Array<{ x: number; y: number; r: number }>): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  const steps = 240;
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * TAU;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    let best = circles[0];
    let reach = -Infinity;
    for (const ring of circles) {
      const support = ux * ring.x + uy * ring.y + ring.r;
      if (support > reach) {
        reach = support;
        best = ring;
      }
    }
    points.push(new THREE.Vector2(best.x + ux * best.r, best.y + uy * best.r));
  }
  return points;
}

// ---------------------------------------------------------------- the viewer

export function createViewer(canvas: HTMLCanvasElement, background: string): Viewer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 400);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  // Close enough to fill the frame with the click spring, which is a millimetre long.
  controls.minDistance = 1.2;
  controls.maxDistance = 120;

  // Gilt and polished steel both go straight to white under a strong light, and a blown
  // out highlight hides exactly the shapes worth looking at, so the whole rig is kept
  // deliberately dim and the film curve takes the last of the hot spots off the top.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.72;

  // A polished metal surface is almost entirely a mirror, so a metal with nothing around
  // it to reflect renders black no matter how many lamps are pointed at it. This is the
  // room: a box of grey walls and a couple of bright panels, blurred into an environment
  // map once at startup. It is doing more for how the gilding and the steel look than all
  // four of the lights below put together.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = environment.texture;
  // Turned well down. At anything near full strength the room's bright panels swamp the
  // base colours and the gilding comes out as white paper.
  scene.environmentIntensity = 0.3;
  pmrem.dispose();

  const key = new THREE.DirectionalLight(0xfff4e6, 1.15);
  key.position.set(10, 15, 24);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fc0ff, 0.35);
  fill.position.set(-15, -10, 14);
  scene.add(fill);
  // Pointed along +Z, not the default +Y. The movement lies flat in the XY plane, so the
  // sky has to be over the bridges; left on its side it lights one edge of the watch and
  // drops the other into black, which looked like a bug and was one.
  const sky = new THREE.HemisphereLight(0xe2e9f6, 0x3c4350, 0.35);
  sky.position.set(0, 0, 1);
  scene.add(sky);
  // The dial faces away from every other light in here, so without this one the one view
  // everybody recognises is the one view that renders as a grey disc in shadow.
  const behind = new THREE.DirectionalLight(0xfffaf2, 1.2);
  behind.position.set(-6, 9, -22);
  scene.add(behind);

  const root = new THREE.Group();
  scene.add(root);

  const parts = new Map<string, Part>();

  function part(id: string, level: number, home: Spot = SPOT.centre): Part {
    const found = parts.get(id);
    if (found) return found;
    const holder = new THREE.Group();
    root.add(holder);
    const made: Part = {
      id,
      holder,
      materials: [],
      meshes: [],
      level,
      home: new THREE.Vector2(home.x, home.y),
      scattered: [],
      opacity: 1,
      ghosted: false,
      chosen: false,
    };
    parts.set(id, made);
    return made;
  }

  /** A material belonging to one part and no other, so it can be faded on its own. */
  function skin(owner: Part, finish: Finish, options: THREE.MeshStandardMaterialParameters = {}): THREE.Material {
    const material = new THREE.MeshStandardMaterial({ ...FINISH[finish], ...options });
    owner.materials.push(material);
    return material;
  }

  /** Add a mesh to a part, and mark it so a click on it finds its way home. */
  function piece(
    owner: Part,
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    finish: Finish,
    options?: THREE.MeshStandardMaterialParameters,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, skin(owner, finish, options));
    mesh.userData.partId = owner.id;
    owner.meshes.push(mesh);
    parent.add(mesh);
    return mesh;
  }

  /** A group that spins about its own arbor, parked at its place in the plan. */
  function spinner(owner: Part, at: Spot): THREE.Group {
    const group = new THREE.Group();
    group.position.set(at.x, at.y, 0);
    owner.holder.add(group);
    return group;
  }

  function at<T extends THREE.BufferGeometry>(geometry: T, z: number): T {
    geometry.translate(0, 0, z);
    return geometry;
  }

  // ---------------------------------------------------------------- jewels

  const jewels = part('jewels', 0.4);
  const jewelGeometry = disc(0.44, 0.24, 20);
  function jewelAt(spot: Spot, z: number): void {
    const mesh = piece(jewels, jewels.holder, jewelGeometry, 'ruby');
    mesh.position.set(spot.x, spot.y, z);
    // Each one stays with the pivot it belongs to when the plan opens out, rather than
    // being left behind in a heap where the movement used to be.
    jewels.scattered.push({ object: mesh, home: mesh.position.clone() });
  }

  // ---------------------------------------------------------------- frame

  {
    const plate = part('plate', Z.plate);
    piece(
      plate,
      plate.holder,
      at(
        plateGeometry(
          circle(CASE_RADIUS),
          [
            { ...SPOT.centre, r: 0.46 },
            { ...SPOT.barrel, r: 0.5 },
            { ...SPOT.third, r: 0.32 },
            { ...SPOT.fourth, r: 0.32 },
            { ...SPOT.escape, r: 0.3 },
            { ...SPOT.pallet, r: 0.28 },
            { ...SPOT.balance, r: 0.3 },
            { ...SPOT.setting, r: 0.32 },
            { ...SPOT.minuteWheel, r: 0.28 },
            // The pocket the keyless works drop into, cut right through at the edge.
            { x: STEM.start + 2.2, y: 0, r: 1.7 },
          ],
          THICK.plate,
        ),
        Z.plate,
      ),
      'nickel',
    );
    for (const spot of [SPOT.third, SPOT.fourth, SPOT.escape, SPOT.pallet, SPOT.balance, SPOT.centre]) {
      jewelAt(spot, Z.plate + THICK.plate / 2);
    }
  }

  {
    const bridges = part('bridges', Z.bridge);
    piece(
      bridges,
      bridges.holder,
      at(
        plateGeometry(
          bridgeOutline([
            { ...SPOT.centre, r: 2.1 },
            { ...SPOT.third, r: 1.9 },
            { ...SPOT.fourth, r: 1.8 },
            { ...SPOT.escape, r: 1.5 },
            { ...SPOT.pallet, r: 1.25 },
          ]),
          [
            { ...SPOT.centre, r: 0.42 },
            { ...SPOT.third, r: 0.3 },
            { ...SPOT.fourth, r: 0.3 },
            { ...SPOT.escape, r: 0.28 },
            { ...SPOT.pallet, r: 0.26 },
          ],
          THICK.bridge,
        ),
        Z.bridge,
      ),
      'bridge',
    );
    piece(
      bridges,
      bridges.holder,
      at(
        plateGeometry(
          bridgeOutline([
            { ...SPOT.barrel, r: R.barrel + 0.8 },
            { ...SPOT.crownWheel, r: 2.2 },
          ]),
          [
            { ...SPOT.barrel, r: 0.5 },
            { ...SPOT.crownWheel, r: 0.44 },
            { ...SPOT.click, r: 0.28 },
            // A bite out of the bridge for the winding pinion to reach up through.
            { ...SPOT.windingPinion, r: R.windingPinion + 0.3 },
          ],
          THICK.bridge,
        ),
        Z.bridge,
      ),
      'bridge',
    );
    for (const spot of [SPOT.centre, SPOT.third, SPOT.fourth, SPOT.escape, SPOT.pallet, SPOT.barrel]) {
      jewelAt(spot, Z.bridge + THICK.bridge / 2);
    }
  }

  const studAt: Spot = {
    x: SPOT.balance.x,
    y: SPOT.balance.y + R.balance * 0.74,
  };

  {
    // Homed on the balance rather than the middle of the watch, so that when the plan opens
    // out the cock travels with the wheel it carries instead of being left behind.
    const cock = part('cock', Z.cock, SPOT.balance);
    piece(
      cock,
      cock.holder,
      at(
        plateGeometry(
          bridgeOutline([
            { ...SPOT.balance, r: 1.6 },
            { ...SPOT.cockFoot, r: 1.5 },
          ]),
          [{ ...SPOT.balance, r: 0.34 }],
          THICK.bridge,
        ),
        Z.cock,
      ),
      'bridge',
    );
    jewelAt(SPOT.balance, Z.cock + THICK.bridge / 2);
    // The stud: the little block the hairspring's outer end is pinned into. Everything the
    // hairspring does, it does relative to this.
    const stud = piece(cock, cock.holder, disc(0.32, 0.8, 12), 'blued');
    stud.position.set(studAt.x, studAt.y, Z.hairspring);
  }

  // ---------------------------------------------------------------- power

  const barrelPart = part('barrel', Z.barrelTeeth, SPOT.barrel);
  const barrelSpin = spinner(barrelPart, SPOT.barrel);
  {
    // A toothed drum with a floor and a lid. The teeth on the outside are the first wheel
    // of the going train, so the barrel is both the container and the driver.
    piece(
      barrelPart,
      barrelSpin,
      at(
        wheelGeometry({
          teeth: TRAIN.barrel,
          radius: R.barrel,
          thickness: THICK.barrelWall,
          bore: R.barrel * 0.845,
        }),
        Z.barrelTeeth,
      ),
      'brass',
    );
    piece(
      barrelPart,
      barrelSpin,
      at(ring(0.64, R.barrel * 0.85, 0.2, 56), Z.barrelTeeth - THICK.barrelWall / 2 + 0.1),
      'brass',
    );
    piece(barrelPart, barrelSpin, at(ring(0.64, R.barrel * 0.87, 0.22, 56), Z.barrelLid), 'brass');
  }

  const mainspringPart = part('mainspring', Z.barrelTeeth, SPOT.barrel);
  const mainspring = new Ribbon(620, THICK.mainspring);
  {
    const mesh = piece(mainspringPart, mainspringPart.holder, mainspring.geometry, 'spring', {
      side: THREE.DoubleSide,
    });
    mesh.position.set(SPOT.barrel.x, SPOT.barrel.y, Z.barrelTeeth);
    mesh.frustumCulled = false;
  }

  const ratchetPart = part('ratchet', Z.ratchet, SPOT.barrel);
  const ratchetSpin = spinner(ratchetPart, SPOT.barrel);
  {
    piece(
      ratchetPart,
      ratchetSpin,
      at(ratchetGeometry(KEYLESS.ratchet, R.ratchet, 0.3), Z.ratchet),
      'gilt',
    );
    // The arbor runs all the way down through the barrel to hold the spring's inner end.
    piece(ratchetPart, ratchetSpin, at(disc(0.44, Z.ratchet - Z.plate, 16), (Z.ratchet + Z.plate) / 2), 'steel');
    piece(ratchetPart, ratchetSpin, at(disc(0.66, THICK.barrelWall + 0.3, 14), Z.barrelTeeth), 'steel');
  }

  /**
   * How far the click's nose sits from its pivot, and which way it has to point.
   *
   * Nothing here is a free choice. The pivot is where it is, the ratchet wheel's root
   * circle is where it is, and the nose has to be on that circle — which is a triangle with
   * all three sides known, so the cosine rule gives the angle and the only decision left is
   * its sign. It takes the negative one so that the pawl's tail swings up towards the
   * spring that presses on it, and so that the small rock as it rides over each tooth lifts
   * the nose *out* of the wheel rather than driving it further in.
   *
   * Drawing this by eye is what I did first, and the nose sat a millimetre inside the
   * wheel: invisible at any sensible zoom, and the first thing you see close up.
   */
  const CLICK_REACH = 1.15;
  // Aimed a third of the way up out of the notch rather than at the very bottom of it, so
  // that the nose is bearing on the cliff face and not standing on the floor.
  const CLICK_ROOT = ratchetRoot(KEYLESS.ratchet, R.ratchet) + 0.07;
  const CLICK_ARM = CLICK_REACH * CLICK_NOSE;
  const CLICK_SPAN = Math.hypot(SPOT.barrel.x - SPOT.click.x, SPOT.barrel.y - SPOT.click.y);
  const CLICK_REST =
    Math.atan2(SPOT.barrel.y - SPOT.click.y, SPOT.barrel.x - SPOT.click.x) -
    Math.acos((CLICK_SPAN ** 2 + CLICK_ARM ** 2 - CLICK_ROOT ** 2) / (2 * CLICK_SPAN * CLICK_ARM));

  const clickPart = part('click', Z.click, SPOT.click);
  const clickSpin = new THREE.Group();
  clickSpin.position.set(SPOT.click.x, SPOT.click.y, Z.click);
  clickPart.holder.add(clickSpin);
  {
    piece(clickPart, clickSpin, clickGeometry(CLICK_REACH, 0.26), 'steel');
    // The click spring: a slender blued blade pressing the pawl home. A spring is only a
    // shape that gives, so it is drawn as one. It has to reach the pawl's flank and stop,
    // which is a millimetre and a bit, not the three it used to be drawn at.
    const blade = new THREE.Shape(
      [
        [0, 0],
        [0.62, 0.34],
        [1.12, 0.25],
        [1.12, 0.14],
        [0.66, 0.22],
        [0.11, -0.09],
      ].map(([x, y]) => new THREE.Vector2(x, y)),
    );
    const spring = piece(clickPart, clickPart.holder, extrude(blade, 0.22, 4), 'blued');
    spring.position.set(SPOT.click.x, SPOT.click.y, Z.click);
    spring.rotation.z = CLICK_REST + Math.PI * 0.72;
  }

  // ---------------------------------------------------------------- automatic winding

  /**
   * The reduction train, built the same way as the going train and doing the opposite job.
   * The going train turns one slow strong wheel into a fast weak one; this turns a hundred
   * turns of a feeble weight into one turn of the barrel arbor.
   */
  function autoWheel(
    id: string,
    spot: Spot,
    teeth: number,
    radius: number,
    wheelZ: number,
    leaves: number,
    leafRadius: number,
    pinionZ: number,
  ): THREE.Group {
    const owner = part(id, wheelZ, spot);
    const group = spinner(owner, spot);
    piece(
      owner,
      group,
      at(
        wheelGeometry({ teeth, radius, thickness: THICK.wheel, crossings: 4, bore: 0.3 }),
        wheelZ,
      ),
      'rhodium',
    );
    piece(
      owner,
      group,
      at(
        wheelGeometry({
          teeth: leaves,
          radius: leafRadius,
          thickness: THICK.pinion,
          bore: leafRadius * 0.3,
          pinion: true,
        }),
        pinionZ,
      ),
      'steel',
    );
    // The arbor down to its pivot, which is in the automatic work's own bridge rather than
    // in the main plate — the whole module is a storey above the watch.
    piece(owner, group, at(disc(0.24, wheelZ - Z.ratchet + 0.5, 12), (wheelZ + Z.ratchet) / 2), 'steel');
    return group;
  }

  const reductionSpin = autoWheel(
    'reduction',
    SPOT.reduction,
    AUTO.reduction,
    R.reduction,
    Z.reductionWheel,
    AUTO.reductionPinion,
    R.reductionPinion,
    Z.reductionPinion,
  );
  const reversingSpin = autoWheel(
    'reversing',
    SPOT.reversing,
    AUTO.reversing,
    R.reversing,
    Z.reversingWheel,
    AUTO.reversingPinion,
    R.reversingPinion,
    Z.reversingPinion,
  );

  /**
   * The rotor.
   *
   * Homed on the middle of the watch, because that is where it turns, and because when the
   * plan is spread out the rotor should stay put and let everything else walk out from
   * under it — which is the only way to see what it has been covering.
   */
  const rotorPart = part('rotor', Z.rotor, SPOT.centre);
  const rotorSpin = spinner(rotorPart, SPOT.centre);
  {
    piece(rotorPart, rotorSpin, at(rotorArmGeometry(R.rotor, THICK.rotor), Z.rotor), 'rhodium');

    // The weight. Its inner edge at 0.6 of the radius and its span a little over a third of
    // the circle: a crescent rather than a half-disc, which is what puts its centre of
    // gravity out at seven tenths of the radius instead of four.
    //
    // Left pointing along +x, which is where the physics assumes it is. The rotor's
    // equilibrium comes out of the equations at φ = −90°, so if the drawing agrees with the
    // maths the weight should hang straight down with the watch level — and it does, which
    // is a small free check that the two have not drifted apart.
    const weight = piece(
      rotorPart,
      rotorSpin,
      rotorWeightGeometry(R.rotor, R.rotor * 0.6, Math.PI * 0.78, THICK.rotorWeight),
      'tungsten',
    );
    // Upward from the arm's underside. Downward is the balance cock, a third of a
    // millimetre away.
    weight.position.set(0, 0, Z.rotor - THICK.rotor / 2);

    // The ball race the whole thing hangs on, and the pinion under it.
    piece(rotorPart, rotorSpin, at(ring(0.82, 1.5, 0.62, 40), Z.rotor - 0.1), 'steel');
    piece(
      rotorPart,
      rotorSpin,
      at(
        wheelGeometry({
          teeth: AUTO.rotorPinion,
          radius: R.rotorPinion,
          thickness: THICK.pinion,
          pinion: true,
        }),
        Z.rotorPinion,
      ),
      'steel',
    );
    piece(rotorPart, rotorSpin, at(disc(0.3, Z.rotor - Z.rotorPinion, 12), (Z.rotor + Z.rotorPinion) / 2), 'steel');
  }

  /**
   * The bridle: the last few centimetres of the mainspring, lying against the inside of the
   * barrel wall and held there by nothing but friction.
   *
   * Drawn as its own band just outside the outermost coil, because otherwise there is
   * nothing to see — it is a length of spring that differs from the rest of the spring only
   * in not being hooked to anything. What makes it visible is the slipping: it is pinned to
   * the barrel until the spring is full, and then it starts creeping round the wall, and
   * watching that creep is watching a rotor wind into nothing.
   */
  const bridlePart = part('bridle', Z.barrelTeeth, SPOT.barrel);
  const bridleSpin = spinner(bridlePart, SPOT.barrel);
  {
    const wall = R.barrel * 0.82;
    const band = new THREE.Shape([
      ...arc(wall + 0.07, 0, Math.PI * 0.7, 30),
      ...arc(wall - 0.07, Math.PI * 0.7, 0, 30),
    ]);
    piece(bridlePart, bridleSpin, at(extrude(band, THICK.mainspring, 6), Z.barrelTeeth), 'blued');
  }

  // ---------------------------------------------------------------- the going train

  /** A wheel, the pinion it is driven by, and the arbor they share. */
  function trainWheel(
    id: string,
    spot: Spot,
    teeth: number,
    radius: number,
    wheelZ: number,
    crossings: number,
    leaves: number,
    leafRadius: number,
    pinionZ: number,
    arborFrom: number,
  ): THREE.Group {
    const owner = part(id, wheelZ, spot);
    const group = spinner(owner, spot);
    piece(
      owner,
      group,
      at(wheelGeometry({ teeth, radius, thickness: THICK.wheel, crossings, bore: 0.32 }), wheelZ),
      'brass',
    );
    piece(
      owner,
      group,
      at(
        wheelGeometry({
          teeth: leaves,
          radius: leafRadius,
          thickness: THICK.pinion,
          bore: leafRadius * 0.32,
          pinion: true,
        }),
        pinionZ,
      ),
      'steel',
    );
    piece(owner, group, at(disc(0.26, Z.bridge - arborFrom, 12), (Z.bridge + arborFrom) / 2), 'steel');
    return group;
  }

  const centreSpin = trainWheel(
    'centre',
    SPOT.centre,
    TRAIN.centre,
    R.centre,
    Z.centreWheel,
    4,
    TRAIN.centrePinion,
    PINION.centre,
    Z.centrePinion,
    Z.cannon,
  );
  const thirdSpin = trainWheel(
    'third',
    SPOT.third,
    TRAIN.third,
    R.third,
    Z.thirdWheel,
    3,
    TRAIN.thirdPinion,
    PINION.third,
    Z.thirdPinion,
    Z.plate,
  );
  const fourthSpin = trainWheel(
    'fourth',
    SPOT.fourth,
    TRAIN.fourth,
    R.fourth,
    Z.fourthWheel,
    3,
    TRAIN.fourthPinion,
    PINION.fourth,
    Z.fourthPinion,
    Z.handSecond,
  );

  const escapePart = part('escapeWheel', Z.escapeWheel, SPOT.escape);
  const escapeSpin = spinner(escapePart, SPOT.escape);
  {
    piece(
      escapePart,
      escapeSpin,
      at(escapeWheelGeometry(TRAIN.escape, R.escape, THICK.escape), Z.escapeWheel),
      'steel',
    );
    piece(
      escapePart,
      escapeSpin,
      at(
        wheelGeometry({
          teeth: TRAIN.escapePinion,
          radius: PINION.escape,
          thickness: THICK.pinion,
          bore: PINION.escape * 0.32,
          pinion: true,
        }),
        Z.escapePinion,
      ),
      'steel',
    );
    piece(escapePart, escapeSpin, at(disc(0.2, Z.bridge - Z.plate, 12), (Z.bridge + Z.plate) / 2), 'steel');
  }

  // ---------------------------------------------------------------- the escapement

  /**
   * Where the pallet jewels sit. This is not a styling decision: each one has to land on
   * the escape wheel's tip circle, and the two of them have to be far enough apart to
   * straddle two and a half teeth. Solve for that and the shape of the lever follows.
   */
  const PALLET_JEWEL = (() => {
    const span = 30 * (Math.PI / 180);
    const x = 3.0 - R.escape * Math.cos(span);
    const y = R.escape * Math.sin(span);
    return new THREE.Vector2(-x, y);
  })();

  const palletPart = part('pallet', Z.pallet, SPOT.pallet);
  const forkSpin = new THREE.Group();
  forkSpin.position.set(SPOT.pallet.x, SPOT.pallet.y, Z.pallet);
  palletPart.holder.add(forkSpin);
  {
    piece(
      palletPart,
      forkSpin,
      extrude(palletForkGeometry(PALLET_JEWEL, 2.05, 0.56), THICK.pallet, 4),
      'steel',
    );
    for (const side of [1, -1]) {
      const stone = piece(palletPart, forkSpin, new THREE.BoxGeometry(0.66, 0.3, THICK.pallet * 1.2), 'ruby');
      stone.position.set(PALLET_JEWEL.x, side * PALLET_JEWEL.y, 0);
      stone.rotation.z = side * 0.62;
    }
    piece(palletPart, forkSpin, at(disc(0.22, 0.95, 12), 0.2), 'steel');
  }

  const balancePart = part('balance', Z.balanceWheel, SPOT.balance);
  const balanceSpin = spinner(balancePart, SPOT.balance);
  {
    // A heavy rim on light arms: all of the inertia as far from the axis as it will go,
    // because the frequency depends on the inertia and the rim is where it is cheapest.
    piece(balancePart, balanceSpin, at(ring(R.balance * 0.88, R.balance, THICK.balanceRim, 84), Z.balanceWheel), 'brass');
    for (let i = 0; i < 2; i += 1) {
      const arm = piece(
        balancePart,
        balanceSpin,
        new THREE.BoxGeometry(R.balance * 1.8, 0.44, THICK.balanceRim * 0.62),
        'brass',
      );
      arm.position.z = Z.balanceWheel;
      arm.rotation.z = (i * Math.PI) / 2;
    }
    // Timing screws. Running them in or out moves metal towards or away from the axis and
    // so changes the inertia — the coarse adjustment that the regulator refines.
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * TAU + 0.26;
      const screw = piece(balancePart, balanceSpin, disc(0.25, 0.52, 10), 'steel');
      screw.position.set(Math.cos(angle) * R.balance, Math.sin(angle) * R.balance, Z.balanceWheel);
      screw.rotation.y = Math.PI / 2;
    }
    piece(balancePart, balanceSpin, at(disc(0.19, Z.cock - Z.roller, 12), (Z.cock + Z.roller) / 2), 'steel');

    // The roller table, at the bottom of the staff down where the fork is. Its one jewel
    // is the entire conversation between the escapement and the balance.
    piece(balancePart, balanceSpin, at(disc(R.roller, 0.4, 30), Z.roller), 'steel');
    const impulse = piece(balancePart, balanceSpin, new THREE.CylinderGeometry(0.18, 0.18, 0.52, 12), 'ruby');
    impulse.rotation.x = Math.PI / 2;
    impulse.position.set(R.roller * 0.77, 0, Z.roller);
  }

  const hairPart = part('hairspring', Z.hairspring, SPOT.balance);
  const hairspring = new Ribbon(820, THICK.hairspring);
  {
    const mesh = piece(hairPart, hairPart.holder, hairspring.geometry, 'blued', { side: THREE.DoubleSide });
    mesh.position.set(SPOT.balance.x, SPOT.balance.y, Z.hairspring);
    mesh.frustumCulled = false;
  }

  // ---------------------------------------------------------------- keyless works

  const stemPart = part('stem', Z.stem, { x: STEM.crownAt, y: 0 });
  const stemSlide = new THREE.Group();
  stemPart.holder.add(stemSlide);
  // Parked on the stem's own axis, so that turning it is a rotation about that axis rather
  // than the whole thing swinging round the middle of the watch.
  const stemSpin = new THREE.Group();
  stemSpin.position.set(0, 0, Z.stem);
  stemSlide.add(stemSpin);
  let crownMesh: THREE.Mesh;
  {
    const rod = piece(
      stemPart,
      stemSpin,
      new THREE.CylinderGeometry(STEM.radius, STEM.radius, STEM.end - STEM.start, 16),
      'steel',
    );
    rod.rotation.z = Math.PI / 2;
    rod.position.set((STEM.start + STEM.end) / 2, 0, 0);

    crownMesh = piece(stemPart, stemSpin, crownGeometry(STEM.crownRadius, 2.0, 20), 'steel');
    crownMesh.position.set(STEM.crownAt, 0, 0);
    crownMesh.userData.crown = true;
  }

  const windingPart = part('windingPinion', Z.stem, SPOT.windingPinion);
  const windingSpin = new THREE.Group();
  windingSpin.position.set(SPOT.windingPinion.x, 0, Z.stem);
  // Lying on its side: a wheel on the stem has its axis along X, not Z like everything else.
  windingSpin.rotation.y = Math.PI / 2;
  windingPart.holder.add(windingSpin);
  piece(
    windingPart,
    windingSpin,
    wheelGeometry({
      teeth: KEYLESS.windingPinion,
      radius: R.windingPinion,
      thickness: 0.66,
      bore: STEM.radius,
    }),
    'steel',
  );

  const slidingPart = part('slidingPinion', Z.stem, { x: SLIDING_IN, y: 0 });
  const slidingSlide = new THREE.Group();
  slidingPart.holder.add(slidingSlide);
  const slidingSpin = new THREE.Group();
  slidingSpin.position.set(SLIDING_IN, 0, Z.stem);
  slidingSpin.rotation.y = Math.PI / 2;
  slidingSlide.add(slidingSpin);
  piece(
    slidingPart,
    slidingSpin,
    wheelGeometry({
      teeth: 12,
      radius: R.slidingPinion,
      thickness: 0.7,
      bore: STEM.radius,
      pinion: true,
    }),
    'steel',
  );

  const crownWheelPart = part('crownWheel', Z.crownWheel, SPOT.crownWheel);
  const crownWheelSpin = new THREE.Group();
  crownWheelSpin.position.set(SPOT.crownWheel.x, SPOT.crownWheel.y, Z.crownWheel);
  crownWheelPart.holder.add(crownWheelSpin);
  piece(
    crownWheelPart,
    crownWheelSpin,
    wheelGeometry({ teeth: KEYLESS.crownWheel, radius: R.crownWheel, thickness: 0.3, bore: 0.44 }),
    'gilt',
  );

  const settingPart = part('setting', Z.setting, SPOT.setting);
  const settingSpin = spinner(settingPart, SPOT.setting);
  {
    piece(
      settingPart,
      settingSpin,
      at(wheelGeometry({ teeth: 22, radius: R.settingWheel, thickness: 0.34, bore: 0.32 }), Z.setting),
      'steel',
    );
    piece(
      settingPart,
      settingSpin,
      at(
        wheelGeometry({
          teeth: 14,
          radius: MOTION.settingPinion,
          thickness: 0.34,
          bore: 0.32,
          pinion: true,
        }),
        Z.settingPinion,
      ),
      'steel',
    );
    piece(
      settingPart,
      settingSpin,
      at(disc(0.3, Z.setting - Z.settingPinion, 12), (Z.setting + Z.settingPinion) / 2),
      'steel',
    );
  }

  // ---------------------------------------------------------------- dial side

  const motionPart = part('motion', Z.minuteWheel);
  const cannonSpin = spinner(motionPart, SPOT.centre);
  {
    piece(
      motionPart,
      cannonSpin,
      at(
        wheelGeometry({
          teeth: MOTION_WORK.cannon,
          radius: MOTION.cannon,
          thickness: 0.34,
          bore: 0.24,
          pinion: true,
        }),
        Z.cannon,
      ),
      'steel',
    );
    piece(motionPart, cannonSpin, at(disc(0.3, Z.cannon - Z.handMinute, 12), (Z.cannon + Z.handMinute) / 2), 'steel');
  }

  const minuteSpin = spinner(motionPart, SPOT.minuteWheel);
  {
    piece(
      motionPart,
      minuteSpin,
      at(
        wheelGeometry({
          teeth: MOTION_WORK.minute,
          radius: MOTION.minuteWheel,
          thickness: 0.28,
          crossings: 3,
          bore: 0.26,
        }),
        Z.minuteWheel,
      ),
      'brass',
    );
    piece(
      motionPart,
      minuteSpin,
      at(
        wheelGeometry({
          teeth: MOTION_WORK.minutePinion,
          radius: MOTION.minutePinion,
          thickness: 0.34,
          bore: 0.26,
          pinion: true,
        }),
        Z.minutePinion,
      ),
      'steel',
    );
  }

  const hourSpin = spinner(motionPart, SPOT.centre);
  {
    piece(
      motionPart,
      hourSpin,
      at(
        wheelGeometry({
          teeth: MOTION_WORK.hour,
          radius: MOTION.hourWheel,
          thickness: 0.3,
          crossings: 3,
          bore: 0.52,
        }),
        Z.hourWheel,
      ),
      'brass',
    );
    // The hour wheel is a pipe riding over the cannon pinion's pipe: two hands, one axis.
    piece(motionPart, hourSpin, at(ring(0.32, 0.48, Z.hourWheel - Z.handHour, 16), (Z.hourWheel + Z.handHour) / 2), 'brass');
  }

  {
    const dialPart = part('dial', Z.dial);
    piece(
      dialPart,
      dialPart.holder,
      at(
        plateGeometry(
          circle(CASE_RADIUS - 0.35),
          [
            { ...SPOT.centre, r: 0.52 },
            { ...SPOT.fourth, r: 0.3 },
          ],
          THICK.dial,
        ),
        Z.dial,
      ),
      'dial',
    );

    const face = Z.dial - THICK.dial / 2 - 0.05;
    const short = new THREE.BoxGeometry(0.3, 1.5, 0.1);
    const long = new THREE.BoxGeometry(0.44, 2.3, 0.1);
    // Negative X, because the dial is looked at from the far side: the hands turn one way
    // in the world and appear to turn the other, and the markers have to follow them.
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * TAU;
      const reach = CASE_RADIUS - 2.0;
      const mark = piece(dialPart, dialPart.holder, i % 3 === 0 ? long : short, 'ink');
      mark.position.set(-Math.sin(angle) * reach, Math.cos(angle) * reach, face);
      mark.rotation.z = angle;
    }
    // The subsidiary seconds track, which sits over the fourth wheel because there is
    // nowhere else it could sit.
    const track = piece(dialPart, dialPart.holder, ring(1.62, 1.76, 0.08, 48), 'ink');
    track.position.set(SPOT.fourth.x, SPOT.fourth.y, face);
  }

  const handsPart = part('hands', Z.handMinute);
  const hourHand = piece(handsPart, handsPart.holder, handGeometry(7.4, 0.58, 1.5, THICK.hand), 'blued');
  hourHand.position.set(SPOT.centre.x, SPOT.centre.y, Z.handHour);
  const minuteHand = piece(handsPart, handsPart.holder, handGeometry(10.6, 0.44, 1.8, THICK.hand), 'blued');
  minuteHand.position.set(SPOT.centre.x, SPOT.centre.y, Z.handMinute);
  const secondHand = piece(handsPart, handsPart.holder, handGeometry(1.5, 0.15, 0.5, 0.08), 'blued');
  secondHand.position.set(SPOT.fourth.x, SPOT.fourth.y, Z.handSecond);

  // ---------------------------------------------------------------- per frame

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  /** The spread the camera has already been backed off for. */
  let framedFor = 0;

  /** Where the parts sit on average, which is not the middle of the watch. */
  const crowd = (() => {
    const mean = new THREE.Vector2();
    for (const owner of parts.values()) mean.add(owner.home);
    return mean.divideScalar(parts.size);
  })();

  /** Enough coils to look like a hairspring; a real one has twelve to fourteen. */
  const HAIRSPRING_TURNS = 9;
  /** The coils a run-down mainspring still has lying against the barrel wall. */
  const MAINSPRING_TURNS = 3.4;
  const FORK_REST = Math.PI;

  function draw(pose: Pose, wheels: Record<string, number>, hands: Hands, reading: Reading, view: View): void {
    barrelSpin.rotation.z = wheels.barrel;
    ratchetSpin.rotation.z = pose.arbor;
    crownWheelSpin.rotation.z = -pose.arbor * (KEYLESS.ratchet / KEYLESS.crownWheel);

    // The click rides up the back of each tooth and drops off it. One tooth of the ratchet
    // wheel is one audible click of a watch being wound; this is where the sound lives.
    const phase = (-pose.arbor / TAU) * KEYLESS.ratchet;
    clickSpin.rotation.z = CLICK_REST - 0.14 * Math.pow(phase - Math.floor(phase), 2.5);

    // The automatic work. The rotor and the reduction wheel follow the rotor, backwards
    // included; the reversing wheel follows the ratchet, which only ever goes one way. The
    // two do not agree, and the disagreement is the reverser.
    rotorSpin.rotation.z = pose.rotor;
    reductionSpin.rotation.z = wheels.reduction;
    reversingSpin.rotation.z = wheels.reversing;
    // Carried round by the barrel, less however much it has given up at the wall. While
    // the spring has room this is just the barrel's own angle; once it is full the second
    // term starts to grow and the band creeps.
    bridleSpin.rotation.z = wheels.barrel - reading.slipped * TAU;

    centreSpin.rotation.z = wheels.centre;
    thirdSpin.rotation.z = wheels.third;
    fourthSpin.rotation.z = wheels.fourth;
    escapeSpin.rotation.z = wheels.escape;

    forkSpin.rotation.z = FORK_REST + pose.fork;
    balanceSpin.rotation.z = pose.balance;

    hairspring.update(hairspringPath(pose.balance, HAIRSPRING_TURNS, 0.36, R.balance * 0.74));
    mainspring.update(mainspringPath(pose.arbor, reading.wind, MAINSPRING_TURNS, 0.8, R.barrel * 0.79));

    // The motion work hangs off the cannon pinion, and the only arithmetic under the dial
    // is 36/12 and then 40/10, which multiply to the twelve everyone wants.
    cannonSpin.rotation.z = hands.minute;
    minuteSpin.rotation.z = -hands.minute / 3;
    hourSpin.rotation.z = hands.hour;
    settingSpin.rotation.z = ((hands.minute / 3) * MOTION.minuteWheel) / MOTION.settingPinion;

    hourHand.rotation.z = hands.hour;
    minuteHand.rotation.z = hands.minute;
    secondHand.rotation.z = hands.second;

    const pulled = view.crownOut * CROWN_PULL;
    stemSlide.position.x = pulled;
    slidingSlide.position.x = pulled;
    stemSpin.rotation.x = pose.crown;
    slidingSpin.rotation.z = pose.crown;
    // The winding pinion only turns when the sliding pinion is coupled to it. Pull the
    // crown and it sits there while the crown spins, which is the whole point of it.
    if (view.crownOut < 0.5) windingSpin.rotation.z = pose.crown;

    // Exploding is two independent moves. Lifting pulls each part off the plate along the
    // axis it was assembled on, which is the order a watchmaker takes it apart in and the
    // only way to see that the barrel, the ratchet wheel and the crown wheel are three
    // separate things stacked in a millimetre and a half. Spreading dilates the plan, which
    // is the only way to see anything at all from straight in front, where lifting is
    // invisible because it is all happening along the line of sight.
    const push = view.spread * SPREAD;
    for (const owner of parts.values()) {
      owner.holder.position.set(owner.home.x * push, owner.home.y * push, view.exploded * owner.level * LIFT);
      for (const loose of owner.scattered) {
        loose.object.position.set(loose.home.x * (1 + push), loose.home.y * (1 + push), loose.home.z);
      }
    }

    // The plan gets half as wide again at full spread, so the camera has to back off by
    // the same factor or the watch simply leaves the frame. Scaling the distance to the
    // orbit target rather than assigning a position keeps whatever angle the viewer had
    // chosen, and works just as well when they have flown in on a single part.
    if (view.spread !== framedFor) {
      // Backing off by the full dilation leaves the watch looking smaller than it started,
      // because the plate it is spreading over does not grow with it. Three quarters of it
      // keeps everything in frame and still fills it.
      const scale = (1 + view.spread * SPREAD * 0.75) / (1 + framedFor * SPREAD * 0.75);
      camera.position.sub(controls.target).multiplyScalar(scale).add(controls.target);
      // And the target follows the parts. The plan is dilated about the middle of the
      // watch, but the parts are not evenly distributed about the middle of the watch —
      // most of them are off towards the barrel — so the whole arrangement walks sideways
      // as it opens out and has to be followed or it leaves the frame.
      const walk = (view.spread - framedFor) * SPREAD;
      controls.target.x += crowd.x * walk;
      controls.target.y += crowd.y * walk;
      camera.position.x += crowd.x * walk;
      camera.position.y += crowd.y * walk;
      framedFor = view.spread;
    }

    dress(view);
    controls.update();
    renderer.render(scene, camera);
  }

  /** Fading and highlighting, applied only where something has actually changed. */
  function dress(view: View): void {
    for (const owner of parts.values()) {
      const want = view.opacity[owner.id] ?? 1;
      const chosen = view.selected === owner.id;
      if (want === owner.opacity && chosen === owner.chosen) continue;
      owner.opacity = want;
      owner.chosen = chosen;
      for (const material of owner.materials) {
        material.opacity = want;
        material.transparent = want < 1;
        // A see-through part must not write depth, or everything behind it is discarded
        // before it is ever drawn.
        material.depthWrite = want >= 1;
        material.emissive.setHex(chosen ? 0x2f5286 : 0x000000);
        // Enough to find the part in a crowded frame, not so much that it goes pale and
        // loses the shape you selected it to look at.
        material.emissiveIntensity = chosen ? 0.32 : 0;
        material.needsUpdate = true;
      }
      owner.holder.visible = want > 0.015;
      // Anything see-through has to be drawn after everything solid, or it blends against
      // whatever happened to have been drawn before it rather than what is behind it.
      for (const mesh of owner.meshes) mesh.renderOrder = want < 1 ? 2 : 0;
    }
  }

  function cast(clientX: number, clientY: number): THREE.Intersection | null {
    const box = canvas.getBoundingClientRect();
    pointer.x = ((clientX - box.left) / box.width) * 2 - 1;
    pointer.y = -((clientY - box.top) / box.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    for (const hit of raycaster.intersectObject(root, true)) {
      if (hit.object.visible && hit.object.userData.partId) return hit;
    }
    return null;
  }

  camera.position.set(...VIEWPOINTS.movement.at);
  controls.target.set(...VIEWPOINTS.movement.target);
  controls.update();

  return {
    draw,
    pick(clientX, clientY) {
      return (cast(clientX, clientY)?.object.userData.partId as string) ?? null;
    },
    onCrown(clientX, clientY) {
      const box = canvas.getBoundingClientRect();
      pointer.x = ((clientX - box.left) / box.width) * 2 - 1;
      pointer.y = -((clientY - box.top) / box.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObject(crownMesh, false).length > 0;
    },
    setOrbit(enabled) {
      controls.enabled = enabled;
    },
    look(where) {
      const spot = VIEWPOINTS[where];
      camera.position.set(...spot.at);
      controls.target.set(...spot.target);
      controls.update();
      framedFor = 0;
    },
    study(id) {
      const owner = parts.get(id);
      if (!owner) return;
      // The hairspring and the mainspring have their vertices rewritten every frame and
      // never update their own bounds, so the box has to be measured rather than trusted.
      for (const mesh of owner.meshes) mesh.geometry.computeBoundingBox();
      const box = new THREE.Box3().setFromObject(owner.holder);
      if (box.isEmpty()) return;

      const middle = box.getCenter(new THREE.Vector3());
      const reach = box.getBoundingSphere(new THREE.Sphere()).radius;
      // Far enough back that the part's bounding sphere subtends most of the frame, with a
      // little margin so it is not touching the edges.
      const away = (Math.max(reach, 0.45) / Math.tan((camera.fov * Math.PI) / 360)) * 1.45;

      const back = camera.position.clone().sub(controls.target);
      if (back.lengthSq() < 1e-6) back.set(0.1, -0.25, 1);
      controls.target.copy(middle);
      camera.position.copy(middle).addScaledVector(back.normalize(), away);
      controls.update();
    },
    resize() {
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    setBackground(colour) {
      (scene.background as THREE.Color).set(colour);
    },
    dispose() {
      controls.dispose();
      root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
      environment.texture.dispose();
      renderer.dispose();
    },
  };
}
