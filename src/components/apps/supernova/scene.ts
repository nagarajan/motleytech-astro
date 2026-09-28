/**
 * The star, drawn as a half.
 *
 * Two surfaces make up the whole picture. One is a flat disc lying in the plane z = 0: the
 * cut face, where the onion is on show. The other is the hemisphere behind it, which is
 * the star's actual outside. Together they read as a sphere with a quarter taken out of
 * it, which is the only way to look at the inside of a star and still see that it is a
 * star.
 *
 * Neither surface is built out of the simulation's zones. Both are plain geometry, and all
 * the structure is painted on in a fragment shader from a one-dimensional texture holding
 * the current frame — a thousand pixels running from the middle of the star to its
 * surface. This matters more than it sounds like it should. The zones move by eight orders
 * of magnitude over a run, and rebuilding a mesh from them every frame would be both slow
 * and visibly steppy at the shock; sampling a texture in the fragment shader gives a front
 * that is sharp at any zoom, for the cost of uploading four kilobytes.
 *
 * ---
 *
 * The radial axis is logarithmic, everywhere, without exception. The neutron star is ten
 * kilometres across and the hydrogen envelope reaches six hundred million; on a linear
 * axis, any view that contains the second shows the first as substantially less than one
 * pixel. Every radius in here is therefore mapped
 *
 *     screen = (log10(r) - logMin) / (logMax - logMin)
 *
 * onto the unit disc, and the zoom control moves logMin and logMax rather than moving the
 * camera. The camera is only ever used for looking at the thing from a different angle.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SAMPLES, type ColourMode, type Strip, fillStrip, makeStrip } from './colour';
import type { Frame, RunResult } from './types';
import { createSky, type Sky } from '../sky';

export type Viewpoint = 'face' | 'angle' | 'edge' | 'behind';

export interface View {
  mode: ColourMode;
  /** The log-radius window, in log10 centimetres. */
  logMin: number;
  logMax: number;
  /** Strength of the illustrative multidimensional overlay, 0 to 1. */
  asymmetry: number;
  /** Draw the shock and neutrinosphere rings. */
  markers: boolean;
  /** Draw a faint circle at each power of ten in radius. */
  gridlines: boolean;
}

export interface Viewer {
  draw: (frame: Frame, run: RunResult, view: View, seconds: number) => void;
  look: (where: Viewpoint) => void;
  setAutoRotate: (on: boolean) => void;
  resize: () => void;
  dispose: () => void;
}

// ---------------------------------------------------------------- shared shader source

/**
 * The asymmetry overlay, and an apology for it.
 *
 * This model is one-dimensional: every quantity it computes is a function of radius alone,
 * and a genuinely spherical supernova is a supernova that mostly does not happen. What
 * actually revives the shock in nature is three-dimensional — convective plumes in the
 * neutrino-heated layer, the whole shock sloshing back and forth in the instability known
 * as SASI, and Rayleigh–Taylor fingers tearing up the composition interfaces behind it.
 *
 * None of that is being solved here. What follows is a *decoration*: a sum of low-order
 * angular patterns, slowly varying in time, that displaces the radius at which the shader
 * samples the one-dimensional profile. The displacement is real in the sense that its
 * angular orders, its amplitude and its timescales are taken from what three-dimensional
 * simulations produce, and fake in the sense that nothing in the model computed it and
 * turning it up changes no number anywhere. It is there because a spherical shock front
 * teaches the wrong lesson about what a supernova looks like, and the slider is there so
 * the honest, ugly, spherical answer stays one drag away.
 */
