/**
 * What is behind the star.
 *
 * None of this is simulated — it is scenery, and it exists because a supernova rendered
 * against a flat black rectangle looks like a diagram, while the same supernova with a sky
 * behind it looks like an event. The one thing the scenery is careful about is that it
 * never moves relative to the camera's rotation in a way that would make the star's own
 * scale ambiguous: it sits on a sphere far outside everything, so orbiting the star sweeps
 * past a fixed sky, which is the cue that tells you the camera is moving and not the star.
 */

import * as THREE from 'three';

/** How far out the sky sits. Everything else in the scene lives inside a radius of ~2. */
const SKY_RADIUS = 900;

/**
 * Star colours by spectral class, with the frequencies real catalogues have: overwhelmingly
 * red dwarfs, a scattering of sun-like yellows, and a handful of blue giants that carry
 * most of the light. Sampling uniformly instead gives a sky that reads as confetti.
 */
const STAR_CLASSES: { weight: number; colour: [number, number, number]; size: number }[] = [
  { weight: 0.76, colour: [1.0, 0.72, 0.52], size: 0.55 },
  { weight: 0.12, colour: [1.0, 0.86, 0.68], size: 0.75 },
  { weight: 0.076, colour: [1.0, 0.97, 0.9], size: 0.95 },
  { weight: 0.03, colour: [0.86, 0.92, 1.0], size: 1.3 },
  { weight: 0.014, colour: [0.68, 0.79, 1.0], size: 1.9 },
];

function pickClass(random: () => number): (typeof STAR_CLASSES)[number] {
  let roll = random();
  for (const entry of STAR_CLASSES) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return STAR_CLASSES[0];
}

/** A small deterministic generator, so the sky is the same every time the page loads. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const STAR_VERTEX = `
  attribute float size;
  attribute vec3 tint;
  varying vec3 vTint;
  void main() {
    vTint = tint;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = size;
  }
`;

/**
 * Stars are drawn as soft discs rather than squares, with a core that saturates towards
 * white. Real point sources in a real optical system are not uniform dots; the bright ones
 * bloom, and faking that with a two-stop falloff is most of what makes a starfield read as
 * a photograph instead of as scattered pixels.
 */
const STAR_FRAGMENT = `
  varying vec3 vTint;
  void main() {
    vec2 offset = gl_PointCoord - vec2(0.5);
    float d = length(offset) * 2.0;
    if (d > 1.0) discard;
    float halo = pow(1.0 - d, 2.2);
    float core = pow(max(0.0, 1.0 - d * 2.6), 3.0);
    vec3 colour = mix(vTint, vec3(1.0), core * 0.8);
    gl_FragColor = vec4(pow(colour, vec3(2.2)), halo * 0.85 + core);
  }
`;

