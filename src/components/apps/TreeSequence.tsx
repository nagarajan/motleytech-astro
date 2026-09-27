import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  canonical,
  findLegalNext,
  judge,
  leaf,
  MAX_COLOURS,
  parseTree,
  size,
  usableColours,
  type TreeNode,
  type Verdict,
} from './treen/kruskal';
import { GEOMETRY, layout, type Placed } from './treen/layout';
import './treen/treen.css';

const STORE = 'motleytech-tree-sequences';

/** Fixed hues, so a colour means the same thing in every theme. Each vertex also
 *  carries its number, so the palette is never the only cue. */
const SWATCHES = ['#f0b429', '#38bdf8', '#f472b6', '#4ade80'];

const EXAMPLES: Array<{ label: string; palette: number; trees: string[]; note: string }> = [
  {
    label: 'The best two-colour run',
    palette: 2,
    trees: ['1', '0(0)', '0'],
    note: 'Three trees, and TREE(2) = 3 says you cannot do better with two colours.',
  },
  {
    label: 'A three-colour run',
    palette: 3,
    trees: ['2', '1(1)', '1(0)', '0(1)', '0(0)', '1', '0'],
    note: 'Seven trees from a handful of two-vertex shapes, and this is barely trying.',
  },
];

interface Saved {
  name: string;
  palette: number;
  trees: string[];
  savedAt: string;
}

function readSaves(): Saved[] {
  try {
    const raw = window.localStorage.getItem(STORE);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is Saved =>
        item && typeof item.name === 'string' && Array.isArray(item.trees) && typeof item.palette === 'number',
    );
  } catch {
    return [];
  }
}

function updateNode(tree: TreeNode, id: number, change: (node: TreeNode) => TreeNode): TreeNode {
  if (tree.id === id) return change(tree);
  return { ...tree, children: tree.children.map((child) => updateNode(child, id, change)) };
}

function dropNode(tree: TreeNode, id: number): TreeNode {
  return {
    ...tree,
    children: tree.children.filter((child) => child.id !== id).map((child) => dropNode(child, id)),
  };
}

function parentOf(tree: TreeNode, id: number): TreeNode | null {
  for (const child of tree.children) {
    if (child.id === id) return tree;
    const deeper = parentOf(child, id);
    if (deeper) return deeper;
  }
  return null;
}

function highestId(tree: TreeNode): number {
  return Math.max(tree.id, ...tree.children.map(highestId));
}

function Figure({
  tree,
  scale = 1,
  selected,
  highlight,
  onPick,
}: {
  tree: TreeNode;
  scale?: number;
  selected?: number;
  highlight?: Set<number>;
  onPick?: (id: number) => void;
}): ReactElement {
  const figure = useMemo(() => layout(tree), [tree]);
  const { radius } = GEOMETRY;

  const vertex = (node: Placed): ReactElement => {
    const classes = ['ts-vertex'];
    if (node.id === selected) classes.push('ts-vertex--selected');
    if (highlight?.has(node.id)) classes.push('ts-vertex--lit');

    return (
      <g
        key={node.id}
        className={classes.join(' ')}
        transform={`translate(${node.x},${node.y})`}
        onClick={onPick ? () => onPick(node.id) : undefined}
        role={onPick ? 'button' : undefined}
        tabIndex={onPick ? 0 : undefined}
        aria-label={onPick ? `vertex of colour ${node.colour + 1}` : undefined}
        onKeyDown={
          onPick
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onPick(node.id);
                }
              }
            : undefined
        }
      >
        <circle r={radius} fill={SWATCHES[node.colour] ?? SWATCHES[0]} />
        <text dy="0.33em">{node.colour + 1}</text>
      </g>
    );
  };

  return (
    <svg
      className="ts-figure"
      viewBox={`0 0 ${figure.width} ${figure.height}`}
      width={figure.width * scale}
      height={figure.height * scale}
      role="img"
      aria-label={`tree ${canonical(tree)}`}
    >
      <g>
        {figure.edges.map((edge) => (
          <line
            key={edge.key}
            className="ts-branch"
            x1={edge.from.x}
            y1={edge.from.y}
            x2={edge.to.x}
            y2={edge.to.y}
          />
        ))}
      </g>
      <g>{figure.nodes.map(vertex)}</g>
    </svg>
  );
}

