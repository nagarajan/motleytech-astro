import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { faceOrder, type Vec3 } from './geometry';
import { chargeOf, DRAW_FLOOR, DRAW_SCALE, kindOf, type Shape } from './model';

/**
 * Faces are tinted by how many sides they have, rather than by anything arbitrary. On a
 * solid with one kind of face this is a single colour and reads as one surface; on a
 * cuboctahedron or a football the two kinds of panel separate at a glance, which is the
 * thing worth seeing about those shapes.
 */
const FACE_COLOURS: Record<number, string> = {
  3: '#4ade80',
  4: '#60a5fa',
  5: '#fbbf24',
  6: '#f472b6',
};
const FACE_OTHER = '#a78bfa';

export function faceTint(sides: number): string {
  return FACE_COLOURS[sides] ?? FACE_OTHER;
}

const EDGE_COLOUR = '#94a3b8';
const SELECTED = '#ffffff';
const PINNED = '#f87171';
const EDGE_RADIUS = 0.035;

export interface SceneOptions {
  showEdges: boolean;
  showFaces: boolean;
  showVertices: boolean;
  /** Face opacity, 0 to 1. */
  opacity: number;
  selected: number[];
  /** Highlighted as the other end of an edge about to be made. */
  pending: number | null;
}

export type Hit = { kind: 'vertex'; id: number } | { kind: 'edge'; id: number } | { kind: 'face'; id: number };

