import { type CSSProperties, type ReactElement, useEffect, useMemo, useState } from 'react';
import { buildFrames, HEAD_SPOT, parseInput } from './balancedtree/movie';
import './balancedtree/balancedtree.css';

const DEFAULT_INPUT = '6,43,96,70,52,78,4,16,8,49,15,9';

const BASE_ANIM_DELAY = 2000;

/** The original slider: its value scales the delay between frames. */
const SPEED_MIN = -5;
const SPEED_FACTORS = [5, 3, 2, 1.5, 1.2, 1, 0.8, 0.6, 0.4, 0.3, 0.2, 0.1];
const DEFAULT_SPEED = 2;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (): void => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export default function BalancedTreeApp(): ReactElement {
  const [draft, setDraft] = useState(DEFAULT_INPUT);
  const [values, setValues] = useState<number[]>(() => parseInput(DEFAULT_INPUT).values);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const reduced = usePrefersReducedMotion();

  const frames = useMemo(() => buildFrames(values), [values]);
  const frame = frames[Math.min(cursor, frames.length - 1)];
  const atEnd = cursor >= frames.length - 1;
  const delay = BASE_ANIM_DELAY * SPEED_FACTORS[speed - SPEED_MIN];

  useEffect(() => {
    if (!playing || atEnd) return;
    const timer = window.setTimeout(() => setCursor((at) => at + 1), delay);
    return () => window.clearTimeout(timer);
  }, [playing, atEnd, cursor, delay]);

  useEffect(() => {
    if (atEnd) setPlaying(false);
  }, [atEnd]);

  const restart = (): void => {
    const parsed = parseInput(draft);
    setError(parsed.error);
    if (parsed.error) return;
    setValues(parsed.values);
    setCursor(0);
    setPlaying(true);
  };

  // Nodes move for half a step, which leaves the rest of it to read the label.
  const stage = { '--transition-time': reduced ? '0s' : `${delay / 2000}s` } as CSSProperties;

  return (
    <div className="treeContainer" style={stage}>
      <div className="inline-input">
        <div className="flex-item1">
          <label htmlFor="bt-data">Input Data:</label>
          <input
            id="bt-data"
            className="inputField"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyUp={(event) => {
              if (event.key === 'Enter') restart();
            }}
          />
        </div>

        <div className="flex-item2">
          <label htmlFor="bt-speed">Animation Speed:</label>
          <input
            id="bt-speed"
            type="range"
            min={SPEED_MIN}
            max={SPEED_MIN + SPEED_FACTORS.length - 1}
            className="speedslider"
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
          />
        </div>
      </div>

      <div className="bt-controls">
        <button type="button" className="bt-btn" onClick={restart} aria-label="Start over">
          &#9198;
        </button>
        <button
          type="button"
          className="bt-btn"
          disabled={cursor === 0}
          aria-label="Previous step"
          onClick={() => {
            setPlaying(false);
            setCursor((at) => Math.max(at - 1, 0));
          }}
        >
          &#9664;
        </button>
        <button
          type="button"
          className="bt-btn bt-btn--play"
          onClick={() => {
            if (atEnd) {
              setCursor(0);
              setPlaying(true);
              return;
            }
            setPlaying((on) => !on);
          }}
        >
          {playing ? 'Pause' : atEnd ? 'Replay' : 'Play'}
        </button>
        <button
          type="button"
          className="bt-btn"
          disabled={atEnd}
          aria-label="Next step"
          onClick={() => {
            setPlaying(false);
            setCursor((at) => Math.min(at + 1, frames.length - 1));
          }}
        >
          &#9654;
        </button>
        <span className="bt-step">
          step {Math.min(cursor, frames.length - 1) + 1} of {frames.length}
        </span>
        <span className="bt-caption" aria-live="polite">
          {frame.caption}
        </span>
      </div>

      {error && <p className="bt-error">{error}</p>}

      <div className="bt-stage">
        <div className="tree">
          <div className="head" style={{ top: `${HEAD_SPOT.top}%`, left: `${HEAD_SPOT.left}%` }}>
            {frame.tooltipOn === 'head' && (
              <>
                <div className="nodeTooltip">{frame.caption}</div>
                <div className="tooltipArrow" />
              </>
            )}
            <div className="headlabel">Head</div>
          </div>

          {frame.nodes.map((node) => (
            <svg
              key={`line-${node.index}`}
              className="parentLine"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{
                width: node.line ? node.line.width : 0,
                height: node.line ? node.line.height : 0,
                // Parked at the value itself, so the line sweeps out of it.
                left: node.line ? node.line.left : node.left,
                top: node.line ? node.line.top : node.top,
                transform: node.line && node.line.mirrored ? 'scale(-1, 1)' : 'scale(1, 1)',
              }}
            >
              <path
                className="line"
                vectorEffect="non-scaling-stroke"
                strokeWidth="2"
                fill="transparent"
                d="M 2 0 Q 2 50, 26 50 T 74 50 T 98, 100"
              />
            </svg>
          ))}

          {frame.nodes.map((node) => (
            <div
              key={`node-${node.index}`}
              className={node.walking ? 'node node--walking' : 'node'}
              style={{ top: node.top, left: node.left }}
            >
              {frame.tooltipOn === node.index && (
                <>
                  <div className="nodeTooltip">{frame.caption}</div>
                  <div className="tooltipArrow" />
                </>
              )}
              <div className="nodeLabel">
                {node.value}
                {node.height !== null && <sub> {node.height}</sub>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
