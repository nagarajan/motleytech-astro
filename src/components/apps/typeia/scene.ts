/**
 * The star, drawn as a half.
 *
 * Two surfaces. A flat disc in the plane z = 0 is the cut face, where the inside is on
 * show; the hemisphere behind it is the star's actual outside. Together they read as a
 * sphere with a quarter taken out, which is the only way to look inside a star and still
 * have it look like a star.
 *
 * Neither surface is built from the model's cells. Both are plain geometry and all the
 * structure is painted on in a fragment shader from a two-dimensional texture of the
 * current instant — radius across, angle down. That keeps the burning front sharp at any
 * zoom, which a mesh rebuilt from a hundred and sixty shells would not.
 *
 * The radial axis is linear. That is worth saying explicitly because the core-collapse
 * demo in the next folder is logarithmic and had to be: it spans eight decades of radius
 * and a linear axis fine enough to show the neutron star would need a hundred million
 * samples to reach the surface. This explosion spans a factor of thirty, so it fits, and
 * a star on a linear axis looks like a star instead of like a dartboard.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  A_SAMPLES,
  R_SAMPLES,
  type ColourMode,
  type Field,
  type LayerMode,
  fillField,
  makeField,
} from './colour';
import type { BurnMap, Snapshot } from './model';
import { createSky, type Sky } from '../sky';

export type Viewpoint = 'face' | 'angle' | 'edge' | 'behind';

export interface View {
  mode: ColourMode;
  layers: LayerMode;
  /** Blend from a clean front to a churned one, 0 to 1. */
  turbulence: number;
  /** Extra zoom on top of the automatic fit. */
  zoom: number;
  /** Draw the burning front as a bright line. */
  markers: boolean;
}

export interface Viewer {
  draw: (map: BurnMap, snap: Snapshot, view: View, seconds: number) => void;
  look: (where: Viewpoint) => void;
  setAutoRotate: (on: boolean) => void;
  resize: () => void;
  dispose: () => void;
}

// ---------------------------------------------------------------- shared shader source

/**
 * The turbulence overlay, and an honest account of what it is.
 *
 * The model underneath is smooth in angle: sixty-four bins, each one a function of radius.
 * The real thing is not remotely smooth. A deflagration in a white dwarf is violently
 * Rayleigh–Taylor unstable — hot ash is lighter than the cold fuel above it, so it rises
 * in plumes that roll over into mushrooms and shred into smaller plumes, and the flame
 * surface ends up fractal. Photographs of the numerical models look like a cauliflower.
 *
 * What follows is *not* that. It is a few octaves of value noise on the sphere, used to
 * displace the radius at which the shader samples the model. Its amplitude and its
 * characteristic scale are chosen to match what published three-dimensional calculations
 * produce, and nothing in the model computed it: turning the slider changes no number
 * anywhere, only how the numbers are drawn. The slider exists so that the smooth, honest,
 * slightly boring answer stays one drag away.
 *
 * It is also gated on the phase, which is the physically interesting part. A deflagration
 * is buoyant and therefore churned; a detonation is a shock wave sweeping through material
 * too fast for buoyancy to do anything at all, and is correspondingly smooth. So the
 * churn is turned up during the first second and down when the detonation takes over,
 * which is not decoration — it is the visible difference between the two kinds of front.
 */
