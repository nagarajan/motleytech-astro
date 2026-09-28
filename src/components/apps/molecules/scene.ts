import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { element, shellOf } from './elements';
import { extent, type Vec3 } from './geometry';
import { chargeAt, type Molecule } from './model';

/** Covalent bonds are drawn in steel, ionic ones in a warm amber. */
export const BOND_COLOURS = { covalent: '#b9c2d0', ionic: '#f59f0a' } as const;

/** Lone pairs get a colour of their own, deliberately unlike any element's. */
export const PAIR_COLOUR = '#7dd3fc';

const NUCLEUS_FLOOR = 0.22;
const NUCLEUS_SHARE = 0.38;
const BOND_RADIUS = 0.12;
const SELECTED = '#ffffff';

export interface SceneOptions {
  /** The transparent shell as a fraction of the van der Waals radius. */
  shell: number;
  showShells: boolean;
  showPairs: boolean;
  selected: number | null;
  /** Atoms to mark as candidates while a bond is being drawn. */
  pending: number | null;
}

/**
 * How a bond of each order is drawn: how many parallel cylinders, how thick each is as a
 * fraction of a single bond, and how far apart they sit.
 *
 * An aromatic bond gets two strands of unequal thickness, which is the three-dimensional
 * version of the one-solid-one-dashed convention: it has to be tellable from a double bond
 * at a glance, and in benzene the two are side by side in the same ring.
 */
const STRANDS: Record<number, { widths: number[]; spacing: number }> = {
  1: { widths: [1], spacing: 0 },
  1.5: { widths: [0.62, 0.34], spacing: 1.9 },
  2: { widths: [0.6, 0.6], spacing: 1.9 },
  3: { widths: [0.48, 0.48, 0.48], spacing: 1.55 },
};

/**
 * A shell that looks like a shell.
 *
 * Plain transparency gives a flat wash you cannot read the curvature of. Weighting the
 * opacity by how steeply the surface turns away from the camera puts a bright rim around
 * the edge and leaves the middle nearly clear, which is what makes the thing read as a
 * sphere while still letting the nucleus and the bonds show through it. Depth writing is
 * off so overlapping shells blend instead of clipping each other, and both faces are
 * drawn so you see the far side of the bubble too.
 *
 * The numbers matter more than they look. A first attempt at 0.16 in the middle and a
 * gentle falloff turned a benzene ring into a uniform grey smudge: with twelve shells
 * overlapping, even a faint interior stacks up into fog, and mixing the rim too far
 * towards white threw away the one thing the colour was carrying. So the interior is now
 * nearly clear, the rim is tight and bright, and the tint survives it.
 */
