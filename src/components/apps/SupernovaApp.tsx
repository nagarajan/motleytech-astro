import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COLOUR_MODES, legendFor, type ColourMode } from './supernova/colour';
import { M_SUN, R_SUN } from './supernova/constants';
import { createViewer, type View, type Viewer, type Viewpoint } from './supernova/scene';
import { PHASE_LABEL, type Frame, type Phase, type RunResult, type WorkerMessage } from './supernova/types';
import './supernova/supernova.css';

/**
 * How far past bounce the run goes. Shock breakout happens around eighteen hours in, and
 * stopping before it would leave out the only part of the whole event that anybody has
 * ever actually seen.
 */
const END_TIME = 2e5; // s

/**
 * Frames are recorded on a logarithmic grid in time, so stepping through them at a steady
 * rate is already slow motion — and it is slow motion that automatically gets slower the
 * more interesting things get. The first millisecond after bounce gets as many frames as
 * the following ten hours. This is the only way a single playback covers eight orders of
 * magnitude without either skipping the bounce or taking a week to reach the surface.
 */
const BASE_FPS = 22;

const SPEEDS = [
  { label: '⅛', value: 0.125 },
  { label: '¼', value: 0.25 },
  { label: '½', value: 0.5 },
  { label: '×1', value: 1 },
  { label: '×2', value: 2 },
  { label: '×4', value: 4 },
];

/** The inner edge of the radial axis: about eight kilometres, well inside the neutron star. */
const LOG_MIN = 5.9;

const VIEWPOINTS: { id: Viewpoint; label: string }[] = [
  { id: 'face', label: 'Cut face' },
  { id: 'angle', label: 'Three-quarter' },
  { id: 'edge', label: 'Edge on' },
  { id: 'behind', label: 'Behind' },
];

const PHASE_ORDER: Phase[] = [
  'infall',
  'collapse',
  'bounce',
  'stalled',
  'reviving',
  'exploding',
  'coasting',
  'breakout',
  'failed',
];

// ---------------------------------------------------------------- formatting

function formatTime(seconds: number): string {
  const size = Math.abs(seconds);
  if (size < 1e-9) return '0';
  if (size < 1e-3) return `${(seconds * 1e6).toFixed(0)} µs`;
  if (size < 1) return `${(seconds * 1e3).toFixed(size < 0.01 ? 2 : 1)} ms`;
  if (size < 90) return `${seconds.toFixed(2)} s`;
  if (size < 5400) return `${(seconds / 60).toFixed(1)} min`;
  if (size < 1.728e5) return `${(seconds / 3600).toFixed(2)} h`;
  return `${(seconds / 86400).toFixed(2)} days`;
}

function formatRadius(cm: number): string {
  if (!(cm > 0)) return '—';
  const km = cm / 1e5;
  if (km < 1000) return `${km < 100 ? km.toFixed(1) : km.toFixed(0)} km`;
  if (cm < 0.02 * R_SUN) return `${Math.round(km).toLocaleString('en-US')} km`;
  return `${(cm / R_SUN).toFixed(cm < 10 * R_SUN ? 2 : 0)} R☉`;
}

function formatDensity(value: number): string {
  if (!(value > 0)) return '—';
  const power = Math.floor(Math.log10(value));
  const mantissa = value / Math.pow(10, power);
  return `${mantissa.toFixed(1)}\u00d710${superscript(power)} g/cm³`;
}

function superscript(n: number): string {
  const digits = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const sign = n < 0 ? '⁻' : '';
  return sign + String(Math.abs(n)).split('').map((d) => digits[Number(d)]).join('');
}

/**
 * The canvas background. Fixed rather than taken from the page theme, which the other
 * demos here do: space is black in both light mode and dark mode, and a starfield on a
 * pale background is not a starfield.
 */
const SPACE = '#04060e';

// ---------------------------------------------------------------- component

