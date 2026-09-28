import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  COLOUR_MODES,
  LAYER_MODES,
  legendFor,
  type ColourMode,
  type LayerMode,
} from './typeia/colour';
import { M_SUN, SPECIES, SPECIES_COLOUR, SPECIES_SHORT } from './typeia/constants';
import {
  buildBurnMap,
  inFoe,
  sampleAt,
  NR,
  NTHETA,
  TIMELINE_DURATION,
  type BurnMap,
  type Phase,
  type Scenario,
  type Snapshot,
} from './typeia/model';
import { createViewer, type View, type Viewer, type Viewpoint } from './typeia/scene';
import './typeia/typeia.css';

/**
 * Playback speeds, as a fraction of real time.
 *
 * Every one of them is slow motion. The whole event takes about two seconds, and at one
 * to one that is two seconds of watching — which is long enough to see that something
 * happened and far too short to see what. The default runs at a fortieth, so the two
 * seconds become eighty.
 */
const SPEEDS = [
  { label: '1/400', value: 1 / 400 },
  { label: '1/160', value: 1 / 160 },
  { label: '1/40', value: 1 / 40 },
  { label: '1/10', value: 1 / 10 },
  { label: '1/3', value: 1 / 3 },
  { label: 'real time', value: 1 },
];

const SCENARIOS: { id: Scenario; label: string; blurb: string }[] = [
  {
    id: 'delayed',
    label: 'Delayed detonation',
    blurb:
      'A white dwarf that has grown to within a hair of the Chandrasekhar limit by pulling matter off a companion. It ignites in its own centre, burns subsonically for about a second while swelling, and then — for reasons nobody can derive from first principles — the flame turns into a detonation and the rest goes in a quarter of a second.',
  },
  {
    id: 'double',
    label: 'Double detonation',
    blurb:
      'A lighter white dwarf that could never ignite on its own, wearing a thin skin of stolen helium. The skin detonates first, at one point, and the wave runs around the outside of the star driving a shock inward. Where those shocks converge — off to one side of the centre, not in it — the carbon finally catches. In 2025 the Very Large Telescope found the double calcium shell this leaves behind, in the remnant SNR 0509-67.5.',
  },
];

const VIEWPOINTS: { id: Viewpoint; label: string }[] = [
  { id: 'face', label: 'Cut face' },
  { id: 'angle', label: 'Three-quarter' },
  { id: 'edge', label: 'Edge on' },
  { id: 'behind', label: 'Behind' },
];

const PHASE_LABEL: Record<Phase, string> = {
  simmering: 'Simmering',
  deflagration: 'Deflagration',
  transition: 'Transition',
  detonation: 'Detonation',
  helium: 'Helium shell burning',
  converging: 'Shock converging',
  core: 'Core detonation',
  expanding: 'Coasting',
};

const PHASE_NOTE: Record<Phase, string> = {
  simmering:
    'The last thousand years, compressed to nothing. The centre of the white dwarf has been quietly burning carbon and convecting the heat away for centuries, getting hotter without getting bigger — because a degenerate gas does not expand when you heat it. That is the whole problem. An ordinary star would puff up and cool itself down; this one cannot, so the temperature simply runs away.',
  deflagration:
    'A flame, and a slow one. This front travels by heat leaking forward and lighting the next layer, which is subsonic — about a hundred kilometres a second where sound goes nine thousand. It is also buoyant: the ash behind it is hot and light and floats, which is why the front is not a sphere but a cluster of rising plumes. Watch the star swell. That swelling is not a side effect, it is the mechanism: a deflagration releases almost exactly the binding energy and no more, and the star it leaves behind is barely held together and much less dense than it was.',
  transition:
    'The deflagration-to-detonation transition, and the honest answer is that nobody knows how it happens. What is known is that it has to: a white dwarf that only ever deflagrates does not release enough energy, leaves unburnt carbon sitting in its centre where no observation finds any, and makes almost no silicon. Put a transition in at around ten million grams per cubic centimetre and all three problems go away at once.',
  detonation:
    'Now it is a shock wave. A detonation does not wait for heat to leak forward — it compresses the fuel ahead of it hard enough to ignite it, and the energy that releases drives the shock harder into the next layer. Each layer pays for the ignition of the next. That is the cascade, it is supersonic, and it crosses what remains of the star in about a quarter of a second.',
  helium:
    'The stolen skin goes first. Helium ignites at far lower densities than carbon, so the thin shell this star has pulled off its companion detonates while the core underneath is still completely inert. The front is running around the outside of the star at roughly fifteen thousand kilometres a second, and it takes about a second to get all the way round.',
  converging:
    'Every patch of the shell that detonates drives a shock downward into the core, and because the shell is a sphere all of those shocks are heading for the same place. They are not launched simultaneously, though — the ignition side got a head start — so they converge off to one side of the centre rather than in it. That offset is why this mechanism leaves a lopsided remnant.',
  core:
    'The second detonation. Where the converging shocks met, the carbon has finally been compressed hard enough to ignite, and the burn spreads outward from a point that is not the middle of the star. The front reaching the far side before the near side is not an artefact; it is the signature.',
  expanding:
    'Nothing left to burn, and nothing left behind. The star is now unbound debris flying apart at up to twenty thousand kilometres a second, and from here on every parcel travels in a straight line — so radius becomes simply speed times time and the whole object turns into a scale model of its own velocity field. Unlike a core collapse, this leaves no neutron star, no black hole, no remnant of any kind. The star is entirely gone.',
};