function shellMaterial(colour: THREE.ColorRepresentation): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      tint: { value: new THREE.Color(colour) },
      core: { value: 0.06 },
      rim: { value: 0.85 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 eye = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-eye.xyz);
        gl_Position = projectionMatrix * eye;
      }
    `,
    fragmentShader: `
      uniform vec3 tint;
      uniform float core;
      uniform float rim;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        float edge = pow(1.0 - facing, 3.5);
        float alpha = core + rim * edge;
        // Brighten towards the rim, but only enough to read as glass: the tint is what
        // tells you which element this is.
        vec3 shade = tint * (0.85 + 0.9 * edge);
        gl_FragColor = vec4(shade, alpha);
      }
    `,
  });
}

interface AtomParts {
  nucleus: THREE.Mesh;
  shell: THREE.Mesh;
  halo: THREE.Mesh;
}

export interface Viewer {
  draw(molecule: Molecule, options: SceneOptions): void;
  /** The atom under the pointer, in client coordinates, or null. */
  pick(clientX: number, clientY: number): number | null;
  frame(): void;
  resize(): void;
  setBackground(colour: string): void;
  dispose(): void;
}

export function createViewer(canvas: HTMLCanvasElement, background: string): Viewer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
  camera.position.set(0, 0, 12);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2;
  controls.maxDistance = 90;
  // Panning a molecule off the edge of its own viewport is never what anyone wanted.
  controls.enablePan = false;

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(4, 6, 8);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x93b7ff, 0.5);
  fill.position.set(-6, -3, -5);
  scene.add(fill);

  // One geometry each, reused for every atom and bond, scaled per instance.
  const ballGeometry = new THREE.SphereGeometry(1, 32, 24);
  const shellGeometry = new THREE.SphereGeometry(1, 48, 32);
  const stickGeometry = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);

  const atoms = new Map<number, AtomParts>();
  const bonds = new Map<number, THREE.Mesh[]>();
  const lobes = new Map<string, THREE.Mesh>();
  const nuclei: THREE.Mesh[] = [];
  const shells: THREE.Mesh[] = [];

  const group = new THREE.Group();
  scene.add(group);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  let spinning = true;
  let disposed = false;

  function atomParts(id: number, colour: string): AtomParts {
    const found = atoms.get(id);
    if (found) return found;

    const nucleus = new THREE.Mesh(
      ballGeometry,
      // A little self-lit, so a nucleus on the dark side of the molecule is still findable.
      new THREE.MeshStandardMaterial({
        color: colour,
        roughness: 0.3,
        metalness: 0.1,
        emissive: new THREE.Color(colour),
        emissiveIntensity: 0.22,
      }),
    );
    const shell = new THREE.Mesh(shellGeometry, shellMaterial(colour));
    // Shells must be drawn after everything solid for the blending to be right.
    shell.renderOrder = 2;
    // A glow rather than a wireframe: at this size a wireframe sphere reads as static.
    const halo = new THREE.Mesh(
      ballGeometry,
      new THREE.MeshBasicMaterial({
        color: SELECTED,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    halo.renderOrder = 3;
    halo.visible = false;

    nucleus.userData.atomId = id;
    shell.userData.atomId = id;

    const parts = { nucleus, shell, halo };
    atoms.set(id, parts);
    group.add(nucleus, shell, halo);
    nuclei.push(nucleus);
    shells.push(shell);
    return parts;
  }

  function forget(id: number): void {
    const parts = atoms.get(id);
    if (!parts) return;
    for (const mesh of [parts.nucleus, parts.shell, parts.halo]) {
      group.remove(mesh);
      (mesh.material as THREE.Material).dispose();
      const slot = mesh === parts.nucleus ? nuclei : mesh === parts.shell ? shells : null;
      if (slot) slot.splice(slot.indexOf(mesh), 1);
    }
    atoms.delete(id);
  }

  function place(mesh: THREE.Mesh, at: Vec3): void {
    mesh.position.set(at.x, at.y, at.z);
  }

  /** A unit cylinder runs up the y axis, so aim it by rotating y onto the bond. */
  function aim(mesh: THREE.Mesh, from: Vec3, to: Vec3, radius: number): void {
    const start = new THREE.Vector3(from.x, from.y, from.z);
    const end = new THREE.Vector3(to.x, to.y, to.z);
    const along = end.clone().sub(start);
    const span = along.length();
    mesh.position.copy(start).addScaledVector(along, 0.5);
    mesh.scale.set(radius, span || 1e-6, radius);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.clone().normalize());
  }

  function draw(molecule: Molecule, options: SceneOptions): void {
    const live = new Set(molecule.atoms.map((atom) => atom.id));
    for (const id of [...atoms.keys()]) if (!live.has(id)) forget(id);

    const shellRadii: number[] = [];
    const sizes = new Map<number, { nucleus: number; shell: number }>();
    for (const atom of molecule.atoms) {
      const info = element(atom.symbol);
      const parts = atomParts(atom.id, info.colour);

      // Reusing a mesh across a symbol change means the colour has to be reapplied.
      const skin = parts.nucleus.material as THREE.MeshStandardMaterial;
      skin.color.set(info.colour);
      skin.emissive.set(info.colour);
      (parts.shell.material as THREE.ShaderMaterial).uniforms.tint.value.set(info.colour);

      const nucleusRadius = Math.max(NUCLEUS_FLOOR, info.covalent * NUCLEUS_SHARE);
      // An ion is a different size from the atom it came from, sometimes dramatically so, and
      // the shell is the one part of the picture that can show it.
      const shellRadius = shellOf(atom.symbol, chargeAt(molecule, atom.id)) * options.shell;
      shellRadii.push(options.showShells ? shellRadius : nucleusRadius);
      sizes.set(atom.id, { nucleus: nucleusRadius, shell: shellRadius });

      place(parts.nucleus, atom.position);
      parts.nucleus.scale.setScalar(nucleusRadius);

      place(parts.shell, atom.position);
      parts.shell.scale.setScalar(shellRadius);
      parts.shell.visible = options.showShells;

      place(parts.halo, atom.position);
      parts.halo.scale.setScalar(nucleusRadius * 1.55);
      const chosen = atom.id === options.selected;
      const candidate = atom.id === options.pending;
      parts.halo.visible = chosen || candidate;
      (parts.halo.material as THREE.MeshBasicMaterial).color.set(candidate ? BOND_COLOURS.ionic : SELECTED);
    }

    const where = new Map(molecule.atoms.map((atom) => [atom.id, atom.position]));

    const liveBonds = new Set(molecule.bonds.map((bond) => bond.id));
    for (const [id, strands] of [...bonds.entries()]) {
      if (liveBonds.has(id) && strands.length === strandCount(molecule, id)) continue;
      for (const mesh of strands) {
        group.remove(mesh);
        (mesh.material as THREE.Material).dispose();
      }
      bonds.delete(id);
    }

    for (const bond of molecule.bonds) {
      const from = where.get(bond.a);
      const to = where.get(bond.b);
      if (!from || !to) continue;

      const { widths, spacing } = STRANDS[bond.order] ?? STRANDS[1];
      let strands = bonds.get(bond.id);
      if (!strands) {
        strands = widths.map(() => {
          const mesh = new THREE.Mesh(
            stickGeometry,
            new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.4 }),
          );
          group.add(mesh);
          return mesh;
        });
        bonds.set(bond.id, strands);
      }

      // Ionic bonds are drawn a little thinner as well as a different colour, so the two
      // kinds stay apart for anyone who cannot rely on the colour alone.
      const thickness = bond.kind === 'ionic' ? BOND_RADIUS * 0.7 : BOND_RADIUS;
      const sideways = spacing === 0 ? null : offsetAxis(molecule, bond, from, to, where);

      strands.forEach((mesh, index) => {
        (mesh.material as THREE.MeshStandardMaterial).color.set(BOND_COLOURS[bond.kind]);
        const step = index - (widths.length - 1) / 2;
        const shift =
          sideways === null
            ? new THREE.Vector3()
            : sideways.clone().multiplyScalar(step * spacing * thickness);
        aim(
          mesh,
          { x: from.x + shift.x, y: from.y + shift.y, z: from.z + shift.z },
          { x: to.x + shift.x, y: to.y + shift.y, z: to.z + shift.z },
          thickness * widths[index],
        );
      });
    }

    drawPairs(molecule, options, sizes);
    fit(molecule, shellRadii);
  }

  function strandCount(molecule: Molecule, bondId: number): number {
    const bond = molecule.bonds.find((entry) => entry.id === bondId);
    return bond ? (STRANDS[bond.order] ?? STRANDS[1]).widths.length : 0;
  }

  /**
   * Which way to offset the extra strands of a multiple bond.
   *
   * Perpendicular to the bond, obviously, but that leaves a whole circle to choose from, and
   * the choice shows: in benzene the second strands have to lie in the ring plane or the
   * ring looks like a mess of crossed sticks. So aim away from whatever else is attached to
   * either end, which in a flat ring is the ring plane and in a chain is the chain. With
   * nothing else attached — carbon dioxide, ethyne — any perpendicular will do, so take a
   * fixed one and let the molecule spin.
   */
  function offsetAxis(
    molecule: Molecule,
    bond: Molecule['bonds'][number],
    from: Vec3,
    to: Vec3,
    where: Map<number, Vec3>,
  ): THREE.Vector3 {
    const axis = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z).normalize();
    const middle = new THREE.Vector3((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);

    const lean = new THREE.Vector3();
    for (const other of molecule.bonds) {
      if (other.id === bond.id) continue;
      for (const [near, far] of [[other.a, other.b], [other.b, other.a]] as const) {
        if (near !== bond.a && near !== bond.b) continue;
        const at = where.get(far);
        if (!at) continue;
        lean.add(new THREE.Vector3(at.x, at.y, at.z).sub(middle));
      }
    }

    // Strip out the part along the bond; what is left is the direction to offset along.
    lean.addScaledVector(axis, -lean.dot(axis));
    if (lean.lengthSq() > 1e-6) return lean.normalize();

    const fallback = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    return fallback.addScaledVector(axis, -fallback.dot(axis)).normalize();
  }

  /**
   * The lone pairs, as stubby lobes poking out of their atom. Additive and depth-write-free
   * so they glow through the shell rather than punching a hole in it.
   *
   * Drawn further out than the relaxation puts them, and deliberately. Only the *direction*
   * of a lone pair is a result here: how far out it sits is a number picked by hand, and the
   * repulsion is measured on the unit sphere so it makes no difference to any angle. At its
   * physical distance the lobe is buried inside its own atom's shell and invisible, so it is
   * drawn out at the shell surface instead, where it can be seen and pointed at.
   */
  function drawPairs(
    molecule: Molecule,
    options: SceneOptions,
    sizes: Map<number, { nucleus: number; shell: number }>,
  ): void {
    const live = new Set(molecule.lonePairs.map((pair) => `${pair.atom}:${pair.index}`));
    for (const [key, mesh] of [...lobes.entries()]) {
      if (live.has(key)) continue;
      group.remove(mesh);
      (mesh.material as THREE.Material).dispose();
      lobes.delete(key);
    }

    const where = new Map(molecule.atoms.map((atom) => [atom.id, atom.position]));
    for (const pair of molecule.lonePairs) {
      const home = where.get(pair.atom);
      if (!home) continue;
      const key = `${pair.atom}:${pair.index}`;

      let mesh = lobes.get(key);
      if (!mesh) {
        mesh = new THREE.Mesh(
          ballGeometry,
          new THREE.MeshBasicMaterial({
            color: PAIR_COLOUR,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        mesh.renderOrder = 1;
        group.add(mesh);
        lobes.set(key, mesh);
      }
      mesh.visible = options.showPairs;

      const out = new THREE.Vector3(
        pair.position.x - home.x,
        pair.position.y - home.y,
        pair.position.z - home.z,
      );
      const span = out.length() || 1e-6;
      const aimed = out.divideScalar(span);

      const size = sizes.get(pair.atom) ?? { nucleus: NUCLEUS_FLOOR, shell: NUCLEUS_FLOOR };
      const far = options.showShells
        ? Math.max(size.shell * 0.88, size.nucleus * 2.4)
        : size.nucleus * 2.6;

      // A pair that had no say in the shape is drawn smaller and fainter. On a molecule like
      // xenon tetrafluoride the fluorines carry twelve of them between them, and at full
      // strength they bury the two on the xenon that are actually doing the work.
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.opacity = pair.shaping ? 0.6 : 0.26;
      const bulk = size.nucleus * (pair.shaping ? 1 : 0.62);

      mesh.position.set(home.x, home.y, home.z).addScaledVector(aimed, far);
      // Stretched along the way it points, so it reads as a lobe rather than a stray atom.
      mesh.scale.set(bulk * 0.78, bulk * 1.2, bulk * 0.78);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), aimed);
    }
  }

  let framed = 0;

  /**
   * Pull the camera back just far enough to hold the molecule, and only when it has grown,
   * so that a zoom someone has chosen by hand survives the next edit.
   *
   * The distance is the one that puts a sphere of radius `reach` exactly inside the frustum:
   * reach / sin(half-angle). Whichever of the two half-angles is smaller does the
   * constraining, which on a wide canvas is the vertical one and on a phone is not.
   */
  function fit(molecule: Molecule, shellRadii: number[]): void {
    if (molecule.atoms.length === 0) return;
    const reach = extent(
      molecule.atoms.map((atom) => ({ position: atom.position, covalent: 0 })),
      shellRadii,
    );
    const half = (camera.fov * Math.PI) / 360;
    const sideways = Math.atan(Math.tan(half) * camera.aspect);
    const tightest = Math.min(half, sideways);
    const wanted = Math.max(3.4, (reach * 1.12) / Math.sin(tightest));
    if (wanted > framed * 1.001 || framed === 0) {
      framed = wanted;
      const direction = camera.position.clone().normalize();
      camera.position.copy(direction.multiplyScalar(wanted));
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }

  function frame(): void {
    framed = 0;
  }

  function pick(clientX: number, clientY: number): number | null {
    const box = canvas.getBoundingClientRect();
    pointer.x = ((clientX - box.left) / box.width) * 2 - 1;
    pointer.y = -((clientY - box.top) / box.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    // Nuclei first: they are small, but if someone aims at one they mean it. Shells are a
    // much easier target and act as the fallback.
    for (const targets of [nuclei, shells]) {
      const hit = raycaster.intersectObjects(targets, false)[0];
      if (hit) return (hit.object.userData.atomId as number) ?? null;
    }
    return null;
  }

  function resize(): void {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function loop(): void {
    if (disposed) return;
    requestAnimationFrame(loop);
    if (spinning) controls.update();
    renderer.render(scene, camera);
  }

  function setBackground(colour: string): void {
    (scene.background as THREE.Color).set(colour);
  }

  function dispose(): void {
    disposed = true;
    spinning = false;
    controls.dispose();
    for (const id of [...atoms.keys()]) forget(id);
    for (const strands of bonds.values()) {
      for (const mesh of strands) (mesh.material as THREE.Material).dispose();
    }
    bonds.clear();
    for (const mesh of lobes.values()) (mesh.material as THREE.Material).dispose();
    lobes.clear();
    ballGeometry.dispose();
    shellGeometry.dispose();
    stickGeometry.dispose();
    renderer.dispose();
  }

  resize();
  loop();

  return { draw, pick, frame, resize, setBackground, dispose };
}