export interface Viewer {
  draw(shape: Shape, options: SceneOptions): void;
  pick(clientX: number, clientY: number): Hit | null;
  /** Where a vertex would move to if dragged to this point, in the plane facing the camera. */
  dragTo(clientX: number, clientY: number, through: Vec3): Vec3 | null;
  /** Stop the orbit controls fighting a vertex drag. */
  setOrbiting(on: boolean): void;
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

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 800);
  camera.position.set(0, 0, 14);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.5;
  controls.maxDistance = 200;
  controls.enablePan = false;

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(4, 6, 8);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x93b7ff, 0.5);
  fill.position.set(-6, -3, -5);
  scene.add(fill);

  const ballGeometry = new THREE.SphereGeometry(1, 24, 18);
  const stickGeometry = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);

  const group = new THREE.Group();
  scene.add(group);

  const vertexMeshes = new Map<number, { ball: THREE.Mesh; halo: THREE.Mesh }>();
  const edgeMeshes = new Map<number, THREE.Mesh>();
  const faceMeshes = new Map<number, THREE.Mesh>();
  const balls: THREE.Mesh[] = [];
  const sticks: THREE.Mesh[] = [];
  const sheets: THREE.Mesh[] = [];

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  let disposed = false;

  /**
   * Faces are drawn from both sides with depth writing off, so that the far side of a
   * solid shows through the near one and two overlapping faces blend rather than one
   * winning outright. Flat shading because a face here really is flat and pretending
   * otherwise would round off the creases that make a polyhedron legible.
   */
  function faceMaterial(colour: string, opacity: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: colour,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      flatShading: true,
      roughness: 0.55,
      metalness: 0.05,
    });
  }

  function vertexParts(id: number, colour: string): { ball: THREE.Mesh; halo: THREE.Mesh } {
    const found = vertexMeshes.get(id);
    if (found) return found;

    const ball = new THREE.Mesh(
      ballGeometry,
      new THREE.MeshStandardMaterial({
        color: colour,
        roughness: 0.28,
        metalness: 0.15,
        emissive: new THREE.Color(colour),
        emissiveIntensity: 0.25,
      }),
    );
    ball.userData.pick = { kind: 'vertex', id };
    ball.renderOrder = 4;

    const halo = new THREE.Mesh(
      ballGeometry,
      new THREE.MeshBasicMaterial({
        color: SELECTED,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    halo.renderOrder = 5;
    halo.visible = false;

    const parts = { ball, halo };
    vertexMeshes.set(id, parts);
    group.add(ball, halo);
    balls.push(ball);
    return parts;
  }

  function drop(mesh: THREE.Mesh, pool: THREE.Mesh[] | null): void {
    group.remove(mesh);
    (mesh.material as THREE.Material).dispose();
    if (mesh.geometry !== ballGeometry && mesh.geometry !== stickGeometry) mesh.geometry.dispose();
    if (pool) {
      const slot = pool.indexOf(mesh);
      if (slot >= 0) pool.splice(slot, 1);
    }
  }

  function place(mesh: THREE.Mesh, at: Vec3): void {
    mesh.position.set(at.x, at.y, at.z);
  }

  /** A unit cylinder runs up the y axis, so aim it by rotating y onto the edge. */
  function aim(mesh: THREE.Mesh, from: Vec3, to: Vec3, radius: number): void {
    const start = new THREE.Vector3(from.x, from.y, from.z);
    const along = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
    const span = along.length();
    mesh.position.copy(start).addScaledVector(along, 0.5);
    mesh.scale.set(radius, span || 1e-6, radius);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.clone().normalize());
  }

  function draw(shape: Shape, options: SceneOptions): void {
    const where = new Map(shape.vertices.map((vertex) => [vertex.id, vertex.position]));
    const chosen = new Set(options.selected);

    // --- vertices
    const liveVertices = new Set(shape.vertices.map((vertex) => vertex.id));
    for (const [id, parts] of [...vertexMeshes.entries()]) {
      if (liveVertices.has(id)) continue;
      drop(parts.ball, balls);
      drop(parts.halo, null);
      vertexMeshes.delete(id);
    }

    const radii = new Map<number, number>();
    for (const vertex of shape.vertices) {
      const kind = kindOf(shape, vertex);
      const parts = vertexParts(vertex.id, kind.colour);
      const skin = parts.ball.material as THREE.MeshStandardMaterial;
      skin.color.set(kind.colour);
      skin.emissive.set(kind.colour);

      const size = Math.max(DRAW_FLOOR, chargeOf(shape, vertex) * DRAW_SCALE);
      radii.set(vertex.id, size);

      place(parts.ball, vertex.position);
      parts.ball.scale.setScalar(size);
      parts.ball.visible = options.showVertices;

      place(parts.halo, vertex.position);
      parts.halo.scale.setScalar(size * 1.7);
      const marked = chosen.has(vertex.id);
      parts.halo.visible = options.showVertices && (marked || vertex.id === options.pending || Boolean(vertex.pinned));
      (parts.halo.material as THREE.MeshBasicMaterial).color.set(
        vertex.id === options.pending ? '#f59f0a' : vertex.pinned && !marked ? PINNED : SELECTED,
      );
    }

    // --- edges
    const liveEdges = new Set(shape.edges.map((edge) => edge.id));
    for (const [id, mesh] of [...edgeMeshes.entries()]) {
      if (liveEdges.has(id)) continue;
      drop(mesh, sticks);
      edgeMeshes.delete(id);
    }

    for (const edge of shape.edges) {
      const from = where.get(edge.a);
      const to = where.get(edge.b);
      if (!from || !to) continue;
      let mesh = edgeMeshes.get(edge.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          stickGeometry,
          new THREE.MeshStandardMaterial({ color: EDGE_COLOUR, roughness: 0.4, metalness: 0.35 }),
        );
        mesh.userData.pick = { kind: 'edge', id: edge.id };
        mesh.renderOrder = 3;
        group.add(mesh);
        edgeMeshes.set(edge.id, mesh);
        sticks.push(mesh);
      }
      const lit = chosen.has(edge.a) && chosen.has(edge.b);
      (mesh.material as THREE.MeshStandardMaterial).color.set(lit ? SELECTED : EDGE_COLOUR);
      aim(mesh, from, to, EDGE_RADIUS * (lit ? 1.5 : 1));
      mesh.visible = options.showEdges;
    }

    // --- faces
    const liveFaces = new Set(shape.faces.map((face) => face.id));
    for (const [id, mesh] of [...faceMeshes.entries()]) {
      if (liveFaces.has(id)) continue;
      drop(mesh, sheets);
      faceMeshes.delete(id);
    }

    for (const face of shape.faces) {
      const points = face.vertices.map((id) => where.get(id)).filter((point): point is Vec3 => Boolean(point));
      if (points.length < 3) continue;

      const tint = faceTint(points.length);
      let mesh = faceMeshes.get(face.id);
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.BufferGeometry(), faceMaterial(tint, options.opacity));
        mesh.userData.pick = { kind: 'face', id: face.id };
        mesh.renderOrder = 1;
        group.add(mesh);
        faceMeshes.set(face.id, mesh);
        sheets.push(mesh);
      }
      const material = mesh.material as THREE.MeshStandardMaterial;
      const lit = face.vertices.every((id) => chosen.has(id)) && chosen.size === face.vertices.length;
      material.opacity = Math.min(0.95, options.opacity * (lit ? 2.2 : 1));
      material.color.set(lit ? SELECTED : tint);
      fanGeometry(mesh.geometry as THREE.BufferGeometry, points);
      mesh.visible = options.showFaces;
    }

    fit(shape, radii);
  }

  /**
   * A face as a triangle fan from its own middle.
   *
   * Fanning from the centroid rather than from a corner is what lets faces be stored as
   * unordered sets of vertices: the rim order is recovered here from the geometry, and a
   * face made by clicking four vertices in any order comes out the same. It also keeps
   * every triangle of a regular polygon the same size, which matters once the thing is
   * translucent and overlapping triangles would otherwise show as banding.
   */
  function fanGeometry(geometry: THREE.BufferGeometry, points: Vec3[]): void {
    const order = faceOrder(points);
    const middle = points.reduce(
      (sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length, z: sum.z + point.z / points.length }),
      { x: 0, y: 0, z: 0 },
    );

    const vertices = new Float32Array(order.length * 3 * 3);
    for (let i = 0; i < order.length; i += 1) {
      const a = points[order[i]];
      const b = points[order[(i + 1) % order.length]];
      vertices.set([middle.x, middle.y, middle.z, a.x, a.y, a.z, b.x, b.y, b.z], i * 9);
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }

  let framed = 0;

  function fit(shape: Shape, radii: Map<number, number>): void {
    if (shape.vertices.length === 0) return;
    let reach = 0;
    for (const vertex of shape.vertices) {
      const away = Math.hypot(vertex.position.x, vertex.position.y, vertex.position.z);
      reach = Math.max(reach, away + (radii.get(vertex.id) ?? 0));
    }
    const half = (camera.fov * Math.PI) / 360;
    const sideways = Math.atan(Math.tan(half) * camera.aspect);
    const wanted = Math.max(2.5, (reach * 1.05) / Math.sin(Math.min(half, sideways)));
    // Only ever pull back, so a zoom someone chose by hand survives the next edit.
    if (wanted > framed * 1.001 || framed === 0) {
      framed = wanted;
      camera.position.copy(camera.position.clone().normalize().multiplyScalar(wanted));
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }

  function frame(): void {
    framed = 0;
  }

  function aimRay(clientX: number, clientY: number): void {
    const box = canvas.getBoundingClientRect();
    pointer.x = ((clientX - box.left) / box.width) * 2 - 1;
    pointer.y = -((clientY - box.top) / box.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }

  /**
   * What is under the pointer. Vertices win over edges and edges over faces regardless of
   * depth, because a vertex is a small target in front of a large one and anybody aiming
   * at it means it.
   */
  function pick(clientX: number, clientY: number): Hit | null {
    aimRay(clientX, clientY);
    for (const pool of [balls, sticks, sheets]) {
      const visible = pool.filter((mesh) => mesh.visible);
      const hit = raycaster.intersectObjects(visible, false)[0];
      if (hit) return (hit.object.userData.pick as Hit) ?? null;
    }
    return null;
  }

  function dragTo(clientX: number, clientY: number, through: Vec3): Vec3 | null {
    aimRay(clientX, clientY);
    // The plane the vertex is already on, square to the camera: dragging then moves it
    // exactly as far as the pointer went, with no surprise motion in depth.
    const normal = camera.getWorldDirection(new THREE.Vector3()).negate();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal,
      new THREE.Vector3(through.x, through.y, through.z),
    );
    const landed = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    return landed ? { x: landed.x, y: landed.y, z: landed.z } : null;
  }

  function setOrbiting(on: boolean): void {
    controls.enabled = on;
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
    controls.update();
    renderer.render(scene, camera);
  }

  function setBackground(colour: string): void {
    (scene.background as THREE.Color).set(colour);
  }

  function dispose(): void {
    disposed = true;
    controls.dispose();
    for (const parts of vertexMeshes.values()) {
      drop(parts.ball, null);
      drop(parts.halo, null);
    }
    for (const mesh of edgeMeshes.values()) drop(mesh, null);
    for (const mesh of faceMeshes.values()) drop(mesh, null);
    vertexMeshes.clear();
    edgeMeshes.clear();
    faceMeshes.clear();
    balls.length = 0;
    sticks.length = 0;
    sheets.length = 0;
    ballGeometry.dispose();
    stickGeometry.dispose();
    renderer.dispose();
  }

  resize();
  loop();

  return { draw, pick, dragTo, setOrbiting, frame, resize, setBackground, dispose };
}
