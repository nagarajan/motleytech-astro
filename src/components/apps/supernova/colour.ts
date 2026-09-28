/**
 * Turning one recorded moment into one row of pixels.
 *
 * The solver works in Lagrangian zones: parcels of gas, each carrying a fixed mass, whose
 * radii move. The renderer wants the opposite — a fixed grid in radius, whose contents
 * change. This is where that swap happens, once per frame, and the result is a strip of
 * RGBA bytes that the cut-plane shader reads as a one-dimensional texture.
 *
 * The grid is logarithmic in radius, and it has to be. Over a single run the interesting
 * structure moves from ten kilometres to a billion, and a linear grid fine enough to show
 * the neutron star would need a hundred million samples to reach the surface. On a log
 * grid the whole thing is a thousand.
 */

import {
  SPECIES,
  SPECIES_COLOUR,
  SPECIES_COUNT,
} from './constants';
import type { Frame } from './types';

/** Width of the strip. A thousand samples across eight decades is a hundred per decade. */
export const SAMPLES = 1024;

export type ColourMode =
  | 'composition'
  | 'temperature'
  | 'density'
  | 'entropy'
  | 'velocity'
  | 'burning';

export const COLOUR_MODES: { id: ColourMode; label: string; note: string }[] = [
  {
    id: 'composition',
    label: 'Composition',
    note: 'What each shell is made of. The onion, and what the shock does to it.',
  },
  {
    id: 'entropy',
    label: 'Entropy',
    note: 'The clearest view of the shock. A shock is the one thing that raises entropy permanently, so the front shows up as a hard edge that nothing else produces.',
  },
  {
    id: 'temperature',
    label: 'Temperature',
    note: 'Ten billion kelvin at the bounce, down to a few thousand at the surface.',
  },
  {
    id: 'density',
    label: 'Density',
    note: 'Twenty-four orders of magnitude, from nuclear matter to the outer envelope.',
  },
  {
    id: 'velocity',
    label: 'Velocity',
    note: 'Blue is falling in, orange is flying out. The moment the explosion starts is the moment the colour flips.',
  },
  {
    id: 'burning',
    label: 'Nuclear burning',
    note: 'Where nuclear energy is being released right now. Watch it light up shell by shell as the shock arrives.',
  },
];

// ---------------------------------------------------------------- colour ramps

type Stop = [number, number, number, number];

