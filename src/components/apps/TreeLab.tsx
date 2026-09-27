import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { B_TREE_MAX_KEYS_CHOICES, minKeysFor } from './trees/btree';
import { engineOrder, engines } from './trees/engines';
import {
  BINARY_GEOMETRY,
  BTREE_GEOMETRY,
  type Layout,
  type LayoutNode,
  type Point,
  edgeEnd,
  edgeStart,
  layoutSnapshot,
} from './trees/layout';
import type { BinaryNodeView, BTreeNodeView, EngineId, NodeId, Snapshot, Step } from './trees/types';
import './trees/treelab.css';

/** Milliseconds between steps, slowest first. */
const SPEEDS = [1500, 1050, 720, 480, 300, 170];
const DEFAULT_SPEED = 2;
const DEFAULT_VALUES = [50, 30, 70, 20, 40, 60, 80];
const MAX_VALUE = 999;

type Props = {
  /** Omit for the full set of tabs, or pass one id to pin the simulator to it. */
  structures?: EngineId[];
  initial?: number[];
  maxKeys?: number;
  showLog?: boolean;
};

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

/**
 * Slides every node from where it is drawn now to where the new snapshot wants
 * it. A node that has just appeared starts at its parent, so inserts look like
 * the tree growing rather than a node blinking into place.
 */