function buildStars(random: () => number, count: number, band: number): THREE.Points {
  const position = new Float32Array(count * 3);
  const tint = new Float32Array(count * 3);
  const size = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    // Uniform on the sphere, then squashed towards a plane for the galactic band. The
    // squash is applied to the polar angle rather than to the finished point so that the
    // density stays uniform along the band instead of bunching at its ends.
    const u = random() * 2 - 1;
    const theta = random() * Math.PI * 2;
    const z = band > 0 ? Math.sign(u) * Math.pow(Math.abs(u), band) : u;
    const rho = Math.sqrt(Math.max(0, 1 - z * z));
    position[i * 3] = Math.cos(theta) * rho * SKY_RADIUS;
    position[i * 3 + 1] = z * SKY_RADIUS;
    position[i * 3 + 2] = Math.sin(theta) * rho * SKY_RADIUS;

    const kind = pickClass(random);
    // A little scatter around the class colour, or the sky comes out in five flat shades.
    const jitter = 0.9 + random() * 0.2;
    tint[i * 3] = Math.min(1, kind.colour[0] * jitter);
    tint[i * 3 + 1] = Math.min(1, kind.colour[1] * jitter);
    tint[i * 3 + 2] = Math.min(1, kind.colour[2] * jitter);
    size[i] = kind.size * (0.6 + random() * random() * 2.4);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(size, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

/**
 * One galaxy, painted into a canvas: a bulge, a disc, and two logarithmic spiral arms
 * stippled with individually placed blobs. Stippling rather than stroking is deliberate —
 * a drawn curve reads as a drawn curve at any resolution, and a few thousand overlapping
 * dots of varying size reads as unresolved stars.
 */
function galaxyTexture(random: () => number, tint: [number, number, number]): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Texture();

  const mid = size / 2;
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'lighter';

  const rgb = (a: number): string =>
    `rgba(${Math.round(tint[0] * 255)},${Math.round(tint[1] * 255)},${Math.round(tint[2] * 255)},${a})`;

  const halo = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  halo.addColorStop(0, rgb(0.5));
  halo.addColorStop(0.18, rgb(0.16));
  halo.addColorStop(0.55, rgb(0.04));
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  const arms = 2;
  const twist = 2.6 + random() * 1.4;
  for (let a = 0; a < arms; a += 1) {
    const phase = (a / arms) * Math.PI * 2 + random() * 0.4;
    for (let i = 0; i < 1400; i += 1) {
      const t = i / 1400;
      const radius = 0.08 + t * 0.44;
      // Scatter grows with radius, which is what makes the arms fray at their ends.
      const spread = 0.012 + t * 0.055;
      const angle =
        phase + twist * Math.log(radius / 0.06) + (random() - 0.5) * 1.1 * (0.3 + t);
      const rr = radius + (random() - 0.5) * spread * 2;
      const x = mid + Math.cos(angle) * rr * size;
      const y = mid + Math.sin(angle) * rr * size;
      const bright = (1 - t) * 0.5 + 0.06;
      ctx.fillStyle = random() < 0.12 ? `rgba(180,210,255,${bright * 0.8})` : rgb(bright * 0.35);
      ctx.beginPath();
      ctx.arc(x, y, 0.4 + random() * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export interface Sky {
  group: THREE.Group;
  dispose: () => void;
}

/**
 * The whole background. It is parented to a group the viewer keeps centred on the camera,
 * so no amount of zooming can ever reach it.
 */
export function createSky(): Sky {
  const random = seeded(0x5eed);
  const group = new THREE.Group();

  const field = buildStars(random, 5200, 0);
  const band = buildStars(random, 4200, 3.2);
  band.rotation.set(0.5, 0.2, 0.9);
  group.add(field, band);

  // A handful of galaxies, small and dim. They are set well apart and at different tilts,
  // because the thing that gives a deep-field photograph its depth is that no two of them
  // are the same size or the same angle.
  const tints: [number, number, number][] = [
    [0.86, 0.88, 1.0],
    [1.0, 0.9, 0.78],
    [0.78, 0.86, 1.0],
    [1.0, 0.84, 0.86],
    [0.84, 0.94, 0.96],
  ];
  const sprites: THREE.Sprite[] = [];
  const textures: THREE.Texture[] = [];
  for (let i = 0; i < 7; i += 1) {
    const texture = galaxyTexture(random, tints[i % tints.length]);
    textures.push(texture);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.28 + random() * 0.32,
      rotation: random() * Math.PI * 2,
    });
    const sprite = new THREE.Sprite(material);
    const u = random() * 2 - 1;
    const theta = random() * Math.PI * 2;
    const rho = Math.sqrt(Math.max(0, 1 - u * u));
    sprite.position.set(
      Math.cos(theta) * rho * SKY_RADIUS,
      u * SKY_RADIUS,
      Math.sin(theta) * rho * SKY_RADIUS,
    );
    const scale = SKY_RADIUS * (0.05 + random() * 0.11);
    sprite.scale.set(scale, scale, 1);
    sprite.material.depthTest = false;
    sprites.push(sprite);
    group.add(sprite);
  }

  group.renderOrder = -1;

  return {
    group,
    dispose: () => {
      for (const points of [field, band]) {
        points.geometry.dispose();
        (points.material as THREE.Material).dispose();
      }
      for (const sprite of sprites) sprite.material.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}