/** Linear interpolation through a list of colour stops keyed on a scalar. */
function ramp(stops: Stop[], value: number): [number, number, number] {
  if (value <= stops[0][0]) return [stops[0][1], stops[0][2], stops[0][3]];
  const last = stops[stops.length - 1];
  if (value >= last[0]) return [last[1], last[2], last[3]];
  for (let i = 1; i < stops.length; i += 1) {
    if (value <= stops[i][0]) {
      const a = stops[i - 1];
      const b = stops[i];
      const t = (value - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
  }
  return [last[1], last[2], last[3]];
}

/**
 * Temperature, on something close to the colour a black body of that temperature would
 * actually be, stretched over seven decades so that both the surface of a red supergiant
 * and the inside of a bouncing core land somewhere useful.
 */
const HEAT: Stop[] = [
  [3.0, 0.06, 0.03, 0.08],
  [3.6, 0.45, 0.12, 0.06],
  [4.2, 0.78, 0.26, 0.05],
  [5.5, 0.95, 0.52, 0.12],
  [7.0, 1.0, 0.8, 0.35],
  [8.5, 1.0, 0.96, 0.82],
  [9.5, 0.86, 0.93, 1.0],
  [10.6, 0.7, 0.82, 1.0],
];

const DENSITY: Stop[] = [
  [-10, 0.02, 0.03, 0.09],
  [-4, 0.08, 0.16, 0.38],
  [0, 0.11, 0.45, 0.62],
  [4, 0.18, 0.7, 0.55],
  [8, 0.75, 0.78, 0.3],
  [11, 0.95, 0.55, 0.22],
  [13, 0.98, 0.35, 0.4],
  [14.6, 1.0, 0.92, 0.98],
];

/**
 * Entropy per baryon. Unshocked stellar material sits below about two; the bounce shock
 * pushes what it passes through to ten or twenty, and the neutrino-heated bubble above the
 * neutron star reaches fifty and more. The ramp is tuned so that edge is unmissable.
 */
const ENTROPY: Stop[] = [
  [0, 0.09, 0.10, 0.20],
  [1.5, 0.22, 0.17, 0.44],
  [3, 0.42, 0.18, 0.5],
  [8, 0.78, 0.25, 0.42],
  [16, 0.97, 0.5, 0.2],
  [30, 1.0, 0.82, 0.35],
  [60, 1.0, 0.98, 0.85],
];

const BURN: Stop[] = [
  [0, 0.05, 0.04, 0.06],
  [0.25, 0.5, 0.11, 0.04],
  [0.55, 0.95, 0.42, 0.06],
  [0.8, 1.0, 0.82, 0.3],
  [1.0, 1.0, 1.0, 0.92],
];

/**
 * The compact object: everything below the solver's inner boundary, which is not being
 * followed zone by zone any more but is very much still there and is most of the reason
 * anything else in the picture is moving.
 *
 * It is drawn as a gradient rather than a flat fill, dark in the middle and bright at its
 * surface. On a logarithmic axis this region is a large fraction of the picture — the
 * proto-neutron star really is half way across, in log radius — and a solid block of pale
 * blue that size stops reading as an object and starts reading as a hole in the render.
 */
const COMPACT_CORE: [number, number, number] = [0.1, 0.13, 0.24];
const COMPACT_EDGE: [number, number, number] = [0.8, 0.87, 1.0];
const HOLE_CORE: [number, number, number] = [0.01, 0.01, 0.02];
const HOLE_EDGE: [number, number, number] = [0.12, 0.1, 0.16];

// ---------------------------------------------------------------- resampling

export interface Strip {
  /** RGBA bytes, SAMPLES wide. Alpha is zero outside the star. */
  pixels: Uint8Array;
  /** The log-radius window these pixels cover. */
  logMin: number;
  logMax: number;
}

export function makeStrip(): Strip {
  return { pixels: new Uint8Array(SAMPLES * 4), logMin: 6, logMax: 14 };
}

/** Which zone holds this radius. The interface radii are sorted, so this is a bisection. */
function findZone(r: Float32Array, lo: number, hi: number, want: number): number {
  let a = lo;
  let b = hi;
  while (b - a > 1) {
    const mid = (a + b) >> 1;
    if (r[mid] <= want) a = mid;
    else b = mid;
  }
  return a;
}

/**
 * Fill a strip from one frame.
 *
 * `failed` switches the compact object from the white-hot surface of a new neutron star to
 * a hole, which is a rendering decision rather than a physical one: the solver stops when
 * the shock is swallowed and does not follow the horizon forming.
 */
export function fillStrip(
  strip: Strip,
  frame: Frame,
  count: number,
  mode: ColourMode,
  logMin: number,
  logMax: number,
  failed: boolean,
): void {
  const { pixels } = strip;
  strip.logMin = logMin;
  strip.logMax = logMax;

  const { r, v, rho, temp, entropy, comp, burning, inner } = frame;
  const span = logMax - logMin;
  const innerEdge = r[inner];
  const outerEdge = r[count];
  const coreCore = failed ? HOLE_CORE : COMPACT_CORE;
  const coreEdge = failed ? HOLE_EDGE : COMPACT_EDGE;
  const innerLog = Math.log10(Math.max(innerEdge, 1));

  let zone = inner;
  for (let j = 0; j < SAMPLES; j += 1) {
    const radius = Math.pow(10, logMin + ((j + 0.5) / SAMPLES) * span);
    const at = j * 4;

    if (radius > outerEdge) {
      // Cleared rather than just made transparent. The texture is sampled with linear
      // filtering, so a transparent texel holding a stale colour would bleed that colour
      // into the last real one at the star's edge.
      pixels[at] = 0;
      pixels[at + 1] = 0;
      pixels[at + 2] = 0;
      pixels[at + 3] = 0;
      continue;
    }
    if (radius < innerEdge) {
      // Graded in log radius rather than in radius, to match the axis: otherwise the
      // whole gradient happens in the outermost few pixels of the region.
      const depth = (Math.log10(radius) - logMin) / Math.max(innerLog - logMin, 0.2);
      const t = Math.min(1, Math.max(0, depth)) ** 2;
      pixels[at] = (coreCore[0] + (coreEdge[0] - coreCore[0]) * t) * 255;
      pixels[at + 1] = (coreCore[1] + (coreEdge[1] - coreCore[1]) * t) * 255;
      pixels[at + 2] = (coreCore[2] + (coreEdge[2] - coreCore[2]) * t) * 255;
      pixels[at + 3] = 255;
      continue;
    }

    // The samples march outwards, so the search only ever needs to walk forwards from
    // where the last one landed. Over a thousand samples and five hundred zones that is
    // fifteen hundred comparisons for the whole strip.
    if (radius < r[zone] || radius >= r[zone + 1]) {
      zone = radius >= r[zone + 1] ? findZone(r, zone, count, radius) : findZone(r, inner, count, radius);
    }

    let red = 0;
    let green = 0;
    let blue = 0;

    if (mode === 'composition') {
      const offset = zone * SPECIES_COUNT;
      let total = 0;
      for (let s = 0; s < SPECIES_COUNT; s += 1) {
        const share = comp[offset + s];
        if (share === 0) continue;
        const tint = SPECIES_COLOUR[SPECIES[s]];
        red += tint[0] * share;
        green += tint[1] * share;
        blue += tint[2] * share;
        total += share;
      }
      if (total > 0) {
        red /= total;
        green /= total;
        blue /= total;
      }
      // Shocked material is lit from within. Without this the composition view is a set of
      // flat bands that barely changes all run, and the whole point is to watch the shock
      // cross them.
      const glow = Math.min(1, burning[zone] / 210);
      if (glow > 0) {
        red += (1 - red) * glow * 0.85;
        green += (1 - green) * glow * 0.6;
        blue += (1 - blue) * glow * 0.25;
      }
    } else if (mode === 'temperature') {
      [red, green, blue] = ramp(HEAT, Math.log10(Math.max(temp[zone], 1)));
    } else if (mode === 'density') {
      [red, green, blue] = ramp(DENSITY, Math.log10(Math.max(rho[zone], 1e-12)));
    } else if (mode === 'entropy') {
      [red, green, blue] = ramp(ENTROPY, entropy[zone]);
    } else if (mode === 'burning') {
      [red, green, blue] = ramp(BURN, burning[zone] / 255);
    } else {
      // Velocity, on a two-sided scale anchored at rest. Infall and outflow differ by a
      // sign and by nothing else that matters, so they get opposite ends of the ramp and
      // the same cube-root stretch, which keeps a thousand-kilometre-a-second wind visible
      // next to a thirty-thousand-kilometre-a-second shock.
      const speed = (v[zone] + v[zone + 1]) / 2 / 3e9;
      const t = Math.cbrt(Math.max(-1, Math.min(1, speed)));
      if (t < 0) {
        const m = -t;
        red = 0.1 + 0.1 * m;
        green = 0.22 + 0.42 * m;
        blue = 0.35 + 0.6 * m;
      } else {
        red = 0.1 + 0.9 * t;
        green = 0.12 + 0.55 * t;
        blue = 0.16 + 0.1 * t;
      }
    }

    pixels[at] = Math.max(0, Math.min(255, red * 255));
    pixels[at + 1] = Math.max(0, Math.min(255, green * 255));
    pixels[at + 2] = Math.max(0, Math.min(255, blue * 255));
    pixels[at + 3] = 255;
  }
}

/** The legend for whichever mode is showing, as stops the UI can draw as a gradient. */
export function legendFor(mode: ColourMode): { label: string; colour: string }[] {
  const hex = (c: [number, number, number]): string =>
    `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
  const from = (stops: Stop[], format: (v: number) => string) =>
    stops.map((s) => ({ label: format(s[0]), colour: hex([s[1], s[2], s[3]]) }));

  if (mode === 'composition') {
    const short: Record<string, string> = {
      h: 'H', he: 'He', c: 'C', o: 'O/Ne', si: 'Si/S', fe: 'Fe/Ni', free: 'n, p',
    };
    return SPECIES.map((s) => ({ label: short[s], colour: hex(SPECIES_COLOUR[s]) }));
  }
  if (mode === 'temperature') return from(HEAT, (v) => `10^${v.toFixed(0)} K`);
  if (mode === 'density') return from(DENSITY, (v) => `10^${v.toFixed(0)}`);
  if (mode === 'entropy') return from(ENTROPY, (v) => `${v} kB`);
  if (mode === 'burning') return from(BURN, (v) => (v === 0 ? 'none' : v === 1 ? 'fierce' : ''));
  return [
    { label: '−30,000 km/s', colour: 'rgb(51,163,242)' },
    { label: 'at rest', colour: 'rgb(26,31,41)' },
    { label: '+30,000 km/s', colour: 'rgb(255,171,66)' },
  ];
}