function useTweenedPositions(layout: Layout, duration: number): Map<NodeId, Point> {
  const displayed = useRef<Map<NodeId, Point>>(new Map());
  const [, bump] = useState(0);

  if (displayed.current.size === 0 && layout.positions.size > 0) {
    displayed.current = new Map(layout.positions);
  }

  useEffect(() => {
    const from = new Map(displayed.current);
    const started = performance.now();
    let frame = 0;

    const origin = (id: NodeId): Point => {
      const own = from.get(id);
      if (own) return own;
      const parent = layout.parentOf.get(id);
      const viaParent = parent === undefined ? undefined : from.get(parent);
      return viaParent ?? (layout.positions.get(id) as Point);
    };

    const tick = (now: number): void => {
      const progress = duration <= 0 ? 1 : Math.min(1, (now - started) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const next = new Map<NodeId, Point>();
      layout.positions.forEach((target, id) => {
        const start = origin(id);
        next.set(id, {
          x: start.x + (target.x - start.x) * eased,
          y: start.y + (target.y - start.y) * eased,
        });
      });
      displayed.current = next;
      bump((count) => count + 1);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [layout, duration]);

  return displayed.current;
}

function summarise(snapshot: Snapshot): { keys: number; height: number } {
  if (snapshot.shape === 'binary') {
    const walk = (node: BinaryNodeView | null): { keys: number; height: number } => {
      if (!node) return { keys: 0, height: -1 };
      const left = walk(node.left);
      const right = walk(node.right);
      return { keys: 1 + left.keys + right.keys, height: 1 + Math.max(left.height, right.height) };
    };
    return walk(snapshot.root);
  }
  const walk = (node: BTreeNodeView | null): { keys: number; height: number } => {
    if (!node) return { keys: 0, height: -1 };
    let keys = node.keys.length;
    let deepest = -1;
    for (const child of node.children) {
      const below = walk(child);
      keys += below.keys;
      deepest = Math.max(deepest, below.height);
    }
    return { keys, height: 1 + deepest };
  };
  return walk(snapshot.root);
}

export default function TreeLab({ structures, initial, maxKeys: initialMaxKeys = 2, showLog = true }: Props): ReactElement {
  // Island props are fixed by the article, so they only need reading once.
  const [tabs] = useState<EngineId[]>(() => (structures && structures.length ? structures : engineOrder));
  const [seedValues] = useState<number[]>(() => initial ?? DEFAULT_VALUES);

  const [engineId, setEngineId] = useState<EngineId>(tabs[0]);
  const [maxKeys, setMaxKeys] = useState(initialMaxKeys);
  const [base, setBase] = useState<Snapshot>({ shape: 'binary', root: null });
  const [steps, setSteps] = useState<Step[]>([]);
  const [cursor, setCursor] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const stateRef = useRef<unknown>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const engine = engines[engineId];

  const rebuild = useCallback(() => {
    const fresh = engine.create({ maxKeys, seed: 7 });
    for (const value of seedValues) engine.insert(fresh, value);
    stateRef.current = fresh;
    setBase(engine.snapshot(fresh));
    setSteps([]);
    setCursor(-1);
    setPlaying(false);
    setError(null);
  }, [engine, maxKeys, seedValues]);

  useEffect(() => {
    rebuild();
  }, [rebuild]);

  const run = useCallback(
    (kind: 'insert' | 'remove', value: number) => {
      const state = stateRef.current;
      if (!state) return;
      const before = engine.snapshot(state);
      const produced = kind === 'insert' ? engine.insert(state, value) : engine.remove(state, value);
      setBase(before);
      setSteps(produced);
      setCursor(produced.length ? 0 : -1);
      setPlaying(produced.length > 1);
    },
    [engine],
  );

  const pick = useCallback(
    (kind: 'insert' | 'remove'): number | null => {
      const state = stateRef.current;
      if (!state) return null;
      const present = engine.keys(state);
      if (kind === 'remove') {
        if (!present.length) return null;
        return present[Math.floor(Math.random() * present.length)];
      }
      const taken = new Set(present);
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const candidate = 1 + Math.floor(Math.random() * 99);
        if (!taken.has(candidate)) return candidate;
      }
      return null;
    },
    [engine],
  );

  const submit = useCallback(
    (kind: 'insert' | 'remove') => {
      const trimmed = draft.trim();
      if (!trimmed) {
        const chosen = pick(kind);
        if (chosen === null) {
          setError(kind === 'remove' ? 'The tree is empty, so there is nothing to delete.' : 'No free value to insert.');
          return;
        }
        setError(null);
        run(kind, chosen);
        return;
      }
      const parsed = Number(trimmed);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_VALUE) {
        setError(`Use a whole number between 1 and ${MAX_VALUE}.`);
        return;
      }
      setError(null);
      run(kind, parsed);
    },
    [draft, pick, run],
  );

  useEffect(() => {
    if (!playing) return undefined;
    if (cursor >= steps.length - 1) {
      setPlaying(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setCursor((at) => Math.min(at + 1, steps.length - 1)), SPEEDS[speed]);
    return () => window.clearTimeout(timer);
  }, [playing, cursor, steps.length, speed]);

  const step = cursor >= 0 && cursor < steps.length ? steps[cursor] : null;
  const snapshot = step ? step.snapshot : base;
  const layout = useMemo(() => layoutSnapshot(snapshot), [snapshot]);
  const positions = useTweenedPositions(layout, reducedMotion ? 0 : Math.min(340, Math.round(SPEEDS[speed] * 0.55)));
  const stats = useMemo(() => summarise(snapshot), [snapshot]);
  const nodeById = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node] as const)), [layout]);

  const seenIds = useRef<Set<NodeId>>(new Set());
  const entering = useMemo(() => {
    const ids = new Set(layout.nodes.map((node) => node.id));
    const fresh = new Set([...ids].filter((id) => !seenIds.current.has(id)));
    seenIds.current = ids;
    return fresh;
  }, [layout]);

  useEffect(() => {
    const list = logRef.current;
    const item = list?.children[cursor] as HTMLElement | undefined;
    if (!list || !item) return;
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [cursor, steps]);

  const atEnd = cursor >= steps.length - 1;
  const focusKeys = step?.focusKeys ?? [];

  const classes = ['tl'];
  if (step) classes.push(`tl-mark-${step.mark}`);

  return (
    <div className={classes.join(' ')}>
      {tabs.length > 1 && (
        <div className="tl-tabs" role="group" aria-label="Which tree to simulate">
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              className="tl-tab"
              aria-pressed={id === engineId}
              onClick={() => setEngineId(id)}
            >
              {engines[id].label}
            </button>
          ))}
        </div>
      )}

      <p className="tl-invariant">{engine.invariant}</p>

      <div className="tl-controls">
        <input
          className="tl-input"
          inputMode="numeric"
          placeholder="value"
          aria-label="Value to insert or delete"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit('insert');
          }}
        />
        <button type="button" className="tl-btn tl-btn--primary" onClick={() => submit('insert')}>
          Insert
        </button>
        <button type="button" className="tl-btn" onClick={() => submit('remove')}>
          Delete
        </button>
        <button
          type="button"
          className="tl-btn"
          onClick={() => {
            const chosen = pick('insert');
            if (chosen !== null) {
              setDraft('');
              run('insert', chosen);
            }
          }}
        >
          Random
        </button>
        <button type="button" className="tl-btn" onClick={rebuild}>
          Reset
        </button>
        <span className="tl-spacer" />
        {engineId === 'btree' && (
          <label className="tl-field">
            Keys per node
            <select
              className="tl-select"
              value={maxKeys}
              onChange={(event) => setMaxKeys(Number(event.target.value))}
            >
              {B_TREE_MAX_KEYS_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  up to {choice}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="tl-stage">
        {layout.nodes.length === 0 ? (
          <p className="tl-empty">The tree is empty. Insert a value to get it started.</p>
        ) : (
          <svg
            className="tl-svg"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            width={layout.width}
            height={layout.height}
            role="img"
            aria-label={`${engine.label} holding ${stats.keys} keys`}
          >
            <g>
              {layout.edges.map((edge) => {
                const parent = nodeById.get(edge.parent);
                const child = nodeById.get(edge.child);
                const parentAt = positions.get(edge.parent);
                const childAt = positions.get(edge.child);
                if (!parent || !child || !parentAt || !childAt) return null;
                const from = edgeStart(parent, parentAt, edge.slot);
                const to = edgeEnd(child, childAt);
                return <line key={edge.key} className="tl-edge" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
              })}
            </g>
            <g>
              {layout.nodes.map((node) => (
                <TreeLabNode
                  key={node.id}
                  node={node}
                  at={positions.get(node.id)}
                  focused={step?.focus.includes(node.id) ?? false}
                  focusKeys={focusKeys}
                  entering={entering.has(node.id)}
                  onPickValue={setDraft}
                />
              ))}
            </g>
          </svg>
        )}
      </div>

      <div className="tl-playback">
        <button
          type="button"
          className="tl-btn"
          disabled={!steps.length || cursor < 0}
          onClick={() => {
            setPlaying(false);
            setCursor((at) => Math.max(at - 1, -1));
          }}
          aria-label="Previous step"
        >
          &#9664;
        </button>
        <button
          type="button"
          className="tl-btn"
          disabled={steps.length < 2}
          onClick={() => {
            if (atEnd) {
              setCursor(-1);
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
          className="tl-btn"
          disabled={!steps.length || atEnd}
          onClick={() => {
            setPlaying(false);
            setCursor((at) => Math.min(at + 1, steps.length - 1));
          }}
          aria-label="Next step"
        >
          &#9654;
        </button>
        <span className="tl-step-count">
          {steps.length === 0 ? 'no change yet' : cursor < 0 ? 'before the change' : `step ${cursor + 1} of ${steps.length}`}
        </span>
        <label className="tl-field">
          Speed
          <input
            className="tl-speed"
            type="range"
            min={0}
            max={SPEEDS.length - 1}
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            aria-label="Animation speed"
          />
        </label>
      </div>

      <p className={step ? 'tl-caption' : 'tl-caption tl-caption--idle'} aria-live="polite">
        {step ? step.caption : 'Insert or delete a value, then use play and the arrows to walk through what the tree does.'}
      </p>

      {error && <p className="tl-error">{error}</p>}

      {showLog && steps.length > 0 && (
        <ol className="tl-log" ref={logRef}>
          {steps.map((entry, index) => (
            <li key={`${index}-${entry.caption}`}>
              <button
                type="button"
                className="tl-log-item"
                aria-current={index === cursor ? 'step' : undefined}
                onClick={() => {
                  setPlaying(false);
                  setCursor(index);
                }}
              >
                <span className="tl-log-mark">{entry.mark}</span>
                <span>{entry.caption}</span>
              </button>
            </li>
          ))}
        </ol>
      )}

      <p className="tl-footer">
        <span>
          {stats.keys} {stats.keys === 1 ? 'key' : 'keys'} · height {Math.max(stats.height, 0)}
        </span>
        {engineId === 'avl' && <span>the small number beside a node is its height</span>}
        {engineId === 'treap' && <span>the small number beside a node is its random priority</span>}
        {engineId === 'btree' && (
          <span>
            every node except the root holds {minKeysFor(maxKeys)} to {maxKeys} keys
          </span>
        )}
        {engineId === 'redblack' && (
          <>
            <span className="tl-swatch tl-swatch--red">
              <i /> red
            </span>
            <span className="tl-swatch tl-swatch--black">
              <i /> black
            </span>
          </>
        )}
        <span>click a node to load its value</span>
      </p>
    </div>
  );
}

type NodeProps = {
  node: LayoutNode;
  at: Point | undefined;
  focused: boolean;
  focusKeys: number[];
  entering: boolean;
  onPickValue: (value: string) => void;
};

function TreeLabNode({ node, at, focused, focusKeys, entering, onPickValue }: NodeProps): ReactElement | null {
  if (!at) return null;

  const classes = ['tl-node'];
  if (focused) classes.push('tl-node--focus');
  if (entering) classes.push('tl-enter');

  if (node.shape === 'binary') {
    const { radius } = BINARY_GEOMETRY;
    classes.push(node.red === null ? 'tl-node--plain' : node.red ? 'tl-node--red' : 'tl-node--black');
    return (
      <g className={classes.join(' ')} transform={`translate(${at.x} ${at.y})`} onClick={() => onPickValue(String(node.key))}>
        <circle r={radius} />
        <text>{node.key}</text>
        {node.annotation !== null && (
          <text className="tl-annotation" x={radius + 6} y={-radius - 1}>
            {node.annotation}
          </text>
        )}
      </g>
    );
  }

  const { keyWidth, height, pad } = BTREE_GEOMETRY;
  classes.push('tl-box');
  const left = -node.width / 2;
  return (
    <g className={classes.join(' ')} transform={`translate(${at.x} ${at.y})`}>
      <rect x={left} y={-height / 2} width={node.width} height={height} rx={10} />
      {node.keys.map((key, index) => {
        const cellLeft = left + pad + index * keyWidth;
        return (
          <g key={key} onClick={() => onPickValue(String(key))}>
            {index > 0 && <line className="tl-divider" x1={cellLeft} y1={-height / 2 + 5} x2={cellLeft} y2={height / 2 - 5} />}
            <rect x={cellLeft} y={-height / 2} width={keyWidth} height={height} fill="transparent" />
            <text x={cellLeft + keyWidth / 2} className={focusKeys.includes(key) ? 'tl-key--focus' : undefined}>
              {key}
            </text>
          </g>
        );
      })}
    </g>
  );
}
