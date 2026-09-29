import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GROUP_NAMES, GROUP_ORDER, PARTS } from './watch/layout';
import {
  ACTIVITY,
  ACTIVITY_BY_ID,
  AUTO_RATIO,
  BEATS_PER_HOUR,
  FULL_WIND,
  Movement,
  type Reading,
} from './watch/movement';
import { createViewer, type View, type Viewer, type Viewpoint } from './watch/scene';
import './watch/watch.css';

/** How fast simulated time runs against real time. */
const SPEEDS = [
  { label: '1⁄50', value: 0.02, note: 'slow enough to watch a single beat unlock' },
  { label: '1⁄5', value: 0.2, note: 'slow motion' },
  { label: '×1', value: 1, note: 'real time — five beats a second' },
  { label: '×10', value: 10, note: '' },
  { label: '×60', value: 60, note: 'a minute a second' },
  { label: '×1800', value: 1800, note: 'half an hour a second' },
  { label: '×7200', value: 7200, note: 'two hours a second — watch the reserve run out' },
] as const;

/**
 * Above this, every beat is no longer integrated one at a time; the balance is replaced by
 * its own steady state and the train is advanced in bulk. Forty hours of running is seven
 * hundred thousand beats, and nobody has the patience.
 */
const FAST_ABOVE = 60;

const GHOST = 0.22;

const VIEWS: Array<{ id: Viewpoint; label: string }> = [
  { id: 'movement', label: 'Movement' },
  { id: 'dial', label: 'Dial' },
  { id: 'escapement', label: 'Escapement' },
  { id: 'keyless', label: 'Keyless works' },
  { id: 'edge', label: 'Edge on' },
];

const PART_BY_ID = new Map(PARTS.map((part) => [part.id, part]));

function solid(): Record<string, number> {
  return Object.fromEntries(PARTS.map((part) => [part.id, 1]));
}

/**
 * The parts whose whole job is to be in the way of the interesting ones. The rotor is the
 * worst of them by a distance: it is a solid disc very nearly as wide as the movement, and
 * with it opaque there is no watch to look at at all — which is exactly the complaint
 * people have always had about automatics, and why so many of them have a skeletonised
 * rotor or none at all on the display-back version.
 */
const COVERS = new Set(['bridges', 'cock', 'dial', 'plate', 'rotor']);

function opened(): Record<string, number> {
  return Object.fromEntries(PARTS.map((part) => [part.id, COVERS.has(part.id) ? GHOST : 1]));
}

/** The canvas background, taken from the page so the scene matches the active theme. */
function pageColour(): string {
  if (typeof window === 'undefined') return '#0b1020';
  const found = getComputedStyle(document.documentElement).getPropertyValue('--code-bg').trim();
  return found || '#0b1020';
}