const WARP = `
  uniform float uAsym;
  uniform float uTime;
  uniform float uShockLog;
  uniform float uPnsLog;

  float pattern(vec3 dir, float t) {
    float p = 0.0;
    // The dipole and quadrupole: the shock as a whole leaning and breathing. These are the
    // orders SASI is seen to pick out, and they are slow -- a sloshing period is tens of
    // milliseconds, which against the hundreds of milliseconds the shock spends stalled is
    // a handful of cycles.
    p += 0.62 * dir.y * sin(t * 0.85 + 0.4);
    // The quadrupole is taken about a tilted axis rather than about z. About z it would be
    // constant everywhere on the cut face, which lies in z = 0, and would show up there as
    // the whole star breathing in and out instead of as a shape.
    float q = dot(dir, normalize(vec3(0.34, 0.78, 0.52)));
    p += 0.40 * (3.0 * q * q - 1.0) * sin(t * 0.61 + 1.9);
    p += 0.30 * dir.x * sin(t * 1.07 + 2.7);
    // Higher orders: the plumes themselves, finer and faster.
    p += 0.26 * sin(5.0 * atan(dir.y, dir.x) + t * 1.6) * (1.0 - dir.z * dir.z);
    p += 0.16 * sin(9.0 * acos(clamp(dir.y, -1.0, 1.0)) - t * 2.4);
    p += 0.10 * sin(14.0 * atan(dir.y, dir.x) - t * 3.1) * (1.0 - abs(dir.y));
    return p * 0.55;
  }

  /**
   * Where the overlay is allowed to act: above the neutron star's surface, and not beyond
   * the shock. Material ahead of the shock has not been touched yet and is still falling
   * in spherically, so distorting it would be wrong in a way anyone watching would notice.
   *
   * The result is a shift in log radius, and deliberately not a shift scaled by the width
   * of the current view: a lump on the shock front is a property of the star and must not
   * change size when the zoom does.
   *
   * Its size is capped well below the point where the map from screen radius to sampled
   * radius would stop being monotonic. Past that point the same profile gets sampled more
   * than once along a single ray and features like the shock marker appear two and three
   * times over, which is why the transition bands either side are as wide as they are.
   */
  float warpAt(vec3 dir, float logr) {
    if (uAsym <= 0.0) return 0.0;
    float inside = smoothstep(uShockLog + 0.38, uShockLog + 0.02, logr);
    float outside = smoothstep(uPnsLog - 0.05, uPnsLog + 0.35, logr);
    return uAsym * 0.13 * inside * outside * pattern(dir, uTime);
  }
`;

const CUT_VERTEX = `
  varying vec2 vPlane;
  void main() {
    vPlane = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CUT_FRAGMENT = `
  uniform sampler2D uStrip;
  uniform float uLogMin;
  uniform float uLogMax;
  uniform float uNuLog;
  uniform float uMarkers;
  uniform float uGrid;
  varying vec2 vPlane;

  ${WARP}

  void main() {
    float screen = length(vPlane);
    if (screen > 1.0) discard;

    float span = uLogMax - uLogMin;
    float logr = uLogMin + screen * span;
    // The cut face lies in z = 0, so a point on it names a direction on the great circle
    // through the poles of that plane. The overlay is a function on the sphere and is
    // evaluated with the same direction here as on the shell, which is what keeps the two
    // surfaces agreeing along the rim where they meet.
    vec3 dir = screen > 1e-5 ? normalize(vec3(vPlane, 0.0)) : vec3(1.0, 0.0, 0.0);

    float sampled = logr - warpAt(dir, logr);
    float u = clamp((sampled - uLogMin) / span, 0.0, 1.0);
    vec4 gas = texture2D(uStrip, vec2(u, 0.5));
    if (gas.a < 0.02) discard;

    vec3 colour = gas.rgb;

    // A faint circle at every power of ten. Without them a logarithmic picture is a
    // picture with no scale at all, and the eye will happily read it as a linear one.
    if (uGrid > 0.5) {
      float decade = fract(sampled);
      float edge = min(decade, 1.0 - decade);
      float line = smoothstep(0.012, 0.0, edge) * smoothstep(0.03, 0.12, screen);
      colour += vec3(0.16, 0.18, 0.22) * line;
    }

    if (uMarkers > 0.5) {
      float shock = smoothstep(0.012, 0.0, abs(sampled - uShockLog));
      colour = mix(colour, vec3(1.0, 0.96, 0.9), shock * 0.85);
      float nu = smoothstep(0.008, 0.0, abs(sampled - uNuLog));
      colour = mix(colour, vec3(0.55, 0.95, 1.0), nu * 0.7);
    }

    // The very middle of the disc is not a place, it is everything below the inner edge of
    // the log axis, so it is dimmed rather than left reading as resolved structure.
    colour *= 0.55 + 0.45 * smoothstep(0.0, 0.05, screen);

    // The ramps were chosen by eye, so they are sRGB values. The renderer encodes to sRGB
    // on the way out, so they are decoded here; the round trip cancels and what was picked
    // is what appears.
    gl_FragColor = vec4(pow(clamp(colour, 0.0, 1.0), vec3(2.2)), 1.0);
  }