export default function TreeSequence(): ReactElement {
  const [palette, setPalette] = useState(3);
  const [sequence, setSequence] = useState<TreeNode[]>([]);
  const [draft, setDraft] = useState<TreeNode>(() => leaf(0));
  const [selected, setSelected] = useState(0);
  const [brush, setBrush] = useState(0);
  const [saves, setSaves] = useState<Saved[]>([]);
  const [saveName, setSaveName] = useState('');
  const [notice, setNotice] = useState('');
  const [hint, setHint] = useState<{ text: string; tree?: TreeNode } | null>(null);
  const [searching, setSearching] = useState(false);
  const nextId = useRef(1);

  useEffect(() => {
    setSaves(readSaves());
  }, []);

  const position = sequence.length + 1;
  const verdict: Verdict = useMemo(() => judge(sequence, draft, palette), [sequence, draft, palette]);

  const lit = useMemo(() => {
    if (verdict.ok || verdict.reason !== 'embeds') return { draft: undefined, source: undefined };
    return {
      draft: new Set(verdict.witness.values()),
      source: new Set(verdict.witness.keys()),
    };
  }, [verdict]);

  const freshDraft = useCallback((colour: number) => {
    const root = leaf(colour, 0);
    nextId.current = 1;
    setDraft(root);
    setSelected(0);
  }, []);

  const load = useCallback(
    (colours: number, forms: string[], message = '') => {
      setPalette(colours);
      setSequence(forms.map(parseTree));
      setBrush(0);
      freshDraft(0);
      setHint(null);
      setNotice(message);
    },
    [freshDraft],
  );

  const addChild = (): void => {
    const id = nextId.current;
    nextId.current += 1;
    setDraft((tree) => updateNode(tree, selected, (node) => ({ ...node, children: [...node.children, leaf(brush, id)] })));
    setSelected(id);
    setHint(null);
  };

  const paint = (): void => {
    setDraft((tree) => updateNode(tree, selected, (node) => ({ ...node, colour: brush })));
    setHint(null);
  };

  const remove = (): void => {
    const parent = parentOf(draft, selected);
    if (!parent) return;
    setDraft((tree) => dropNode(tree, selected));
    setSelected(parent.id);
    setHint(null);
  };

  const play = (): void => {
    if (!verdict.ok) return;
    setSequence((played) => [...played, draft]);
    freshDraft(brush);
    setHint(null);
    setNotice('');
  };

  const useTree = (tree: TreeNode): void => {
    setDraft(tree);
    nextId.current = highestId(tree) + 1;
    setSelected(tree.id);
    setHint(null);
  };

  const askStuck = (): void => {
    setSearching(true);
    // Let the label paint before the search takes over the thread.
    window.setTimeout(() => {
      const found = findLegalNext(sequence, palette);
      if (found.outcome === 'found') {
        setHint({
          text: 'Yes, at least one tree can still be played. Here is one — though the smallest legal move is rarely the best one.',
          tree: found.tree,
        });
      } else if (found.outcome === 'stuck') {
        const spent = usableColours(sequence, palette).length === 0;
        setHint({
          text: spent
            ? `Nothing can follow. Every colour has appeared on its own as a whole tree, and a single vertex embeds into anything using its colour, so no tree of any size is legal now. Your sequence has ${sequence.length} trees.`
            : `Nothing can follow: no tree of ${position} vertices or fewer is legal any more. Your sequence has ${sequence.length} trees.`,
        });
      } else {
        setHint({
          text: `There are too many trees of up to ${position} vertices to check them all, so this one is undecided. Keep playing.`,
        });
      }
      setSearching(false);
    }, 20);
  };

  const changePalette = (colours: number): void => {
    const doomed = sequence.some((tree) => size(tree) > 0 && canonical(tree).match(/\d+/g)?.some((c) => Number(c) >= colours));
    setPalette(colours);
    if (doomed) {
      setSequence([]);
      setNotice('That palette is too small for the sequence you had, so the sequence was cleared.');
    } else {
      setNotice('');
    }
    if (brush >= colours) setBrush(0);
    freshDraft(0);
    setHint(null);
  };

  const save = (): void => {
    const name = saveName.trim();
    if (!name) {
      setNotice('Give the sequence a name first.');
      return;
    }
    if (!sequence.length) {
      setNotice('There is nothing to save yet.');
      return;
    }
    const entry: Saved = {
      name,
      palette,
      trees: sequence.map(canonical),
      savedAt: new Date().toISOString(),
    };
    const next = [entry, ...saves.filter((item) => item.name !== name)];
    setSaves(next);
    try {
      window.localStorage.setItem(STORE, JSON.stringify(next));
      setNotice(`Saved as "${name}".`);
      setSaveName('');
    } catch {
      setNotice('This browser will not let the page store anything, so the save only lasts until you leave.');
    }
  };

  const forget = (name: string): void => {
    const next = saves.filter((item) => item.name !== name);
    setSaves(next);
    try {
      window.localStorage.setItem(STORE, JSON.stringify(next));
    } catch {
      /* nothing worth saying: the list is already gone from the page */
    }
    setNotice('');
  };

  const explain = (): string => {
    if (verdict.ok) return `Legal. This would become tree #${position}.`;
    if (verdict.reason === 'budget') {
      return `Too big: tree #${position} may have at most ${verdict.allowed} ${verdict.allowed === 1 ? 'vertex' : 'vertices'}, and this has ${verdict.size}.`;
    }
    if (verdict.reason === 'palette') {
      return `This uses a colour outside the palette (${verdict.colours.map((c) => c + 1).join(', ')}).`;
    }
    return `Illegal: tree #${verdict.position} fits inside this one. The vertices it lands on are ringed, here and in the sequence.`;
  };

  const colours = Array.from({ length: palette }, (_, index) => index);

  return (
    <div className="ts">
      <div className="ts-bar">
        <label className="ts-field">
          Colours
          <select className="ts-select" value={palette} onChange={(event) => changePalette(Number(event.target.value))}>
            {Array.from({ length: MAX_COLOURS }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="ts-btn" onClick={() => load(palette, [], '')}>
          New sequence
        </button>
        <span className="ts-spacer" />
        {EXAMPLES.map((example) => (
          <button
            key={example.label}
            type="button"
            className="ts-btn"
            onClick={() => load(example.palette, example.trees, example.note)}
          >
            {example.label}
          </button>
        ))}
      </div>

      {notice && <p className="ts-notice">{notice}</p>}

      <div className="ts-panes">
        <section className="ts-pane" aria-labelledby="ts-seq-heading">
          <h3 id="ts-seq-heading" className="ts-pane-head">
            Sequence
            <span>
              {sequence.length} {sequence.length === 1 ? 'tree' : 'trees'}
            </span>
          </h3>

          {sequence.length === 0 ? (
            <p className="ts-empty">
              Nothing played yet. Tree #1 may have exactly one vertex, so your only choice is which colour to spend.
            </p>
          ) : (
            <ol className="ts-list">
              {sequence.map((tree, index) => (
                <li key={`${index}-${canonical(tree)}`} className={lit.source && verdict.ok === false && verdict.reason === 'embeds' && verdict.position === index + 1 ? 'ts-item ts-item--lit' : 'ts-item'}>
                  <span className="ts-pos">#{index + 1}</span>
                  <Figure
                    tree={tree}
                    scale={0.62}
                    highlight={
                      !verdict.ok && verdict.reason === 'embeds' && verdict.position === index + 1 ? lit.source : undefined
                    }
                  />
                  <span className="ts-count">
                    {size(tree)} of {index + 1}
                  </span>
                  {index === sequence.length - 1 && (
                    <button
                      type="button"
                      className="ts-btn ts-btn--quiet"
                      onClick={() => {
                        setSequence((played) => played.slice(0, -1));
                        setHint(null);
                      }}
                    >
                      Take back
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="ts-pane" aria-labelledby="ts-draft-heading">
          <h3 id="ts-draft-heading" className="ts-pane-head">
            Tree #{position}
            <span>at most {position === 1 ? 'one vertex' : `${position} vertices`}</span>
          </h3>

          <div className="ts-brushes" role="group" aria-label="Colour for new vertices">
            <span className="ts-brush-label">New vertices</span>
            {colours.map((colour) => (
              <button
                key={colour}
                type="button"
                className={colour === brush ? 'ts-swatch ts-swatch--on' : 'ts-swatch'}
                style={{ background: SWATCHES[colour] }}
                aria-pressed={colour === brush}
                aria-label={`colour ${colour + 1}`}
                onClick={() => setBrush(colour)}
              >
                {colour + 1}
              </button>
            ))}
          </div>

          <div className="ts-stage">
            <Figure tree={draft} selected={selected} highlight={lit.draft} onPick={setSelected} />
          </div>

          <div className="ts-tools">
            <button type="button" className="ts-btn" onClick={addChild}>
              Add child
            </button>
            <button type="button" className="ts-btn" onClick={paint}>
              Paint
            </button>
            <button type="button" className="ts-btn" onClick={remove} disabled={selected === draft.id}>
              Delete
            </button>
            <button type="button" className="ts-btn ts-btn--quiet" onClick={() => freshDraft(brush)}>
              Clear
            </button>
          </div>

          <p className={verdict.ok ? 'ts-verdict ts-verdict--ok' : 'ts-verdict ts-verdict--no'} aria-live="polite">
            {explain()}
          </p>

          <div className="ts-tools">
            <button type="button" className="ts-btn ts-btn--primary" disabled={!verdict.ok} onClick={play}>
              Add to sequence
            </button>
            <button type="button" className="ts-btn" onClick={askStuck} disabled={searching}>
              {searching ? 'Looking…' : 'Any legal move left?'}
            </button>
          </div>

          {hint && (
            <div className="ts-hint">
              <p>{hint.text}</p>
              {hint.tree && (
                <div className="ts-hint-tree">
                  <Figure tree={hint.tree} scale={0.62} />
                  <button type="button" className="ts-btn" onClick={() => useTree(hint.tree!)}>
                    Put it in the editor
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <section className="ts-saves" aria-labelledby="ts-saves-heading">
        <h3 id="ts-saves-heading" className="ts-pane-head">
          Saved sequences
        </h3>
        <div className="ts-tools">
          <input
            className="ts-input"
            placeholder="name this sequence"
            value={saveName}
            aria-label="Name for the saved sequence"
            onChange={(event) => setSaveName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save();
            }}
          />
          <button type="button" className="ts-btn" onClick={save}>
            Save
          </button>
        </div>

        {saves.length === 0 ? (
          <p className="ts-empty">Nothing saved yet. Saves live in this browser only.</p>
        ) : (
          <ul className="ts-saved-list">
            {saves.map((item) => (
              <li key={item.name}>
                <span className="ts-saved-name">{item.name}</span>
                <span className="ts-saved-meta">
                  {item.trees.length} {item.trees.length === 1 ? 'tree' : 'trees'} · {item.palette} colours
                </span>
                <button
                  type="button"
                  className="ts-btn ts-btn--quiet"
                  onClick={() => load(item.palette, item.trees, `Loaded "${item.name}".`)}
                >
                  Load
                </button>
                <button type="button" className="ts-btn ts-btn--quiet" onClick={() => forget(item.name)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