function clock(seconds: number): string {
  const whole = Math.floor(((seconds % 43200) + 43200) % 43200);
  const hour = Math.floor(whole / 3600) || 12;
  const minute = Math.floor((whole % 3600) / 60);
  const second = Math.floor(whole % 60);
  return `${hour}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

function duration(hours: number): string {
  if (hours >= 1) return `${hours.toFixed(1)} h`;
  return `${Math.round(hours * 60)} min`;
}

export default function WatchMovement(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const watchRef = useRef<Movement>(new Movement());
  // Deliberately not wound right up. A full mainspring is the one state where the crown
  // does nothing at all — the click is holding the ratchet against a spring with nothing
  // left to give, so the crown will not turn and neither will anything behind it, which is
  // correct and looks exactly like a broken toy. Starting it part wound means the first
  // thing anyone tries visibly drives the ratchet wheel, and leaves the rotor something to
  // do as well.
  useEffect(() => watchRef.current.setWind(3), []);

  const [speed, setSpeed] = useState(1);
  // Lifting separates the layers along the axis; spreading opens the plan out sideways.
  // Both are needed: lifting alone is invisible from straight in front, and spreading alone
  // leaves the three wheels on the barrel arbor sitting on top of each other.
  const [exploded, setExploded] = useState(0);
  const [spread, setSpread] = useState(0);
  // Starting solid would be honest and useless: a real movement seen from the back is four
  // bridges and a balance, and every part worth looking at is underneath them.
  const [opacity, setOpacity] = useState<Record<string, number>>(opened);
  const [selected, setSelected] = useState<string | null>(null);
  const [crownOut, setCrownOut] = useState(false);
  const [regulator, setRegulator] = useState(0);
  const [mainspring, setMainspring] = useState(1);
  const [activity, setActivity] = useState('walking');
  const [reading, setReading] = useState<Reading | null>(null);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);

  // Read by the animation loop, which must not be rebuilt sixty times a second.
  const live = useRef({ speed, exploded, spread, opacity, selected, crownOut });
  live.current = { speed, exploded, spread, opacity, selected, crownOut };

  // ---------------------------------------------------------------- the scene
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let viewer: Viewer;
    try {
      viewer = createViewer(canvas, pageColour());
    } catch {
      setFailed(true);
      return;
    }
    viewerRef.current = viewer;
    viewer.resize();

    const watch = watchRef.current;
    let running = true;
    let last = performance.now();
    let sinceReadout = 0;
    // The crown slides rather than teleporting, because a part that jumps reads as a
    // rendering glitch instead of a mechanism.
    let pulled = 0;

    const tick = (now: number): void => {
      if (!running) return;
      requestAnimationFrame(tick);

      const real = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { speed: rate, exploded: lift, spread: apart, opacity: shades, selected: chosen, crownOut: out } = live.current;

      if (rate > FAST_ABOVE) watch.fastForward(real * rate);
      else watch.advance(real * rate);

      pulled += ((out ? 1 : 0) - pulled) * Math.min(1, real * 12);

      const view: View = { exploded: lift, spread: apart, opacity: shades, selected: chosen, crownOut: pulled };
      viewer.draw(
        watch.pose(),
        { ...watch.wheels(), ...watch.autoWheels() },
        watch.hands(),
        watch.read(),
        view,
      );

      sinceReadout += real;
      if (sinceReadout > 0.12) {
        sinceReadout = 0;
        setReading(watch.read());
      }
    };
    requestAnimationFrame(tick);

    const onResize = (): void => viewer.resize();
    window.addEventListener('resize', onResize);
    // The site theme switcher repaints the page under us, so follow it.
    const watcher = new MutationObserver(() => viewer.setBackground(pageColour()));
    watcher.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      running = false;
      window.removeEventListener('resize', onResize);
      watcher.disconnect();
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => watchRef.current.setIndex(regulator), [regulator]);
  useEffect(() => watchRef.current.setMainspring(mainspring), [mainspring]);
  useEffect(() => {
    const wrist = ACTIVITY_BY_ID.get(activity);
    if (wrist) watchRef.current.setWrist(wrist);
  }, [activity]);

  // ---------------------------------------------------------------- the crown

  /**
   * Dragging the crown. Up and down the screen turns it, because the crown sticks out at
   * three o'clock and that is the direction your fingers would move.
   *
   * What the turn *does* is not decided here. It is handed to the movement, which knows
   * whether the sliding pinion is coupled to the winding pinion or to the setting wheel,
   * and how much of the turn it is prepared to accept — a fully wound mainspring refuses
   * it outright, which is what makes the crown stop dead.
   */
  const drag = useRef<{ y: number; moved: number } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (viewer.onCrown(event.clientX, event.clientY)) {
      drag.current = { y: event.clientY, moved: 0 };
      viewer.setOrbit(false);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    drag.current = { y: event.clientY, moved: -1 };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const held = drag.current;
    if (!held || held.moved < 0) return;
    const shift = held.y - event.clientY;
    held.y = event.clientY;
    held.moved += Math.abs(shift);
    // Ninety pixels to the turn, which is about how far a real crown goes per grab.
    const taken = watchRef.current.turnCrown(shift / 90);
    if (taken < shift / 90 - 1e-6 && !crownOut) {
      setNotice('Fully wound. The crown will not go any further — the click is holding the ratchet wheel against a spring that has nothing left to give.');
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const held = drag.current;
    drag.current = null;
    viewerRef.current?.setOrbit(true);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // A drag that started and ended on the canvas still fires a click, so only a press
    // that barely moved counts as aiming at something.
    if (!held || held.moved > 5) return;
    const hit = viewerRef.current?.pick(event.clientX, event.clientY) ?? null;
    setSelected(hit);
    setNotice(hit ? (PART_BY_ID.get(hit)?.note ?? '') : '');
  };

  const pull = (out: boolean): void => {
    setCrownOut(out);
    watchRef.current.pullCrown(out);
    setNotice(
      out
        ? 'Crown out. The sliding pinion has let go of the winding pinion and taken up with the setting wheel, so turning the crown now moves the hands — and note that the seconds hand carries on regardless, because it is upstream of the slip.'
        : 'Crown in. Turning it winds the mainspring; turning it the other way does nothing but click.',
    );
  };

  // ---------------------------------------------------------------- transparency

  const fade = useCallback((id: string, value: number): void => {
    setOpacity((current) => ({ ...current, [id]: value }));
  }, []);

  /**
   * Fly the camera in until one part fills the frame. Anything in front of it is knocked
   * down to a ghost on the way, because half of these parts are a millimetre across and
   * live under a bridge, and framing one without clearing the way just fills the screen
   * with the underside of the thing on top of it.
   */
  const study = useCallback((id: string): void => {
    setSelected(id);
    setOpacity((current) => {
      const next = { ...current };
      next[id] = 1;
      for (const cover of COVERS) if (cover !== id) next[cover] = Math.min(next[cover] ?? 1, GHOST);
      return next;
    });
    setNotice(PART_BY_ID.get(id)?.note ?? '');
    // After the fade, so the viewer measures the part where this frame will actually put it.
    requestAnimationFrame(() => viewerRef.current?.study(id));
  }, []);

  const preset = (which: 'solid' | 'xray' | 'open' | 'escapement'): void => {
    if (which === 'solid') {
      setOpacity(solid());
      setNotice('');
      return;
    }
    if (which === 'xray') {
      setOpacity(Object.fromEntries(PARTS.map((part) => [part.id, GHOST])));
      setNotice('Everything at a fifth. This is the only way to see the whole thing at once, and it is also roughly useless — which is why the other two buttons exist.');
      return;
    }
    if (which === 'open') {
      setOpacity(opened());
      setNotice('Bridges, cock, plate and dial faded. This is the view a watchmaker gets by taking four screws out.');
      return;
    }
    const keep = new Set(['escapeWheel', 'pallet', 'balance', 'hairspring', 'fourth', 'jewels']);
    setOpacity(Object.fromEntries(PARTS.map((part) => [part.id, keep.has(part.id) ? 1 : 0.07])));
    setNotice('Everything but the escapement faded almost away. Slow the speed right down and watch one beat: unlock, impulse, drop, lock.');
  };

  const chosen = selected ? PART_BY_ID.get(selected) : null;
  const chosenOpacity = selected ? (opacity[selected] ?? 1) : 1;

  const amplitudeWidth = useMemo(() => {
    if (!reading?.running) return 0;
    return Math.min(100, (reading.amplitude / 330) * 100);
  }, [reading]);

  // The two numbers that decide whether an automatic stays wound, and the only comparison
  // that matters in the whole of self-winding: turns an hour in against turns an hour out.
  const winding = reading?.windingRate ?? 0;
  const spending = reading?.spendRate ?? 0;

  if (failed) {
    return (
      <div className="wm">
        <p className="wm-notice">This browser could not start WebGL, so the movement cannot be drawn.</p>
      </div>
    );
  }

  return (
    <div className="wm">
      <div className="wm-bar">
        <span className="wm-field">
          Speed
          <select
            className="wm-select"
            value={speed}
            aria-label="How fast simulated time runs"
            onChange={(event) => setSpeed(Number(event.target.value))}
          >
            {SPEEDS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
                {entry.note ? ` — ${entry.note}` : ''}
              </option>
            ))}
          </select>
        </span>

        <span className="wm-field">
          Wrist
          <select
            className="wm-select"
            value={activity}
            aria-label="What the wearer is doing, which is what drives the rotor"
            onChange={(event) => {
              setActivity(event.target.value);
              setNotice(ACTIVITY_BY_ID.get(event.target.value)?.note ?? '');
            }}
          >
            {ACTIVITY.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </span>

        <button type="button" className={crownOut ? 'wm-btn wm-btn--primary' : 'wm-btn'} onClick={() => pull(!crownOut)}>
          {crownOut ? 'Push the crown in' : 'Pull the crown out'}
        </button>
        <button
          type="button"
          className="wm-btn"
          onClick={() => {
            watchRef.current.fullWind();
            setNotice('Wound right up. Five and a half turns in the barrel, and about forty hours of running.');
          }}
        >
          Wind fully
        </button>
        <button
          type="button"
          className="wm-btn wm-btn--quiet"
          onClick={() => {
            watchRef.current.letDown();
            setNotice('Mainspring let down. The balance will ring on for a few seconds and then stop.');
          }}
        >
          Let it down
        </button>

        <span className="wm-spacer" />

        <span className="wm-field">
          Lift
          <input
            className="wm-slider"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={exploded}
            aria-label="Lift the parts apart along the axis of the movement"
            onChange={(event) => setExploded(Number(event.target.value))}
          />
        </span>

        <span className="wm-field">
          Spread
          <input
            className="wm-slider"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={spread}
            aria-label="Spread the parts apart across the plan of the movement"
            onChange={(event) => {
              setSpread(Number(event.target.value));
              setNotice(
                'The plan is a dilation about the middle of the watch, so every distance between every pair of parts grows by the same factor and nothing can end up on top of anything else.',
              );
            }}
          />
        </span>

        <button
          type="button"
          className="wm-btn wm-btn--quiet"
          disabled={exploded === 0 && spread === 0}
          onClick={() => {
            setExploded(0);
            setSpread(0);
            setNotice('Back together. Nothing was moved relative to anything else — the parts only ever slid along two axes.');
          }}
        >
          Reassemble
        </button>
      </div>

      <div className="wm-views">
        {VIEWS.map((entry) => (
          <button key={entry.id} type="button" className="wm-chip" onClick={() => viewerRef.current?.look(entry.id)}>
            {entry.label}
          </button>
        ))}
        <span className="wm-spacer" />
        <button type="button" className="wm-chip" onClick={() => preset('solid')}>
          All solid
        </button>
        <button type="button" className="wm-chip" onClick={() => preset('open')}>
          Bridges off
        </button>
        <button type="button" className="wm-chip" onClick={() => preset('escapement')}>
          Escapement only
        </button>
        <button type="button" className="wm-chip" onClick={() => preset('xray')}>
          X-ray
        </button>
      </div>

      <div className="wm-panes">
        <div className="wm-stage">
          <canvas
            ref={canvasRef}
            className="wm-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-label="A 3D watch movement. Drag to rotate, drag the crown to wind or set it, click a part to select it."
          />
          <p className="wm-legend">
            drag to rotate · drag <strong>the crown</strong> to wind and set · click any part to fade it
          </p>
        </div>

        <div className="wm-side">
          <section className="wm-block">
            <h3 className="wm-head">
              Going
              <span>{reading?.running ? (reading.knocking ? 'knocking' : reading.phase) : 'stopped'}</span>
            </h3>

            <p className="wm-time">{reading ? clock(reading.shown) : '—'}</p>

            <div className="wm-gauge">
              <span className="wm-gauge-name">Amplitude</span>
              <span className="wm-gauge-track">
                <span
                  className={reading?.knocking ? 'wm-gauge-fill wm-gauge-fill--bad' : 'wm-gauge-fill'}
                  style={{ width: `${amplitudeWidth}%` }}
                />
              </span>
              <span className="wm-gauge-value">
                {reading?.running ? `${Math.round(reading.amplitude)}°` : '—'}
              </span>
            </div>

            <div className="wm-gauge">
              <span className="wm-gauge-name">Wind</span>
              <span className="wm-gauge-track">
                <span
                  className="wm-gauge-fill wm-gauge-fill--wind"
                  style={{ width: `${((reading?.wind ?? 0) / FULL_WIND) * 100}%` }}
                />
              </span>
              <span className="wm-gauge-value">{(reading?.wind ?? 0).toFixed(2)} turns</span>
            </div>

            <dl className="wm-stats">
              <div>
                <dt>Rate</dt>
                <dd>
                  {reading?.running
                    ? `${reading.rate >= 0 ? '+' : ''}${reading.rate.toFixed(1)} s/day`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>Beat</dt>
                <dd>{reading?.running ? `${Math.round(reading.beatRate)} /h` : `${BEATS_PER_HOUR} /h`}</dd>
              </div>
              <div>
                <dt>Reserve</dt>
                <dd>{duration(reading?.reserve ?? 0)}</dd>
              </div>
              <div>
                <dt>Torque</dt>
                <dd>{((reading?.escapeTorque ?? 0) * 1e9).toFixed(0)} nN·m</dd>
              </div>
            </dl>

            {reading && !reading.running && (
              <p className="wm-warn">
                Stopped. {reading.wind > 0.02
                  ? 'There is still tension in the mainspring, but not enough to push the balance through the lock. Wind it, or give it a shake.'
                  : 'The mainspring is slack. Wind it.'}
                <button
                  type="button"
                  className="wm-btn wm-btn--quiet"
                  onClick={() => {
                    watchRef.current.kick();
                    setNotice('Shaken. A wound watch that has stopped only needs the balance set going once.');
                  }}
                >
                  Shake it
                </button>
              </p>
            )}
            {reading?.knocking && (
              <p className="wm-warn">
                Knocking. The balance is swinging so far that the impulse jewel comes right round
                and strikes the outside of the fork horn. The rate is worthless while this is happening.
              </p>
            )}
          </section>

          <section className="wm-block">
            <h3 className="wm-head">
              Self-winding
              <span>{reading?.slipping ? 'bridle slipping' : winding > spending ? 'gaining' : 'losing'}</span>
            </h3>

            <dl className="wm-stats">
              <div>
                <dt>Rotor</dt>
                <dd>{reading ? `${Math.round(reading.rotorSpeed)} rpm` : '—'}</dd>
              </div>
              <div>
                <dt>Reduction</dt>
                <dd>{AUTO_RATIO}:1</dd>
              </div>
              <div>
                <dt>Winding</dt>
                <dd>{winding.toFixed(2)} turns/h</dd>
              </div>
              <div>
                <dt>Spending</dt>
                <dd>{spending.toFixed(2)} turns/h</dd>
              </div>
              <div>
                <dt>Balance</dt>
                <dd className={winding >= spending ? '' : 'wm-stat--bad'}>
                  {spending > 0 ? `${(winding / spending).toFixed(1)}×` : '—'}
                </dd>
              </div>
              <div>
                <dt>Slipped</dt>
                <dd>{(reading?.slipped ?? 0).toFixed(0)} turns</dd>
              </div>
            </dl>

            {reading?.slipping && (
              <p className="wm-warn">
                The spring is full and the bridle is slipping. The rotor is still turning and the
                arbor is still being wound; the turns are simply going nowhere, because the
                spring’s outer end is sliding round the barrel wall as fast as they arrive.
                Without this a day’s walking would break the mainspring.
              </p>
            )}
            {reading && !reading.slipping && winding < spending && (
              <p className="wm-warn">
                {activity === 'off'
                  ? 'Lying flat, gravity points straight down the rotor’s axis and it has no leverage on it at all. Nothing is winding; the watch is simply running down.'
                  : 'The rotor is not keeping up with the train. It will settle somewhere short of full and stay there, which is what happens to an automatic on a wrist that barely moves.'}
              </p>
            )}
          </section>

          <section className="wm-block">
            <h3 className="wm-head">
              Adjustment
              <span>the only two a watch has</span>
            </h3>
            <label className="wm-field wm-field--wide">
              Regulator
              <input
                className="wm-slider"
                type="range"
                min={-1}
                max={1}
                step={0.02}
                value={regulator}
                aria-label="Regulator index, slow to fast"
                onChange={(event) => setRegulator(Number(event.target.value))}
              />
              <span className="wm-readout">{regulator > 0 ? `F ${regulator.toFixed(2)}` : `S ${(-regulator).toFixed(2)}`}</span>
            </label>
            <label className="wm-field wm-field--wide">
              Mainspring
              <input
                className="wm-slider"
                type="range"
                min={0.4}
                max={2}
                step={0.05}
                value={mainspring}
                aria-label="Mainspring strength, as a multiple of the correct one"
                onChange={(event) => setMainspring(Number(event.target.value))}
              />
              <span className="wm-readout">{mainspring.toFixed(2)}×</span>
            </label>
          </section>

          <section className="wm-block wm-block--parts">
            <h3 className="wm-head">
              Parts
              <span>click to select · fade to see behind</span>
            </h3>
            {GROUP_ORDER.map((group) => (
              <div key={group} className="wm-group">
                <span className="wm-group-name">{GROUP_NAMES[group]}</span>
                <ul className="wm-list">
                  {PARTS.filter((part) => part.group === group).map((part) => {
                    const shade = opacity[part.id] ?? 1;
                    return (
                      <li key={part.id} className={part.id === selected ? 'wm-part wm-part--on' : 'wm-part'}>
                        <button
                          type="button"
                          className="wm-part-name"
                          onClick={() => {
                            setSelected(part.id);
                            setNotice(part.note);
                          }}
                        >
                          {part.label}
                        </button>
                        <span className="wm-shades">
                          {(
                            [
                              [1, 'solid', '●'],
                              [GHOST, 'see-through', '◐'],
                              [0, 'hidden', '○'],
                            ] as const
                          ).map(([value, name, glyph]) => (
                            <button
                              key={name}
                              type="button"
                              className={Math.abs(shade - value) < 0.02 ? 'wm-shade wm-shade--on' : 'wm-shade'}
                              title={`${part.label}: ${name}`}
                              aria-label={`${part.label}: ${name}`}
                              onClick={() => fade(part.id, value)}
                            >
                              {glyph}
                            </button>
                          ))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        </div>
      </div>

      {(notice || chosen) && (
        <div className="wm-detail">
          {chosen && (
            <p className="wm-detail-head">
              {chosen.label}
              <label className="wm-field">
                fade
                <input
                  className="wm-slider wm-slider--short"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={chosenOpacity}
                  aria-label={`How solid ${chosen.label} is drawn`}
                  onChange={(event) => fade(chosen.id, Number(event.target.value))}
                />
              </label>
              <button type="button" className="wm-btn wm-btn--quiet" onClick={() => study(chosen.id)}>
                Look closely
              </button>
            </p>
          )}
          {notice && <p className="wm-notice">{notice}</p>}
        </div>
      )}
    </div>
  );
}