`;

/**
 * The outside of the star. Same texture, sampled at one radius — the surface — so it takes
 * its colour from whatever the outermost shell is doing. For nearly the whole run that is
 * a cold red envelope sitting there doing nothing, and then the shock arrives and the
 * surface turns white in about a minute, which is shock breakout and is the moment the
 * supernova becomes something anybody could see.
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
  uniform sampler2D uStrip;
  uniform float uLogMin;
  uniform float uLogMax;
  uniform float uSurfaceLog;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vDir;

  ${WARP}

  void main() {
    float span = uLogMax - uLogMin;
    float sampled = uSurfaceLog - warpAt(vDir, uSurfaceLog);
    float u = clamp((sampled - uLogMin) / span, 0.0, 1.0);
    vec4 gas = texture2D(uStrip, vec2(u, 0.5));

    float lambert = 0.35 + 0.65 * max(0.0, dot(vNormal, normalize(vec3(0.5, 0.7, 0.6))));
    float rim = pow(1.0 - max(0.0, dot(vNormal, vView)), 2.5);
    vec3 colour = gas.rgb * lambert + gas.rgb * rim * 0.45;
    gl_FragColor = vec4(pow(clamp(colour, 0.0, 1.0), vec3(2.2)), 1.0);
  }
`;

/**
 * A soft blue-white blob. A sprite with no texture is a square, which over the middle of
 * the star reads as a rendering bug rather than as a glow, so the falloff is painted.
 */