const NOISE = `
  uniform float uChurn;
  uniform float uTime;
  uniform float uFrontFrac;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
  }

  float valueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash(i + vec3(0.0, 0.0, 0.0));
    float n100 = hash(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash(i + vec3(1.0, 1.0, 1.0));
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z
    ) * 2.0 - 1.0;
  }

  /**
   * Four octaves, each half the amplitude and a bit over twice the scale of the last, which
   * is the usual way of faking a turbulent cascade and is not a bad likeness of one: real
   * turbulence really does distribute its energy across scales as a power law.
   */
  float fbm(vec3 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += amp * valueNoise(p);
      p *= 2.17;
      amp *= 0.5;
    }
    return sum;
  }

  /**
   * How much to displace the sampled radius at this point.
   *
   * The displacement is a fraction of the star's radius, so a plume keeps its size
   * relative to the star as the star expands, which is what actually happens: once the
   * ejecta is coasting, the whole thing is a scale model of itself and the plumes grow
   * with it.
   *
   * It is also faded out well behind the front and entirely ahead of it. Material the
   * front has not reached yet has had nothing done to it and is still perfectly smooth, so
   * churning it would be a visible lie about which parts of the star are disturbed.
   */
  float churnAt(vec3 dir, float frac) {
    if (uChurn <= 0.001) return 0.0;
    float ahead = smoothstep(uFrontFrac + 0.05, uFrontFrac - 0.08, frac);
    float deep = smoothstep(0.0, 0.07, frac);
    float shape = fbm(dir * 4.3 + vec3(0.0, 0.0, uTime * 0.25));
    return uChurn * 0.15 * ahead * deep * shape;
  }
`;

const CUT_VERTEX = `
  varying vec2 vPlane;
  void main() {
    vPlane = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * The cut face.
 *
 * A point on the disc names a radius and a direction. The radius, as a fraction of the
 * star's surface, is one texture coordinate; the angle away from the symmetry axis is the
 * other. The symmetry axis is +y — the direction the first spark was offset towards in the
 * delayed detonation, and the point where the helium shell lit in the double — so that the
 * lopsidedness of both scenarios lies in the plane of the cut and is visible without
 * having to orbit.
 */
const CUT_FRAGMENT = `
  uniform sampler2D uField;
  uniform float uMarkers;
  uniform float uFront;
  varying vec2 vPlane;

  ${NOISE}

  void main() {
    float frac = length(vPlane);
    if (frac > 1.0) discard;

    vec3 dir = frac > 1e-5 ? normalize(vec3(vPlane, 0.0)) : vec3(0.0, 1.0, 0.0);
    float sampled = clamp(frac - churnAt(dir, frac), 0.0, 1.0);

    // Angle from the +y axis, zero at the pole and one at the far pole, matching the way
    // the model lays its angular bins out.
    float theta = acos(clamp(dir.y, -1.0, 1.0)) / 3.14159265;

    vec4 gas = texture2D(uField, vec2(sampled, theta));
    if (gas.a < 0.02) discard;
    vec3 colour = gas.rgb;

    if (uMarkers > 0.5 && uFront > 0.0) {
      float edge = smoothstep(0.014, 0.0, abs(sampled - uFront));
      colour = mix(colour, vec3(1.0, 0.97, 0.88), edge * 0.7);
    }

    // The ramps were picked by eye, so they are sRGB values; the renderer encodes to sRGB
    // on the way out, so they are decoded here and the round trip cancels.
    gl_FragColor = vec4(pow(clamp(colour, 0.0, 1.0), vec3(2.2)), 1.0);
  }
`;

/**
 * The outside. Same texture, sampled at the surface, so the shell shows whatever the
 * outermost layer is made of — which for most of the run is unburnt carbon and oxygen and
 * then, in the double detonation, becomes the burning helium skin before anything has
 * happened inside at all.
 */
const SHELL_VERTEX = `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vNormal = normalize(normalMatrix * normal);
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vView = -normalize(view.xyz);
    gl_Position = projectionMatrix * view;
  }
`;

const SHELL_FRAGMENT = `
  uniform sampler2D uField;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vDir;

  ${NOISE}

  void main() {
    float sampled = clamp(1.0 - churnAt(vDir, 1.0) - 0.004, 0.0, 1.0);
    float theta = acos(clamp(vDir.y, -1.0, 1.0)) / 3.14159265;
    vec4 gas = texture2D(uField, vec2(sampled, theta));

    float lambert = 0.38 + 0.62 * max(0.0, dot(vNormal, normalize(vec3(0.5, 0.7, 0.6))));
    float rim = pow(1.0 - max(0.0, dot(vNormal, vView)), 2.5);
    vec3 colour = gas.rgb * lambert + gas.rgb * rim * 0.4;
    gl_FragColor = vec4(pow(clamp(colour, 0.0, 1.0), vec3(2.2)), 1.0);
  }