export default function SupernovaApp(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const runRef = useRef<RunResult | null>(null);

  const [run, setRun] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressNote, setProgressNote] = useState('');
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const [mode, setMode] = useState<ColourMode>('composition');
  const [logMax, setLogMax] = useState(9.2);
  const [autoZoom, setAutoZoom] = useState(true);
  const [asymmetry, setAsymmetry] = useState(0.45);
  const [markers, setMarkers] = useState(true);
  const [gridlines, setGridlines] = useState(true);
  const [spin, setSpin] = useState(false);

  /** What the next run will use. Changing it does not disturb the run already loaded. */
  const [heating, setHeating] = useState(1.0);
  const [ranWith, setRanWith] = useState<number | null>(null);

  const [notice, setNotice] = useState('');

  // Read by the animation loop, which must not be torn down and rebuilt on every keystroke.
  const live = useRef({ playing, speed, mode, logMax, autoZoom, asymmetry, markers, gridlines });
  live.current = { playing, speed, mode, logMax, autoZoom, asymmetry, markers, gridlines };

  /**
   * Where playback actually is, as a fractional frame. React state cannot hold this: the
   * loop runs every sixteen milliseconds and a state update does not land until the next
   * render, so a loop that read its own position back out of state would be working from a
   * number one or two frames stale and would stutter. The ref is the truth, and `index` is
   * a copy of it kept for the parts of the interface that have to re-render.
   */
  const positionRef = useRef(0);

  const goTo = useCallback((next: number) => {
    const limit = (runRef.current?.frames.length ?? 1) - 1;
    const clamped = Math.max(0, Math.min(limit, next));
    positionRef.current = clamped;
    setIndex(clamped);
  }, []);

  const frame: Frame | null = run && run.frames[Math.min(index, run.frames.length - 1)];

  // ---------------------------------------------------------------- the scene

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let viewer: Viewer;
    try {
      viewer = createViewer(canvas, SPACE);
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

      const current = runRef.current;
      if (!current) return;
      const settings = live.current;
      const lastFrame = current.frames.length - 1;

      if (settings.playing) {
        positionRef.current = Math.min(
          lastFrame,
          positionRef.current + elapsed * BASE_FPS * settings.speed,
        );
        if (positionRef.current >= lastFrame) setPlaying(false);
      }

      const at = Math.min(Math.floor(positionRef.current), lastFrame);
      if (at !== announced) {
        announced = at;
        setIndex(at);
      }
      const shown = current.frames[at];

      // Auto zoom keeps the shock at about two fifths of the way out, which is the only
      // setting that works across the whole run: fixed at the core you lose the explosion
      // within a second, fixed at the star you cannot see the bounce at all. Before there
      // is a shock there is nothing to follow, so it holds at four thousand kilometres,
      // which frames the iron core and the bottom of the silicon shell — the part that is
      // about to fall.
      let top = settings.logMax;
      if (settings.autoZoom) {
        const interesting = shown.shockRadius > 0 ? shown.shockRadius * 2.5 : 4e8;
        const surface = shown.r[current.count];
        top = Math.min(Math.log10(Math.min(interesting, surface * 1.02)), Math.log10(surface) + 0.02);
        top = Math.max(top, LOG_MIN + 1.2);
      }

      const view: View = {
        mode: settings.mode,
        logMin: LOG_MIN,
        logMax: top,
        asymmetry: settings.asymmetry,
        markers: settings.markers,
        gridlines: settings.gridlines,
      };
      viewer.draw(shown, current, view, clock);
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

  // ---------------------------------------------------------------- the solver

  useEffect(() => () => workerRef.current?.terminate(), []);

  const start = useCallback(
    (factor: number) => {
      workerRef.current?.terminate();
      setBusy(true);
      setError('');
      setProgress(0);
      setProgressNote('starting');
      setPlaying(false);
      setRun(null);
      runRef.current = null;

      const worker = new Worker(new URL('./supernova/worker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current = worker;

      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.kind === 'progress') {
          setProgress(message.fraction);
          setProgressNote(message.note);
          return;
        }
        if (message.kind === 'error') {
          setBusy(false);
          setError(message.message);
          worker.terminate();
          workerRef.current = null;
          return;
        }
        runRef.current = message.result;
        setRun(message.result);
        setFailed(message.result.failed);
        setRanWith(factor);
        positionRef.current = 0;
        setIndex(0);
        setBusy(false);
        setNotice(
          message.result.failed
            ? 'This one did not explode. The shock stalled, never recovered, and was swallowed — the star collapses to a black hole and nothing comes out. About a quarter of massive stars are thought to end this way, and they simply vanish from the sky.'
            : `Done in ${(message.result.elapsed / 1000).toFixed(0)} seconds of arithmetic. Press play. The first frames are microseconds apart and the last are hours apart, which is the only way to watch all of it.`,
        );
        worker.terminate();
        workerRef.current = null;
      };

      worker.postMessage({ heatingFactor: factor, endTime: END_TIME });
    },
    [],
  );

  // ---------------------------------------------------------------- derived

  /** The first frame of each phase, for the jump buttons. */
  const chapters = useMemo(() => {
    if (!run) return [] as { phase: Phase; at: number }[];
    const found: { phase: Phase; at: number }[] = [];
    const seen = new Set<Phase>();
    run.frames.forEach((f, i) => {
      if (seen.has(f.phase)) return;
      seen.add(f.phase);
      found.push({ phase: f.phase, at: i });
    });
    return found.sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase));
  }, [run]);

  /**
   * How much star-time one second of watching covers, right here. This is the number that
   * makes the logarithmic clock honest: it starts at about a microsecond a second and ends
   * at about an hour a second, and both of those are on the same slider.
   */
  const slowMotion = useMemo(() => {
    if (!run || index >= run.frames.length - 1) return 0;
    const gap = run.frames[index + 1].sinceBounce - run.frames[index].sinceBounce;
    return gap * BASE_FPS * speed;
  }, [run, index, speed]);

  const legend = useMemo(() => legendFor(mode), [mode]);
  const modeInfo = COLOUR_MODES.find((m) => m.id === mode);

  const step = useCallback(
    (delta: number) => {
      setPlaying(false);
      goTo(Math.floor(positionRef.current) + delta);
    },
    [goTo],
  );

  // Arrow keys step, space plays. Only while the canvas area has focus, so the page can
  // still be scrolled with the keyboard.
  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (!run) return;
    if (event.key === 'ArrowRight') {
      step(event.shiftKey ? 10 : 1);
      event.preventDefault();
    } else if (event.key === 'ArrowLeft') {
      step(event.shiftKey ? -10 : -1);
      event.preventDefault();
    } else if (event.key === ' ') {
      setPlaying((p) => !p);
      event.preventDefault();
    }
  };

  // ---------------------------------------------------------------- render

  const dirty = ranWith !== null && Math.abs(ranWith - heating) > 1e-6;

  return (
    <div className="sn">
      <div className="sn-bar">
        <button
          type="button"
          className="sn-btn sn-btn--primary"
          disabled={busy}
          onClick={() => start(heating)}
        >
          {busy ? 'Collapsing…' : run ? 'Run it again' : 'Collapse the star'}
        </button>

        <label className="sn-field sn-field--wide">
          Neutrino heating
          <input
            className="sn-slider"
            type="range"
            min={0.5}
            max={1.8}
            step={0.05}
            value={heating}
            disabled={busy}
            aria-label="How efficiently neutrinos deposit energy behind the stalled shock"
            onChange={(event) => setHeating(Number(event.target.value))}
          />
          <span className="sn-readout">×{heating.toFixed(2)}</span>
        </label>

        {dirty && !busy && (
          <span className="sn-dirty">
            changed — run it again to see the difference
          </span>
        )}

        <span className="sn-spacer" />

        <span className="sn-field">
          Speed
          <select
            className="sn-select"
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

        <button type="button" className="sn-btn" disabled={!run} onClick={() => step(-1)}>
          ◀ Step
        </button>
        <button
          type="button"
          className={playing ? 'sn-btn sn-btn--primary' : 'sn-btn'}
          disabled={!run}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="sn-btn" disabled={!run} onClick={() => step(1)}>
          Step ▶
        </button>
      </div>

      {busy && (
        <div className="sn-progress">
          <span className="sn-progress-track">
            <span className="sn-progress-fill" style={{ width: `${progress * 100}%` }} />
          </span>
          <span className="sn-progress-note">{progressNote}</span>
        </div>
      )}

      {error && <p className="sn-warn">{error}</p>}

      {run && (
        <div className="sn-scrub">
          <input
            className="sn-time"
            type="range"
            min={0}
            max={run.frames.length - 1}
            step={1}
            value={index}
            aria-label="Move through the collapse"
            onChange={(event) => {
              setPlaying(false);
              goTo(Number(event.target.value));
            }}
          />
          <span className="sn-clock">
            {frame && frame.sinceBounce < 0
              ? `${formatTime(-frame.sinceBounce)} before bounce`
              : `${formatTime(frame?.sinceBounce ?? 0)} after bounce`}
          </span>
        </div>
      )}

      {run && chapters.length > 0 && (
        <div className="sn-chapters">
          {chapters.map((chapter) => (
            <button
              key={chapter.phase}
              type="button"
              className={frame?.phase === chapter.phase ? 'sn-chip sn-chip--on' : 'sn-chip'}
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
      )}

      <div className="sn-panes">
        <div className="sn-stage">
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
          <canvas
            ref={canvasRef}
            className="sn-canvas"
            tabIndex={0}
            onKeyDown={onKeyDown}
            aria-label="A star in cross-section, cut in half. Drag to orbit, scroll to move the camera."
          />
          {!run && !busy && (
            <div className="sn-splash">
              <p>
                Twelve and a half solar masses of star, on the last day of its life. Press
                <strong> Collapse the star</strong>.
              </p>
              <p className="sn-splash-small">
                It takes about a minute. Every frame after that is solved, not drawn: five
                hundred shells of gas, an equation of state, and a hundred thousand
                timesteps.
              </p>
            </div>
          )}
          <p className="sn-legend-line">
            drag to orbit · scroll to zoom the camera · ← → to step · space to play
          </p>
        </div>

        <div className="sn-side">
          {frame && (
            <section className="sn-block">
              <h3 className="sn-head">
                {PHASE_LABEL[frame.phase]}
                <span>{formatTime(frame.sinceBounce)}</span>
              </h3>
              <dl className="sn-stats">
                <div>
                  <dt>Shock</dt>
                  <dd>{formatRadius(frame.shockRadius)}</dd>
                </div>
                <div>
                  <dt>Neutron star</dt>
                  <dd>
                    {formatRadius(frame.coreRadius)} · {(frame.coreMass / M_SUN).toFixed(3)} M☉
                  </dd>
                </div>
                <div>
                  <dt>Central density</dt>
                  <dd>{formatDensity(frame.centralDensity)}</dd>
                </div>
                <div>
                  <dt>Neutrino power</dt>
                  <dd>
                    {frame.neutrinoLuminosity > 0
                      ? `10${superscript(Math.round(Math.log10(frame.neutrinoLuminosity)))} erg/s`
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt>Carried off</dt>
                  <dd>{(frame.neutrinoEnergy / 1e51).toFixed(1)} foe</dd>
                </div>
                <div>
                  <dt>Explosion energy</dt>
                  <dd className={frame.explosionEnergy > 0 ? 'sn-stat--good' : ''}>
                    {(frame.explosionEnergy / 1e51).toFixed(3)} foe
                  </dd>
                </div>
                <div>
                  <dt>Nickel-56</dt>
                  <dd>{(frame.nickel / M_SUN).toFixed(3)} M☉</dd>
                </div>
                <div>
                  <dt>Fastest ejecta</dt>
                  <dd>{Math.round(frame.peakVelocity / 1e5).toLocaleString('en-US')} km/s</dd>
                </div>
              </dl>
              {slowMotion > 0 && (
                <p className="sn-slowmo">
                  One second of watching covers <strong>{formatTime(slowMotion)}</strong> of
                  the star.
                </p>
              )}
            </section>
          )}

          <section className="sn-block">
            <h3 className="sn-head">
              Colour
              <span>{modeInfo?.label}</span>
            </h3>
            <div className="sn-modes">
              {COLOUR_MODES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={entry.id === mode ? 'sn-chip sn-chip--on' : 'sn-chip'}
                  onClick={() => {
                    setMode(entry.id);
                    setNotice(entry.note);
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <ul className="sn-legend">
              {legend.map((entry) => (
                <li key={`${entry.label}-${entry.colour}`}>
                  <span className="sn-swatch" style={{ background: entry.colour }} />
                  {entry.label}
                </li>
              ))}
            </ul>
          </section>

          <section className="sn-block">
            <h3 className="sn-head">
              View
              <span>{autoZoom ? 'following the shock' : 'fixed'}</span>
            </h3>
            <div className="sn-modes">
              {VIEWPOINTS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="sn-chip"
                  onClick={() => viewerRef.current?.look(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            <label className="sn-field sn-field--wide">
              Out to
              <input
                className="sn-slider"
                type="range"
                min={7}
                max={14.3}
                step={0.05}
                value={logMax}
                disabled={autoZoom}
                aria-label="How far out the picture reaches"
                onChange={(event) => setLogMax(Number(event.target.value))}
              />
              <span className="sn-readout">{formatRadius(Math.pow(10, logMax))}</span>
            </label>

            <label className="sn-field sn-field--wide">
              Asymmetry
              <input
                className="sn-slider"
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={asymmetry}
                aria-label="Strength of the illustrative multidimensional overlay"
                onChange={(event) => {
                  setAsymmetry(Number(event.target.value));
                  setNotice(
                    'This one is honest scenery rather than physics. The model is spherical, and a spherical supernova is one that mostly fails; what revives the shock in nature is convection and sloshing that a one-dimensional calculation cannot represent. The overlay bends the front by the angular patterns and on the timescales that three-dimensional simulations produce, but nothing in the numbers below changes when you drag it. Set it to zero to see what was actually computed.',
                  );
                }}
              />
              <span className="sn-readout">{Math.round(asymmetry * 100)}%</span>
            </label>

            <div className="sn-toggles">
              <label className="sn-check">
                <input
                  type="checkbox"
                  checked={autoZoom}
                  onChange={(event) => setAutoZoom(event.target.checked)}
                />
                Follow the shock
              </label>
              <label className="sn-check">
                <input
                  type="checkbox"
                  checked={gridlines}
                  onChange={(event) => setGridlines(event.target.checked)}
                />
                Decade rings
              </label>
              <label className="sn-check">
                <input
                  type="checkbox"
                  checked={markers}
                  onChange={(event) => setMarkers(event.target.checked)}
                />
                Shock marker
              </label>
              <label className="sn-check">
                <input type="checkbox" checked={spin} onChange={(event) => setSpin(event.target.checked)} />
                Slowly turn
              </label>
            </div>
            <p className="sn-fine">
              The radial axis is logarithmic: each ring is a factor of ten. It has to be —
              the neutron star is twelve kilometres across and the envelope reaches six
              hundred million.
            </p>
          </section>

          {run && (
            <section className="sn-block">
              <h3 className="sn-head">
                This run
                <span>{failed ? 'black hole' : 'supernova'}</span>
              </h3>
              <dl className="sn-stats">
                <div>
                  <dt>Progenitor</dt>
                  <dd>{(run.totalMass / M_SUN).toFixed(2)} M☉</dd>
                </div>
                <div>
                  <dt>Heating</dt>
                  <dd>×{run.settings.heatingFactor.toFixed(2)}</dd>
                </div>
                <div>
                  <dt>Shells</dt>
                  <dd>{run.count}</dd>
                </div>
                <div>
                  <dt>Timesteps</dt>
                  <dd>{run.steps.toLocaleString('en-US')}</dd>
                </div>
              </dl>
              <ul className="sn-layers">
                {run.layers.map((layer) => (
                  <li key={layer.name}>
                    <span>{layer.name}</span>
                    <span>
                      to {formatRadius(layer.outer)} · {(layer.outerMass / M_SUN).toFixed(2)} M☉
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {notice && <p className="sn-notice">{notice}</p>}
    </div>
  );
}

const PHASE_NOTE: Record<Phase, string> = {
  infall:
    'The last day. Silicon is burning in a shell and dropping ash onto an iron core that is already close to the Chandrasekhar mass. Nothing here can release energy by fusing: iron is the bottom of the binding-energy curve, and the core is held up by degenerate electrons alone.',
  collapse:
    'The core has stopped being able to hold itself up, and this is the part everybody gets wrong. It is not that iron starts fusing — iron cannot fuse and give anything back. Two things take the pressure away: photons energetic enough to smash nuclei back into helium and then into free nucleons, and electrons being captured onto those nucleons. The first eats energy, the second removes the very particles doing the supporting. Inside a second the middle of the star falls at a quarter of the speed of light.',
  bounce:
    'Nuclear matter. At about 2.7×10¹⁴ grams per cubic centimetre the nuclei have merged into one fluid and the strong force turns sharply repulsive — the stiffest thing in the universe. The inner core overshoots, stops, and rebounds into the material still falling on it, and that collision is the shock.',
  stalled:
    'And the shock fails. It has to climb out through the rest of the iron core, and every gram it passes costs it about nine million electron-volts per nucleon to break apart — the shock spends its own energy undoing what the star took a million years to build. Within about twenty milliseconds it has stopped, at somewhere between 150 and 250 kilometres, and just sits there while matter keeps raining through it.',
  reviving:
    'Neutrinos. The new neutron star is radiating 10⁵³ erg/s, and although only a fraction of a percent of that is absorbed in the layer just under the shock, a fraction of a percent of that number is enough. This is the delayed neutrino-driven mechanism, and in a spherical model like this one it is borderline on purpose — that is what the heating slider is for.',
  exploding:
    'Unbound. The shock is moving out again and the energy of the material behind it has gone positive. Watch the nickel-56 count start climbing: the shock is now hot enough to burn silicon and oxygen to iron-group as it passes, and it is that nickel decaying that will light the supernova for months.',
  coasting:
    'Out through the envelope. The shock has left the heavy layers behind and is crossing helium and then hydrogen, and it slows and speeds up as it meets each density change. Nothing outside knows yet: the star still looks exactly as it did.',
  breakout:
    'Shock breakout. The front reaches the surface after about eighteen hours, and the star does in a few minutes what it has not done in ten million years — it changes. This flash of ultraviolet and soft X-rays is the first light of the supernova, and it arrives hours before the visible brightening.',
  failed:
    'No explosion. The shock never recovered, the neutron star kept accreting past what the nuclear equation of state can hold up, and the whole star is going down the hole. There is no supernova; the star just disappears. Current estimates put something like a quarter of massive stars in this category.',
};