function radialGlow(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Texture();
  const mid = size / 2;
  const fill = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  fill.addColorStop(0, 'rgba(226,244,255,0.95)');
  fill.addColorStop(0.12, 'rgba(150,214,255,0.45)');
  fill.addColorStop(0.36, 'rgba(78,160,255,0.13)');
  fill.addColorStop(0.7, 'rgba(50,120,230,0.03)');
  fill.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ---------------------------------------------------------------- labels

/**
 * A number floating in the scene, drawn into a canvas and hung on a sprite.
 *
 * These sit on top of the star, so they are kept quiet: no filled box behind them, just a
 * dark outline around pale text, which stays readable over both the white-hot middle and
 * the black sky without putting a slab over either.
 */
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
  const tall = 0.062;
  sprite.scale.set((canvas.width / canvas.height) * tall, tall, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** 1e9 cm is ten thousand kilometres; say that rather than making the reader convert. */
function radiusLabel(logCm: number): string {
  const cm = Math.pow(10, logCm);
  const km = cm / 1e5;
  if (km < 1000) return `${km < 10 ? km.toFixed(0) : Math.round(km)} km`;
  if (km < 1e6) return `${Math.round(km / 1e3)}\u2009000 km`;
  const solar = cm / 6.957e10;
  if (solar < 0.1) return `${(km / 1e6).toFixed(0)}M km`;
  if (solar < 1000) return `${solar < 10 ? solar.toFixed(1) : Math.round(solar)} R☉`;
  return `${(km / 1e8).toFixed(0)}\u2009\u00d710⁸ km`;
}

// ---------------------------------------------------------------- the viewer

const VIEWPOINTS: Record<Viewpoint, [number, number, number]> = {
  face: [0, 0.18, 3.1],
  angle: [1.9, 1.35, 2.1],
  edge: [3.0, 0.25, 0.35],
  behind: [-1.1, 0.9, -2.7],
};

export function createViewer(canvas: HTMLCanvasElement, background: string): Viewer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1600);
  camera.position.set(...VIEWPOINTS.face);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.minDistance = 1.15;
  controls.maxDistance = 9;
  controls.autoRotateSpeed = 0.55;
  controls.target.set(0, 0, 0);

  const sky: Sky = createSky();
  scene.add(sky.group);

  // The strip: one row of RGBA pixels holding the whole radial profile of the current
  // frame. Nearest filtering, because the shock is a discontinuity and smoothing it is
  // exactly the wrong thing to do to the one feature the picture is about.
  const strip: Strip = makeStrip();
  const stripTexture = new THREE.DataTexture(strip.pixels, SAMPLES, 1, THREE.RGBAFormat);
  stripTexture.magFilter = THREE.LinearFilter;
  stripTexture.minFilter = THREE.LinearFilter;
  stripTexture.wrapS = THREE.ClampToEdgeWrapping;
  stripTexture.wrapT = THREE.ClampToEdgeWrapping;
  stripTexture.generateMipmaps = false;
  stripTexture.needsUpdate = true;

  const shared = {
    uStrip: { value: stripTexture },
    uLogMin: { value: 6 },
    uLogMax: { value: 14 },
    uShockLog: { value: 0 },
    uPnsLog: { value: 0 },
    uNuLog: { value: 0 },
    uAsym: { value: 0 },
    uTime: { value: 0 },
  };

  const cutMaterial = new THREE.ShaderMaterial({
    vertexShader: CUT_VERTEX,
    fragmentShader: CUT_FRAGMENT,
    uniforms: {
      ...shared,
      uMarkers: { value: 1 },
      uGrid: { value: 1 },
    },
    side: THREE.DoubleSide,
  });

  // One quad. Everything circular about the cut face happens in the fragment shader, so
  // there is no tessellation to be coarse and no seam at the middle.
  const cut = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), cutMaterial);
  scene.add(cut);

  const shellMaterial = new THREE.ShaderMaterial({
    vertexShader: SHELL_VERTEX,
    fragmentShader: SHELL_FRAGMENT,
    uniforms: { ...shared, uSurfaceLog: { value: 13 } },
  });
  // phi from pi to 2pi is the half with z <= 0, which is the half behind the cut face.
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 128, 96, Math.PI, Math.PI),
    shellMaterial,
  );
  scene.add(shell);

  // The neutrino glow. Not light in any physical sense — neutrinos are invisible, which is
  // most of the problem with them — but the energy leaving this way outweighs everything
  // the explosion does by a factor of a hundred, and a picture with no sign of it gives a
  // badly wrong impression of where the energy went.
  const glowTexture = radialGlow();
  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Sprite(glowMaterial);
  glow.scale.set(0.9, 0.9, 1);
  scene.add(glow);

  // Decade labels along the +x axis of the cut face.
  const labels = new THREE.Group();
  scene.add(labels);
  let labelKey = '';

  function rebuildLabels(logMin: number, logMax: number): void {
    const key = `${logMin.toFixed(2)}:${logMax.toFixed(2)}`;
    if (key === labelKey) return;
    labelKey = key;
    for (const child of labels.children) {
      const sprite = child as THREE.Sprite;
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
    labels.clear();

    const span = logMax - logMin;
    // Four or five labels however wide the window is, always on whole decades, and never
    // so close together that they collide.
    const stride = Math.max(1, Math.round(span / 4.5));
    let lastPlaced = -1;
    for (let d = Math.floor(logMax); d >= Math.ceil(logMin); d -= stride) {
      const screen = (d - logMin) / span;
      if (screen < 0.1 || screen > 0.99) continue;
      if (lastPlaced >= 0 && lastPlaced - screen < 0.14) continue;
      lastPlaced = screen;
      const sprite = makeLabel(radiusLabel(d));
      sprite.position.set(screen, -0.045, 0.004);
      labels.add(sprite);
    }
  }

  function mapped(radius: number, logMin: number, logMax: number): number {
    return (Math.log10(Math.max(radius, 1)) - logMin) / (logMax - logMin);
  }

  return {
    draw(frame, run, view, seconds) {
      fillStrip(strip, frame, run.count, view.mode, view.logMin, view.logMax, run.failed);
      stripTexture.needsUpdate = true;

      shared.uLogMin.value = view.logMin;
      shared.uLogMax.value = view.logMax;
      shared.uAsym.value = view.asymmetry;
      shared.uTime.value = seconds;
      shared.uShockLog.value = frame.shockRadius > 0 ? Math.log10(frame.shockRadius) : -99;
      shared.uPnsLog.value = frame.coreRadius > 0 ? Math.log10(frame.coreRadius) : view.logMin;
      shared.uNuLog.value = frame.neutrinoSphere > 0 ? Math.log10(frame.neutrinoSphere) : -99;
      cutMaterial.uniforms.uMarkers.value = view.markers ? 1 : 0;
      cutMaterial.uniforms.uGrid.value = view.gridlines ? 1 : 0;

      // The surface, and whether there is any point drawing it. Zoomed into the inner
      // hundred kilometres the star's outside is far off the edge of the picture, and a
      // sphere of radius forty would swallow the camera.
      // Zoomed out far enough, this is the star's actual surface. Zoomed in, the surface
      // is off the edge of the picture, and rather than removing the dome the dome is
      // parked on the rim and given the colour of whatever material the view ends on. It
      // then reads as the star continuing past the cut, which is true, instead of as the
      // star having stopped there, which is not.
      const surface = frame.r[run.count];
      const surfaceScreen = Math.min(mapped(surface, view.logMin, view.logMax), 1);
      shellMaterial.uniforms.uSurfaceLog.value = Math.min(
        Math.log10(Math.max(surface, 1)),
        view.logMax,
      );
      shell.scale.setScalar(Math.max(surfaceScreen, 0.001));

      // Luminosity runs from about 1e51 to 1e53 erg/s, so the glow is keyed to its
      // logarithm; keyed to the value itself it would be invisible and then saturated.
      // On a logarithmic axis the neutrinosphere is genuinely half way across the
      // picture, so a glow drawn at its true size and any real opacity simply erases the
      // middle of the star. It is kept faint and well inside that radius: a haze over the
      // proto-neutron star rather than a lamp in front of it.
      const lum = frame.neutrinoLuminosity;
      const lit = lum > 0 ? Math.min(1, Math.max(0, (Math.log10(lum) - 50.5) / 2.8)) : 0;
      // Depth testing this against the cut face fails: they are within a thousandth of
      // each other and the buffer cannot separate them, which leaves a band of the glow
      // flickering in and out. It is drawn unconditionally in front instead, and simply
      // switched off once the camera is round the back where the star should hide it.
      // And switched off once the star has lost: the luminosity spikes at the moment the
      // shock is swallowed, which is real, but a glow shining out of a black hole is not.
      glow.visible = camera.position.z > 0.05 && frame.phase !== 'failed';
      glowMaterial.opacity = lit * 0.34;
      const nuScreen = Math.max(mapped(Math.max(frame.neutrinoSphere, 1e6), view.logMin, view.logMax), 0.03);
      glow.scale.setScalar(nuScreen * 1.5 + 0.04);

      // The labels ignore depth so that they stay legible over the white-hot middle, and
      // are therefore hidden outright once the camera goes round the back, where they
      // would otherwise be numbers floating on top of an opaque star.
      labels.visible = view.gridlines && camera.position.z > 0.05;
      if (labels.visible) rebuildLabels(view.logMin, view.logMax);

      sky.group.position.copy(camera.position);
      controls.update();
      renderer.render(scene, camera);
    },

    look(where) {
      const [x, y, z] = VIEWPOINTS[where];
      const distance = camera.position.length();
      const target = new THREE.Vector3(x, y, z).normalize().multiplyScalar(distance);
      camera.position.copy(target);
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
      glowMaterial.dispose();
      glowTexture.dispose();
      stripTexture.dispose();
      for (const child of labels.children) {
        const sprite = child as THREE.Sprite;
        sprite.material.map?.dispose();
        sprite.material.dispose();
      }
      renderer.dispose();
    },
  };
}