// ---------------------------------------------------------------- formatting

function formatSeconds(t: number): string {
  if (t < 0.01) return `${(t * 1000).toFixed(1)} ms`;
  if (t < 1) return `${(t * 1000).toFixed(0)} ms`;
  return `${t.toFixed(3)} s`;
}

function formatRadius(cm: number): string {
  const km = cm / 1e5;
  if (km < 10000) return `${Math.round(km).toLocaleString('en-US')} km`;
  if (km < 1e6) return `${Math.round(km).toLocaleString('en-US')} km`;
  return `${(km / 1e6).toFixed(2)}M km`;
}

function superscript(n: number): string {
  const digits = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const sign = n < 0 ? '⁻' : '';
  return sign + String(Math.abs(n)).split('').map((d) => digits[Number(d)]).join('');
}

function formatDensity(value: number): string {
  if (!(value > 0)) return '—';
  const power = Math.floor(Math.log10(value));
  const mantissa = value / Math.pow(10, power);
  return `${mantissa.toFixed(1)}\u00d710${superscript(power)} g/cm³`;
}

const hex = (c: [number, number, number]): string =>
  `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

// ---------------------------------------------------------------- component

export default function TypeIaApp(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);

  const [scenario, setScenario] = useState<Scenario>('delayed');
  const [error, setError] = useState('');

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1 / 40);
  const [time, setTime] = useState(0);

  const [mode, setMode] = useState<ColourMode>('composition');
  const [layers, setLayers] = useState<LayerMode>('emerge');
  const [turbulence, setTurbulence] = useState(0.55);
  const [zoom, setZoom] = useState(1);
  const [markers, setMarkers] = useState(true);
  const [spin, setSpin] = useState(false);

  const [notice, setNotice] = useState(SCENARIOS[0].blurb);

  /**
   * The explosion itself. Both scenarios are worked out from the white dwarf structure
   * upwards, and both take about a fifth of a second, so there is no loading step and no
   * worker: switching scenario simply rebuilds it. Everything after this is a lookup.
   */
  const map: BurnMap = useMemo(() => buildBurnMap(scenario), [scenario]);

  /** Reused between frames so that playback allocates nothing. */
  const snapRef = useRef<Snapshot | null>(null);
  const mapRef = useRef(map);
  mapRef.current = map;

  /**
   * Where playback is, in seconds of star time. This cannot live in React state: the loop
   * runs every sixteen milliseconds and a state update does not land until the next
   * render, so a loop reading its own position back out of state would always be a frame
   * or two stale and would stutter. The ref is the truth; `time` is a copy for the parts
   * of the interface that have to re-render.
   */
  const positionRef = useRef(0);
  const live = useRef({ playing, speed, mode, layers, turbulence, zoom, markers });
  live.current = { playing, speed, mode, layers, turbulence, zoom, markers };

  const goTo = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(TIMELINE_DURATION, next));
    positionRef.current = clamped;
    setTime(clamped);
  }, []);

  useEffect(() => {
    positionRef.current = 0;
    setTime(0);
    setPlaying(false);
  }, [scenario]);

  // ---------------------------------------------------------------- the scene

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let viewer: Viewer;
    try {
      viewer = createViewer(canvas);
    } catch {
      setError('This browser could not start WebGL, so the star cannot be drawn.');
      return;
    }
    viewerRef.current = viewer;
    viewer.resize();

    let running = true;
    let last = performance.now();
    let clock = 0;
    let announced = -1;

    const tick = (now: number): void => {
      if (!running) return;
      requestAnimationFrame(tick);
      const elapsed = Math.min(0.1, (now - last) / 1000);
      last = now;
      clock += elapsed;

      const settings = live.current;
      if (settings.playing) {
        positionRef.current = Math.min(
          TIMELINE_DURATION,
          positionRef.current + elapsed * settings.speed,
        );
        if (positionRef.current >= TIMELINE_DURATION) setPlaying(false);
      }

      // The readouts only need to change about twenty times a second; re-rendering React
      // on every frame to move a number by a thousandth is wasted work.
      const rounded = Math.round(positionRef.current * 20);
      if (rounded !== announced) {
        announced = rounded;
        setTime(positionRef.current);
      }

      const current = mapRef.current;
      snapRef.current = sampleAt(current, positionRef.current, snapRef.current ?? undefined);
      const view: View = {
        mode: settings.mode,
        layers: settings.layers,
        turbulence: settings.turbulence,
        zoom: settings.zoom,
        markers: settings.markers,
      };
      viewer.draw(current, snapRef.current, view, clock);
    };
    requestAnimationFrame(tick);

    const onResize = (): void => viewer.resize();
    window.addEventListener('resize', onResize);

    return () => {
      running = false;
      window.removeEventListener('resize', onResize);
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => viewerRef.current?.setAutoRotate(spin), [spin]);

  // Rebuilding the map invalidates the reused snapshot, which is sized to the old one.
  useEffect(() => {
    snapRef.current = null;
  }, [map]);

  // ---------------------------------------------------------------- derived

  const snap = useMemo(() => sampleAt(map, time), [map, time]);

  /** The first moment of each phase, for the jump buttons. */
  const chapters = useMemo(() => {
    const found: { phase: Phase; at: number }[] = [];
    const seen = new Set<Phase>();
    map.phases.forEach((phase, i) => {
      if (seen.has(phase)) return;
      seen.add(phase);
      found.push({ phase, at: (i / map.phases.length) * TIMELINE_DURATION });
    });
    return found;
  }, [map]);

  /** What has been made so far, as a running total rather than the final tally. */
  const yields = useMemo(() => {
    const totals = new Float64Array(SPECIES.length);
    for (let i = 0; i < NR; i += 1) {
      const cellMass = map.dm[i] / NTHETA;
      for (let j = 0; j < NTHETA; j += 1) {
        const base = (i * NTHETA + j) * SPECIES.length;
        for (let s = 0; s < SPECIES.length; s += 1) totals[s] += snap.comp[base + s] * cellMass;
      }
    }
    return SPECIES.map((s, i) => ({ species: s, mass: totals[i] / M_SUN }));
  }, [map, snap]);

  const legend = useMemo(() => legendFor(mode), [mode]);
  const modeInfo = COLOUR_MODES.find((m) => m.id === mode);
  const scenarioInfo = SCENARIOS.find((s) => s.id === scenario);

  const step = useCallback(
    (delta: number) => {
      setPlaying(false);
      goTo(positionRef.current + delta);
    },
    [goTo],
  );

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowRight') {
      step(event.shiftKey ? 0.1 : 0.01);
      event.preventDefault();
    } else if (event.key === 'ArrowLeft') {
      step(event.shiftKey ? -0.1 : -0.01);
      event.preventDefault();
    } else if (event.key === ' ') {
      setPlaying((p) => !p);
      event.preventDefault();
    }
  };

  // ---------------------------------------------------------------- render

  const secondsPerSecond = speed;

  return (
    <div className="ia">
      <div className="ia-bar">
        <div className="ia-switch" role="group" aria-label="Which way the white dwarf explodes">
          {SCENARIOS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={entry.id === scenario}
              onClick={() => {
                setScenario(entry.id);
                setNotice(entry.blurb);
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <span className="ia-spacer" />

        <span className="ia-field">
          Speed
          <select
            className="ia-select"
            value={speed}
            aria-label="Playback speed"
            onChange={(event) => setSpeed(Number(event.target.value))}
          >
            {SPEEDS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </span>

        <button type="button" className="ia-btn" onClick={() => step(-0.01)}>
          ◀ Step
        </button>
        <button
          type="button"
          className="ia-btn ia-btn--primary"
          onClick={() => {
            if (time >= TIMELINE_DURATION - 1e-6) goTo(0);
            setPlaying((p) => !p);
          }}
        >
          {playing ? 'Pause' : time >= TIMELINE_DURATION - 1e-6 ? 'Replay' : 'Play'}
        </button>
        <button type="button" className="ia-btn" onClick={() => step(0.01)}>
          Step ▶
        </button>
      </div>

      {error && <p className="ia-warn">{error}</p>}

      <div className="ia-scrub">
        <input
          className="ia-time"
          type="range"
          min={0}
          max={TIMELINE_DURATION}
          step={0.002}
          value={time}
          aria-label="Move through the explosion"
          onChange={(event) => {
            setPlaying(false);
            goTo(Number(event.target.value));
          }}
        />
        <span className="ia-clock">{formatSeconds(time)}</span>
      </div>

      <div className="ia-ticks">
        {[0, 1, 2, 3, 4].map((t) => (
          <span key={t} className="ia-tick" style={{ left: `${(t / TIMELINE_DURATION) * 100}%` }}>
            {t} s
          </span>
        ))}
      </div>

      <div className="ia-chapters">
        {chapters.map((chapter) => (
          <button
            key={chapter.phase}
            type="button"
            className={snap.phase === chapter.phase ? 'ia-chip ia-chip--on' : 'ia-chip'}
            onClick={() => {
              setPlaying(false);
              goTo(chapter.at);
              setNotice(PHASE_NOTE[chapter.phase]);
            }}
          >
            {PHASE_LABEL[chapter.phase]}
          </button>
        ))}
      </div>

      <div className="ia-panes">
        <div className="ia-stage">
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
          <canvas
            ref={canvasRef}
            className="ia-canvas"
            tabIndex={0}
            onKeyDown={onKeyDown}
            aria-label="A white dwarf in cross-section, cut in half. Drag to orbit, scroll to move the camera."
          />
          <p className="ia-legend-line">
            drag to orbit · scroll to move the camera · ← → to step · space to play
          </p>
        </div>

        <div className="ia-side">
          <section className="ia-block">
            <h3 className="ia-head">
              {PHASE_LABEL[snap.phase]}
              <span>{formatSeconds(time)}</span>
            </h3>
            <dl className="ia-stats">
              <div>
                <dt>Radius</dt>
                <dd>{formatRadius(snap.outerRadius)}</dd>
              </div>
              <div>
                <dt>Grown by</dt>
                <dd>×{(snap.outerRadius / map.star.radius).toFixed(1)}</dd>
              </div>
              <div>
                <dt>Central density</dt>
                <dd>{formatDensity(snap.density[0])}</dd>
              </div>
              <div>
                <dt>Burnt</dt>
                <dd>{(snap.burnedMass / M_SUN).toFixed(3)} M☉</dd>
              </div>
              <div>
                <dt>Nuclear energy</dt>
                <dd>{inFoe(snap.nuclearEnergy).toFixed(3)} foe</dd>
              </div>
              <div>
                <dt>Still bound by</dt>
                <dd className={snap.nuclearEnergy > map.star.bindingEnergy ? 'ia-stat--good' : ''}>
                  {snap.nuclearEnergy > map.star.bindingEnergy
                    ? 'unbound'
                    : `${inFoe(map.star.bindingEnergy - snap.nuclearEnergy).toFixed(3)} foe`}
                </dd>
              </div>
            </dl>
            <p className="ia-slowmo">
              One second of watching covers{' '}
              <strong>{formatSeconds(secondsPerSecond)}</strong> of the star.
            </p>
          </section>

          <section className="ia-block">
            <h3 className="ia-head">
              Made so far
              <span>{(snap.burnedMass / map.star.totalMass * 100).toFixed(0)}% burnt</span>
            </h3>
            <ul className="ia-yields">
              {yields
                .filter((entry) => entry.mass > 0.002)
                .map((entry) => (
                  <li key={entry.species}>
                    <span>{SPECIES_SHORT[entry.species]}</span>
                    <span className="ia-yield-bar">
                      <span
                        className="ia-yield-fill"
                        style={{
                          width: `${Math.min(100, (entry.mass / 1.0) * 100)}%`,
                          background: hex(SPECIES_COLOUR[entry.species]),
                        }}
                      />
                    </span>
                    <span>{entry.mass.toFixed(3)} M☉</span>
                  </li>
                ))}
            </ul>
            <p className="ia-fine">
              Nickel-56 is the one that matters afterwards. It is radioactive, and its decay
              is the entire light of the supernova for the following months — which is why
              these can be used to measure the universe: the amount of it made is nearly
              always the same.
            </p>
          </section>

          <section className="ia-block">
            <h3 className="ia-head">
              Colour
              <span>{modeInfo?.label}</span>
            </h3>
            <div className="ia-modes">
              {COLOUR_MODES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={entry.id === mode ? 'ia-chip ia-chip--on' : 'ia-chip'}
                  onClick={() => {
                    setMode(entry.id);
                    setNotice(entry.note);
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <ul className="ia-legend">
              {legend.map((entry) => (
                <li key={`${entry.label}-${entry.colour}`}>
                  <span className="ia-swatch" style={{ background: entry.colour }} />
                  {entry.label}
                </li>
              ))}
            </ul>
          </section>

          <section className="ia-block">
            <h3 className="ia-head">Layers</h3>
            <div className="ia-modes">
              {LAYER_MODES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={entry.id === layers ? 'ia-chip ia-chip--on' : 'ia-chip'}
                  onClick={() => {
                    setLayers(entry.id);
                    setNotice(entry.note);
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <p className="ia-fine">
              A white dwarf is not layered. It is carbon and oxygen mixed all the way
              through, with at most a thin helium skin — the onion you are watching form is
              manufactured during these two seconds, and what each part becomes is settled
              by nothing but the density there when the front arrives.
            </p>
          </section>

          <section className="ia-block">
            <h3 className="ia-head">
              View
              <span>{spin ? 'turning' : 'still'}</span>
            </h3>
            <div className="ia-modes">
              {VIEWPOINTS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="ia-chip"
                  onClick={() => viewerRef.current?.look(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            <label className="ia-field ia-field--wide">
              Turbulence
              <input
                className="ia-slider"
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={turbulence}
                aria-label="How churned the burning front is drawn"
                onChange={(event) => {
                  setTurbulence(Number(event.target.value));
                  setNotice(
                    'Scenery, not physics. The model is smooth in angle; the real deflagration is violently Rayleigh–Taylor unstable and its flame surface ends up looking like a cauliflower. This slider adds noise of about the right amplitude and scale on top of what was computed, and changes no number anywhere. It is turned down automatically once the detonation takes over, because a detonation really is the smoother of the two fronts — it moves too fast for buoyancy to do anything. Set it to zero to see the bare model.',
                  );
                }}
              />
              <span className="ia-readout">{Math.round(turbulence * 100)}%</span>
            </label>

            <label className="ia-field ia-field--wide">
              Zoom
              <input
                className="ia-slider"
                type="range"
                min={0.4}
                max={2.5}
                step={0.05}
                value={zoom}
                aria-label="Zoom"
                onChange={(event) => setZoom(Number(event.target.value))}
              />
              <span className="ia-readout">×{zoom.toFixed(2)}</span>
            </label>

            <div className="ia-toggles">
              <label className="ia-check">
                <input
                  type="checkbox"
                  checked={markers}
                  onChange={(event) => setMarkers(event.target.checked)}
                />
                Mark the front
              </label>
              <label className="ia-check">
                <input
                  type="checkbox"
                  checked={spin}
                  onChange={(event) => setSpin(event.target.checked)}
                />
                Slowly turn
              </label>
            </div>
            <p className="ia-fine">
              Inside the star the radial scale is linear, so the layers are drawn to true
              relative thickness. The star&rsquo;s overall size on screen goes as the fourth
              root of its real radius, which is the only way to keep a twentyfold expansion
              in frame; the ring carries the real number.
            </p>
          </section>

          <section className="ia-block">
            <h3 className="ia-head">
              The star
              <span>{scenarioInfo?.label}</span>
            </h3>
            <dl className="ia-stats">
              <div>
                <dt>Mass</dt>
                <dd>{(map.star.totalMass / M_SUN).toFixed(2)} M☉</dd>
              </div>
              <div>
                <dt>Radius</dt>
                <dd>{formatRadius(map.star.radius)}</dd>
              </div>
              <div>
                <dt>Central density</dt>
                <dd>{formatDensity(map.star.centralDensity)}</dd>
              </div>
              <div>
                <dt>Binding energy</dt>
                <dd>{inFoe(map.star.bindingEnergy).toFixed(3)} foe</dd>
              </div>
              <div>
                <dt>Kinetic, final</dt>
                <dd>{inFoe(map.kineticEnergy).toFixed(2)} foe</dd>
              </div>
              <div>
                <dt>Remnant</dt>
                <dd>none</dd>
              </div>
            </dl>
            {map.star.heliumMass > 0 && (
              <p className="ia-fine">
                Wearing {(map.star.heliumMass / M_SUN).toFixed(3)} M☉ of helium stolen from a
                companion. That skin is what lights the whole thing.
              </p>
            )}
          </section>
        </div>
      </div>

      {notice && <p className="ia-notice">{notice}</p>}
    </div>
  );
}