`;

// ---------------------------------------------------------------- labels

/** A number floating in the scene: pale text with a dark outline, no box behind it. */
function makeLabel(text: string): THREE.Sprite {
  const pad = 10;
  const height = 48;
  const font = '600 30px ui-monospace, SFMono-Regular, Menlo, monospace';
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) return new THREE.Sprite();
  measure.font = font;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(measure.measureText(text).width) + pad * 2;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Sprite();
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(4,6,14,0.85)';
  ctx.strokeText(text, pad, height / 2);
  ctx.fillStyle = 'rgba(214,226,246,0.95)';
  ctx.fillText(text, pad, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
  );
  const tall = 0.058;
  sprite.scale.set((canvas.width / canvas.height) * tall, tall, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function kmLabel(cm: number): string {
  const km = cm / 1e5;
  if (km < 10000) return `${Math.round(km / 100) * 100} km`;
  if (km < 1e6) return `${Math.round(km / 1000)}\u2009000 km`;
  return `${(km / 1e6).toFixed(1)}M km`;
}

// ---------------------------------------------------------------- the viewer

const VIEWPOINTS: Record<Viewpoint, [number, number, number]> = {
  face: [0, 0.16, 3.05],
  angle: [1.85, 1.3, 2.1],
  edge: [3.0, 0.22, 0.35],
  behind: [-1.1, 0.85, -2.7],
};

/** Space is black in both themes, so this is fixed rather than read from the page. */
export const SPACE = '#04060e';

/** The power the star's true radius is raised to before being drawn. See `draw`. */
const SCALE_COMPRESSION = 0.25;

export function createViewer(canvas: HTMLCanvasElement): Viewer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SPACE);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1600);
  camera.position.set(...VIEWPOINTS.face);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.minDistance = 1.15;
  controls.maxDistance = 9;
  controls.autoRotateSpeed = 0.5;
  controls.target.set(0, 0, 0);

  const sky: Sky = createSky();
  scene.add(sky.group);

  const field: Field = makeField();
  const fieldTexture = new THREE.DataTexture(field.pixels, R_SAMPLES, A_SAMPLES, THREE.RGBAFormat);
  fieldTexture.magFilter = THREE.LinearFilter;
  fieldTexture.minFilter = THREE.LinearFilter;
  fieldTexture.wrapS = THREE.ClampToEdgeWrapping;
  fieldTexture.wrapT = THREE.ClampToEdgeWrapping;
  fieldTexture.generateMipmaps = false;
  fieldTexture.needsUpdate = true;

  const shared = {
    uField: { value: fieldTexture },
    uChurn: { value: 0.5 },
    uTime: { value: 0 },
    uFrontFrac: { value: 0 },
  };

  const cutMaterial = new THREE.ShaderMaterial({
    vertexShader: CUT_VERTEX,
    fragmentShader: CUT_FRAGMENT,
    uniforms: { ...shared, uMarkers: { value: 1 }, uFront: { value: 0 } },
    side: THREE.DoubleSide,
  });

  // One quad; everything circular about the cut face happens in the fragment shader, so
  // there is no tessellation to be coarse and no seam at the middle.
  const cut = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), cutMaterial);
  scene.add(cut);

  const shellMaterial = new THREE.ShaderMaterial({
    vertexShader: SHELL_VERTEX,
    fragmentShader: SHELL_FRAGMENT,
    uniforms: { ...shared },
  });
  // phi from pi to 2pi is the half with z <= 0, which is the half behind the cut face.
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 160, 120, Math.PI, Math.PI),
    shellMaterial,
  );
  scene.add(shell);

  // A ring at the star's edge with its radius written on it. The view rescales as the
  // ejecta grows — it has to, or the star would be a dot for the first second and off the
  // edge of the screen for the last — so without a number on it there would be no way to
  // tell that anything was expanding at all.
  const ringGeometry = new THREE.RingGeometry(0.998, 1.002, 160);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0x9fb4d8,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    depthTest: false,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.renderOrder = 8;
  scene.add(ring);

  const scaleLabel = new THREE.Group();
  scene.add(scaleLabel);
  let labelText = '';

  function setLabel(text: string): void {
    if (text === labelText) return;
    labelText = text;
    for (const child of scaleLabel.children) {
      const sprite = child as THREE.Sprite;
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
    scaleLabel.clear();
    const sprite = makeLabel(text);
    sprite.position.set(0.62, -1.06, 0.004);
    scaleLabel.add(sprite);
  }

  return {
    draw(map, snap, view, seconds) {
      fillField(field, map, snap, view.mode, view.layers);
      fieldTexture.needsUpdate = true;

      // The star's drawn radius goes as the fourth root of its real one.
      //
      // Some compression is unavoidable: the ejecta ends up more than twenty times the
      // size it started, and a window that fits the end of the animation shows the
      // beginning as a dot while a window that fits the beginning loses the end off the
      // edge of the screen within a second. A fourth root turns twenty into two, which
      // fits, and still leaves the swelling during the deflagration plainly visible —
      // which matters, because that swelling is what makes the whole mechanism work.
      //
      // Only the overall size is compressed. Inside the star the radial scale is strictly
      // linear, so the relative thicknesses of the layers are true, and the ring carries
      // the real number.
      const growth = snap.outerRadius / map.star.radius;
      const largest = Math.pow(map.peakRadius / map.star.radius, SCALE_COMPRESSION);
      const fit = (Math.pow(growth, SCALE_COMPRESSION) / largest) * view.zoom;

      cut.scale.setScalar(fit);
      shell.scale.setScalar(fit);
      ring.scale.setScalar(fit);

      // The churn is strong while the flame is buoyant and fades once the detonation takes
      // over, because a detonation really is the smoother of the two fronts.
      const churny =
        snap.phase === 'deflagration' || snap.phase === 'simmering' || snap.phase === 'transition'
          ? 1
          : snap.phase === 'detonation' || snap.phase === 'core'
            ? 0.45
            : 0.3;
      shared.uChurn.value = view.turbulence * churny;
      shared.uTime.value = seconds;

      // The front, as a fraction of the star's radius, for both the churn mask and the
      // bright line drawn along it.
      let front = -1;
      for (let j = 0; j < snap.frontRadius.length; j += 1) {
        front = Math.max(front, snap.frontRadius[j]);
      }
      const frontFrac = front > 0 ? Math.min(1, front / snap.outerRadius) : 1;
      shared.uFrontFrac.value = frontFrac;
      cutMaterial.uniforms.uMarkers.value = view.markers ? 1 : 0;
      cutMaterial.uniforms.uFront.value = front > 0 && frontFrac < 0.995 ? frontFrac : -1;

      // Both ignore depth so they stay legible over the star, and are therefore switched
      // off outright once the camera goes round the back, where they would otherwise be
      // drawn on top of a star that ought to be hiding them.
      const inFront = camera.position.z > 0.05;
      ring.visible = inFront;
      scaleLabel.visible = inFront;
      setLabel(kmLabel(snap.outerRadius));

      sky.group.position.copy(camera.position);
      controls.update();
      renderer.render(scene, camera);
    },

    look(where) {
      const [x, y, z] = VIEWPOINTS[where];
      const distance = camera.position.length();
      camera.position.copy(new THREE.Vector3(x, y, z).normalize().multiplyScalar(distance));
      controls.update();
    },

    setAutoRotate(on) {
      controls.autoRotate = on;
    },

    resize() {
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },

    dispose() {
      controls.dispose();
      sky.dispose();
      scene.remove(sky.group);
      cut.geometry.dispose();
      cutMaterial.dispose();
      shell.geometry.dispose();
      shellMaterial.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
      fieldTexture.dispose();
      for (const child of scaleLabel.children) {
        const sprite = child as THREE.Sprite;
        sprite.material.map?.dispose();
        sprite.material.dispose();
      }
      renderer.dispose();
    },
  };
}
