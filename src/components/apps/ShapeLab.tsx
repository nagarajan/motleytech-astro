import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { detectFaces } from './shapes/faces';
import { type Vec3 } from './shapes/geometry';
import {
  addEdges,
  addFace,
  addVertex,
  chargeOf,
  DEFAULT_RULES,
  decode,
  deleteEdge,
  deleteFace,
  deleteKind,
  deleteVertex,
  edgeBetween,
  edgeLength,
  EMPTY,
  encode,
  hopsFor,
  kindId,
  kindOf,
  moveVertex,
  naturalLength,
  report,
  setKind,
  setPinned,
  settle,
  STOCK_KINDS,
  tidy,
  upsertKind,
  vertexAt,
  type Shape,
  type SavedShape,
  type VertexKind,
} from './shapes/model';
import { PRESET_GROUPS, PRESETS, toShape } from './shapes/presets';
import { createViewer, faceTint, type Viewer } from './shapes/scene';
import './shapes/shapes.css';

const STORE = 'motleytech-shapes';
const PALETTE = 'motleytech-shape-kinds';

interface Saved {
  name: string;
  shape: SavedShape;
  savedAt: string;
}

function readSaves(): Saved[] {
  try {
    const raw = window.localStorage.getItem(STORE);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Saved => item && typeof item.name === 'string' && item.shape);
  } catch {
    return [];
  }
}

function readPalette(): VertexKind[] {
  try {
    const raw = window.localStorage.getItem(PALETTE);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed) || parsed.length === 0) return STOCK_KINDS;
    // The stock kinds are always present, so a palette saved before one was added still
    // has everything the presets refer to.
    const custom = parsed.filter((kind: VertexKind) => kind && !kind.stock && typeof kind.charge === 'number');
    const stock = STOCK_KINDS.map((kind) => parsed.find((entry: VertexKind) => entry.id === kind.id) ?? kind);
    return [...stock, ...custom];
  } catch {
    return STOCK_KINDS;
  }
}

/** The canvas background, taken from the page so the scene follows the site theme. */
function pageColour(): string {
  if (typeof window === 'undefined') return '#0b1020';
  return getComputedStyle(document.documentElement).getPropertyValue('--code-bg').trim() || '#0b1020';
}

export default function ShapeLab(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);

  const [shape, setShape] = useState<Shape>(EMPTY);
  const [selected, setSelected] = useState<number[]>([]);
  const [kind, setChosenKind] = useState('plain');
  const [flatten, setFlatten] = useState(true);
  const [showEdges, setShowEdges] = useState(true);
  const [showFaces, setShowFaces] = useState(true);
  const [showVertices, setShowVertices] = useState(true);
  const [opacity, setOpacity] = useState(0.3);
  const [saves, setSaves] = useState<Saved[]>([]);
  const [saveName, setSaveName] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [newKind, setNewKind] = useState({ name: '', charge: 1.4, colour: '#a78bfa' });

  const rules = useMemo(() => ({ flatten }), [flatten]);

  /**
   * The authoritative shape, alongside the state copy that drives rendering.
   *
   * Every edit reads the shape, relaxes it, and writes it back, and React state is not
   * readable in the same tick it is written. Clicking a vertex kind four times quickly
   * would therefore compute the third and fourth vertices from a shape that already had
   * them missing, and one would be lost. Edits go through `edit` and read the ref; the
   * state is only ever for drawing.
   */
  const live = useRef<Shape>(EMPTY);

  const edit = (change: (current: Shape) => Shape): Shape => {
    const next = change(live.current);
    live.current = next;
    setShape(next);
    return next;
  };

  useEffect(() => {
    setSaves(readSaves());
    edit((current) => ({ ...current, kinds: readPalette() }));
  }, []);

  // ---------------------------------------------------------------- the scene
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let viewer: Viewer | null = null;
    try {
      viewer = createViewer(canvas, pageColour());
    } catch {
      setNotice('This browser could not start WebGL, so the 3D view is unavailable.');
      return;
    }
    viewerRef.current = viewer;

    const onResize = (): void => viewer?.resize();
    window.addEventListener('resize', onResize);
    const watcher = new MutationObserver(() => viewer?.setBackground(pageColour()));
    watcher.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      window.removeEventListener('resize', onResize);
      watcher.disconnect();
      viewer?.dispose();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    viewerRef.current?.draw(shape, {
      showEdges,
      showFaces,
      showVertices,
      opacity,
      selected,
      pending: null,
    });
  }, [shape, showEdges, showFaces, showVertices, opacity, selected]);

  /** Changing the rules changes the geometry, so the shape has to be resettled. */
  useEffect(() => {
    edit((current) => (current.vertices.length > 1 ? settle(current, { flatten }) : current));
  }, [flatten]);

  // ---------------------------------------------------------------- selection
  const chosen = selected.map((id) => vertexAt(shape, id)).filter((vertex): vertex is NonNullable<typeof vertex> => Boolean(vertex));
  const only = chosen.length === 1 ? chosen[0] : null;
  const pairEdge = chosen.length === 2 ? edgeBetween(shape, chosen[0].id, chosen[1].id) : undefined;
  const selectedFace =
    chosen.length >= 3
      ? shape.faces.find(
          (face) => face.vertices.length === chosen.length && face.vertices.every((id) => selected.includes(id)),
        )
      : undefined;

  const toggle = (id: number, additive: boolean): void => {
    setSelected((current) => {
      if (!additive) return current.length === 1 && current[0] === id ? [] : [id];
      return current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
    });
  };

  // ---------------------------------------------------------------- canvas input
  /**
   * A drag that rotates the view also fires a click, so a press has to have barely moved
   * to count as aiming at something. The same record decides whether a press that started
   * on a vertex is a selection or the beginning of a drag.
   */
  const press = useRef<{ x: number; y: number; vertex: number | null; moved: boolean } | null>(null);
  const dragging = useRef<{ id: number; wasPinned: boolean } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const hit = viewerRef.current?.pick(event.clientX, event.clientY) ?? null;
    press.current = {
      x: event.clientX,
      y: event.clientY,
      vertex: hit?.kind === 'vertex' ? hit.id : null,
      moved: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const start = press.current;
    if (!start) return;
    if (!start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 4) return;
    start.moved = true;

    if (start.vertex === null) return;

    if (!dragging.current) {
      const vertex = vertexAt(shape, start.vertex);
      if (!vertex) return;
      dragging.current = { id: start.vertex, wasPinned: Boolean(vertex.pinned) };
      // The orbit controls and a vertex drag both want the pointer, so the view stops
      // turning for the duration.
      viewerRef.current?.setOrbiting(false);
      event.currentTarget.setPointerCapture(event.pointerId);
      setSelected([start.vertex]);
    }

    const held = dragging.current;
    edit((current) => {
      const vertex = vertexAt(current, held.id);
      if (!vertex) return current;
      const landed: Vec3 | null = viewerRef.current?.dragTo(event.clientX, event.clientY, vertex.position) ?? null;
      if (!landed) return current;
      // Pinned while held, so the vertex goes exactly where the pointer is and the rest of
      // the shape has to accommodate it rather than dragging it back.
      const moved = moveVertex(current, held.id, landed);
      const withPin = { ...moved, vertices: moved.vertices.map((entry) => (entry.id === held.id ? { ...entry, pinned: true } : entry)) };
      return settle(withPin, rules, 40);
    });
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const held = dragging.current;
    dragging.current = null;
    viewerRef.current?.setOrbiting(true);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!held) return;
    edit((current) => {
      const released = held.wasPinned
        ? current
        : { ...current, vertices: current.vertices.map((entry) => (entry.id === held.id ? { ...entry, pinned: undefined } : entry)) };
      return settle(released, rules, 600);
    });
    setNotice(held.wasPinned ? 'Moved, and still pinned.' : 'Let go — the shape has taken it back.');
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const start = press.current;
    press.current = null;
    if (dragging.current) {
      endDrag(event);
      return;
    }
    if (!start || start.moved) return;

    const hit = viewerRef.current?.pick(event.clientX, event.clientY) ?? null;
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;

    if (!hit) {
      setSelected([]);
      return;
    }
    if (hit.kind === 'vertex') {
      toggle(hit.id, additive);
      return;
    }
    // An edge or a face has no selection of its own: clicking one selects the vertices it
    // is made of, which is also exactly what its delete button needs.
    const members =
      hit.kind === 'edge'
        ? (() => {
            const edge = shape.edges.find((entry) => entry.id === hit.id);
            return edge ? [edge.a, edge.b] : [];
          })()
        : shape.faces.find((face) => face.id === hit.id)?.vertices ?? [];
    setSelected(additive ? [...new Set([...selected, ...members])] : members);
  };

  // ---------------------------------------------------------------- editing
  /** A paint between setting the flag and doing the work, so the button can say it is busy. */
  const slowly = (work: () => void): void => {
    setBusy(true);
    window.setTimeout(() => {
      try {
        work();
      } finally {
        setBusy(false);
      }
    }, 20);
  };

  /** Add a vertex of `which`, joined to whatever is selected, and select the result. */
  const place = (which: string): void => {
    let added = 0;
    edit((current) => {
      const step = addVertex(current, which, selected, rules);
      added = step.id;
      return step.shape;
    });
    setSelected([added]);
    setNotice(
      selected.length === 0
        ? 'Dropped a loose vertex. Select it and another, then join them.'
        : `Added, joined to ${selected.length} ${selected.length === 1 ? 'vertex' : 'vertices'}.`,
    );
  };

  // Joining and facing can close a ring, which means basin hopping rather than a plain
  // roll downhill, and that is slow enough to be worth saying so.
  const join = (): void =>
    slowly(() => {
      edit((current) => addEdges(current, selected, rules));
      setNotice(selected.length === 2 ? 'Joined.' : 'Joined every selected pair.');
    });

  const makeFace = (): void =>
    slowly(() => {
      let complaint: string | undefined;
      edit((current) => {
        const result = addFace(current, selected, rules);
        complaint = result.error;
        return result.shape;
      });
      setNotice(complaint ?? 'Face added, along with any rim edge it needed.');
    });

  const findFaces = (): void =>
    slowly(() => {
      let count = 0;
      edit((current) => {
        const slot = new Map(current.vertices.map((vertex, index) => [vertex.id, index]));
        const positions = current.vertices.map((vertex) => vertex.position);
        const edges = current.edges
          .map((edge) => [slot.get(edge.a), slot.get(edge.b)] as [number | undefined, number | undefined])
          .filter((pair): pair is [number, number] => pair[0] !== undefined && pair[1] !== undefined);
        const existing = current.faces.map((face) =>
          face.vertices.map((id) => slot.get(id)).filter((index): index is number => index !== undefined),
        );

        const found = detectFaces(positions, edges, existing);
        count = found.length;
        if (found.length === 0) return current;

        let next = current.next;
        const faces = found.map((face) => ({
          id: next++,
          vertices: face.map((index) => current.vertices[index].id),
        }));
        return settle({ ...current, faces: [...current.faces, ...faces], next }, rules);
      });
      setNotice(
        count === 0
          ? 'No new faces found. Every edge already borders two, or there is no closed ring left.'
          : `Found ${count} ${count === 1 ? 'face' : 'faces'}.`,
      );
    });

  const removeSelected = (): void => {
    edit((current) => {
      let working = current;
      for (const id of selected) working = deleteVertex(working, id, rules);
      return working;
    });
    setNotice(`Deleted ${selected.length} ${selected.length === 1 ? 'vertex' : 'vertices'}.`);
    setSelected([]);
  };

  const straighten = (): void =>
    slowly(() => {
      edit((current) => tidy(current, rules, hopsFor(current)));
      setNotice('Tidied up. If it looked wrong before and right now, it was stuck in a local minimum.');
    });

  const clear = (): void => {
    edit((current) => ({ ...EMPTY, kinds: current.kinds }));
    setSelected([]);
    setNotice('');
    viewerRef.current?.frame();
  };

  const loadPreset = (name: string): void => {
    const preset = PRESETS.find((entry) => entry.name === name);
    if (!preset) return;
    slowly(() => {
      edit((current) => {
        const built = toShape(preset.build(), current.kinds);
        return tidy(built, rules, hopsFor(built));
      });
      setSelected([]);
      setNotice(preset.note);
      viewerRef.current?.frame();
    });
  };

  // ---------------------------------------------------------------- kinds
  const rememberPalette = (kinds: VertexKind[]): void => {
    try {
      window.localStorage.setItem(PALETTE, JSON.stringify(kinds));
    } catch {
      /* A browser that refuses storage still works, it just forgets. */
    }
  };

  /** Retune or recolour a kind, which rearranges every vertex wearing it. */
  const adjust = (id: string, change: Partial<VertexKind>): void => {
    const next = edit((current) =>
      upsertKind(current, { ...current.kinds.find((entry) => entry.id === id)!, ...change }, rules),
    );
    rememberPalette(next.kinds);
  };

  const defineKind = (): void => {
    const name = newKind.name.trim();
    if (!name) {
      setNotice('Give the new kind a name first.');
      return;
    }
    let id = '';
    const next = edit((current) => {
      id = kindId(current, name);
      return upsertKind(current, { id, name, charge: newKind.charge, colour: newKind.colour }, rules);
    });
    rememberPalette(next.kinds);
    setChosenKind(id);
    setNewKind({ name: '', charge: 1.4, colour: newKind.colour });
    setNotice(`"${name}" is on the palette. Its edges to another "${name}" will be ${newKind.charge.toFixed(2)} long.`);
  };

  const forgetKind = (id: string): void => {
    const next = edit((current) => deleteKind(current, id, rules));
    rememberPalette(next.kinds);
    if (kind === id) setChosenKind('plain');
  };

  // ---------------------------------------------------------------- saving
  const keep = (entries: Saved[]): void => {
    setSaves(entries);
    try {
      window.localStorage.setItem(STORE, JSON.stringify(entries));
    } catch {
      setNotice('This browser would not let the save be written.');
    }
  };

  const save = (): void => {
    const name = saveName.trim();
    if (!name) {
      setNotice('Give it a name first.');
      return;
    }
    if (shape.vertices.length === 0) {
      setNotice('There is nothing to save yet.');
      return;
    }
    keep([...saves.filter((entry) => entry.name !== name), { name, shape: encode(shape), savedAt: new Date().toISOString() }]);
    setSaveName('');
    setNotice(`Saved as "${name}".`);
  };

  const load = (entry: Saved): void => {
    const restored = decode(entry.shape);
    if (!restored) {
      setNotice(`"${entry.name}" could not be read back.`);
      return;
    }
    edit(() => settle(restored, rules, 400));
    setSelected([]);
    setNotice(`Loaded "${entry.name}".`);
    viewerRef.current?.frame();
  };

  // ---------------------------------------------------------------- readouts
  const stats = useMemo(() => report(shape), [shape]);
  /** Which face sizes are actually present, so the legend only names what is on screen. */
  const faceSizes = useMemo(
    () => [...new Set(shape.faces.map((face) => face.vertices.length))].sort((a, b) => a - b),
    [shape.faces],
  );
  const grouped = useMemo(
    () => PRESET_GROUPS.map((group) => ({ group, entries: PRESETS.filter((preset) => preset.group === group) })),
    [],
  );

  return (
    <div className="sl">
      <div className="sl-bar">
        <label className="sl-field">
          Load
          <select
            className="sl-select"
            value=""
            aria-label="Load a well-known shape"
            onChange={(event) => {
              if (event.target.value) loadPreset(event.target.value);
            }}
          >
            <option value="">a shape…</option>
            {grouped.map(({ group, entries }) => (
              <optgroup key={group} label={group}>
                {entries.map((preset) => (
                  <option key={preset.name} value={preset.name}>
                    {preset.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button type="button" className="sl-btn" onClick={straighten} disabled={busy || shape.edges.length < 2}>
          {busy ? 'Working…' : 'Tidy up'}
        </button>
        <button type="button" className="sl-btn" onClick={findFaces} disabled={busy || shape.edges.length < 3}>
          Find faces
        </button>
        <button type="button" className="sl-btn sl-btn--quiet" onClick={clear} disabled={shape.vertices.length === 0}>
          Clear
        </button>

        <span className="sl-spacer" />

        <label className="sl-field" title="Faces of four or more are held flat">
          <input type="checkbox" checked={flatten} onChange={(event) => setFlatten(event.target.checked)} />
          Flatten
        </label>
        <label className="sl-field">
          <input type="checkbox" checked={showVertices} onChange={(event) => setShowVertices(event.target.checked)} />
          Vertices
        </label>
        <label className="sl-field">
          <input type="checkbox" checked={showEdges} onChange={(event) => setShowEdges(event.target.checked)} />
          Edges
        </label>
        <label className="sl-field">
          <input type="checkbox" checked={showFaces} onChange={(event) => setShowFaces(event.target.checked)} />
          Faces
        </label>
        <label className="sl-field">
          Opacity
          <input
            className="sl-slider"
            type="range"
            min={0.05}
            max={0.8}
            step={0.05}
            value={opacity}
            disabled={!showFaces}
            aria-label="How solid the faces are drawn"
            onChange={(event) => setOpacity(Number(event.target.value))}
          />
        </label>
      </div>

      {notice && <p className="sl-notice">{notice}</p>}

      <div className="sl-panes">
        <div className="sl-stage">
          <canvas
            ref={canvasRef}
            className="sl-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-label={
              shape.vertices.length === 0
                ? 'An empty 3D workspace'
                : `A 3D shape with ${stats.vertices} vertices, ${stats.edges} edges and ${stats.faces} faces. Drag to rotate.`
            }
          />
          {shape.vertices.length === 0 && (
            <p className="sl-hint">Load a shape, or pick a kind on the right to drop the first vertex in.</p>
          )}
          <p className="sl-legend">
            {faceSizes.map((sides) => (
              <span key={sides} className="sl-key">
                <span className="sl-swatch" style={{ background: faceTint(sides) }} />
                {sides === 3 ? 'triangle' : sides === 4 ? 'square' : sides === 5 ? 'pentagon' : sides === 6 ? 'hexagon' : `${sides}-gon`}
              </span>
            ))}
            <span className="sl-legend-note">
              drag to rotate · scroll to zoom · click to select · shift-click to add · drag a vertex to move it
            </span>
          </p>
        </div>

        <div className="sl-side">
          <section className="sl-block">
            <h3 className="sl-head">
              Add a vertex
              <span>{selected.length === 0 ? 'loose' : `joined to ${selected.length}`}</span>
            </h3>
            <div className="sl-kinds">
              {shape.kinds.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={entry.id === kind ? 'sl-kind sl-kind--on' : 'sl-kind'}
                  title={`${entry.name} — charge ${entry.charge}, so an edge to another ${entry.name} is ${entry.charge.toFixed(2)} long`}
                  onClick={() => {
                    setChosenKind(entry.id);
                    place(entry.id);
                  }}
                >
                  <span className="sl-dot" style={{ background: entry.colour, transform: `scale(${Math.min(1.6, 0.45 + entry.charge * 0.5)})` }} />
                  {entry.name}
                  <span className="sl-readout">{entry.charge.toFixed(2)}</span>
                </button>
              ))}
            </div>
            <p className="sl-note">
              Charge is size, repulsion and edge length all at once: an edge settles at the square root of the two
              charges multiplied, so two plain vertices sit 1.00 apart and plain-to-huge sits {Math.sqrt(1 * 3.2).toFixed(2)} apart.
            </p>
          </section>

          <section className="sl-block">
            <h3 className="sl-head">
              Selection
              <span>{selected.length === 0 ? 'nothing' : `${selected.length} selected`}</span>
            </h3>

            {shape.vertices.length > 0 && (
              // A vertex on the far side of a solid is behind two translucent faces and
              // most of the edges, so there has to be a way to reach one that is not
              // aiming at it. Clicking here toggles, which is what building a face wants.
              <ul className="sl-vertices">
                {shape.vertices.map((vertex) => (
                  <li key={vertex.id}>
                    <button
                      type="button"
                      className={selected.includes(vertex.id) ? 'sl-chip sl-chip--on' : 'sl-chip'}
                      title={`${kindOf(shape, vertex).name}, charge ${chargeOf(shape, vertex).toFixed(2)}${vertex.pinned ? ', pinned' : ''}`}
                      onClick={() => toggle(vertex.id, true)}
                    >
                      <span className="sl-dot" style={{ background: kindOf(shape, vertex).colour }} />
                      {vertex.id}
                      {vertex.pinned && <span className="sl-pin">·</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {selected.length === 0 ? (
              <p className="sl-empty">Click a vertex, edge or face in the view, or a number above. Clicking an edge or a face selects the vertices it is made of.</p>
            ) : (
              <>
                <div className="sl-tools">
                  <button type="button" className="sl-btn" onClick={() => place(kind)}>
                    Add joined vertex
                  </button>
                  {selected.length >= 2 && !pairEdge && (
                    <button type="button" className="sl-btn" onClick={join}>
                      {selected.length === 2 ? 'Join' : 'Join all pairs'}
                    </button>
                  )}
                  {pairEdge && (
                    <button type="button" className="sl-btn" onClick={() => edit((current) => deleteEdge(current, pairEdge.id, rules))}>
                      Delete edge
                    </button>
                  )}
                  {selected.length >= 3 && !selectedFace && (
                    <button type="button" className="sl-btn" onClick={makeFace}>
                      Make face
                    </button>
                  )}
                  {selectedFace && (
                    <button type="button" className="sl-btn" onClick={() => edit((current) => deleteFace(current, selectedFace.id, rules))}>
                      Delete face
                    </button>
                  )}
                  <button type="button" className="sl-btn sl-btn--quiet" onClick={removeSelected}>
                    Delete {selected.length === 1 ? 'vertex' : 'vertices'}
                  </button>
                </div>

                {only && (
                  <div className="sl-chosen">
                    <p className="sl-chosen-head">
                      Vertex {only.id}
                      <span>
                        {kindOf(shape, only).name} · charge {chargeOf(shape, only).toFixed(2)}
                      </span>
                    </p>
                    <div className="sl-tools">
                      <label className="sl-field">
                        Kind
                        <select
                          className="sl-select sl-select--tight"
                          value={only.kind}
                          aria-label="Change this vertex's kind"
                          onChange={(event) => edit((current) => setKind(current, only.id, event.target.value, rules))}
                        >
                          {shape.kinds.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className={only.pinned ? 'sl-btn sl-btn--primary' : 'sl-btn'}
                        onClick={() => edit((current) => setPinned(current, only.id, !only.pinned, rules))}
                      >
                        {only.pinned ? 'Unpin' : 'Pin'}
                      </button>
                    </div>
                    {shape.edges.filter((edge) => edge.a === only.id || edge.b === only.id).length > 0 && (
                      <ul className="sl-edges">
                        {shape.edges
                          .filter((edge) => edge.a === only.id || edge.b === only.id)
                          .map((edge) => (
                            <li key={edge.id}>
                              <span className="sl-edge-name">to {edge.a === only.id ? edge.b : edge.a}</span>
                              <span className="sl-readout" title="settled length, against the length this pair would take alone">
                                {edgeLength(shape, edge).toFixed(3)} / {naturalLength(shape, edge).toFixed(3)}
                              </span>
                              <button
                                type="button"
                                className="sl-btn sl-btn--quiet"
                                onClick={() => edit((current) => deleteEdge(current, edge.id, rules))}
                              >
                                cut
                              </button>
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <section className="sl-block">
            <h3 className="sl-head">
              Kinds
              <span>charge sets everything</span>
            </h3>
            <ul className="sl-kind-list">
              {shape.kinds.map((entry) => (
                <li key={entry.id}>
                  <input
                    type="color"
                    className="sl-colour"
                    value={entry.colour}
                    aria-label={`Colour for ${entry.name}`}
                    onChange={(event) => adjust(entry.id, { colour: event.target.value })}
                  />
                  <span className="sl-kind-name">{entry.name}</span>
                  <input
                    className="sl-slider"
                    type="range"
                    min={0.2}
                    max={6}
                    step={0.05}
                    value={entry.charge}
                    aria-label={`Charge for ${entry.name}`}
                    onChange={(event) => adjust(entry.id, { charge: Number(event.target.value) })}
                  />
                  <span className="sl-readout">{entry.charge.toFixed(2)}</span>
                  {!entry.stock && (
                    <button type="button" className="sl-btn sl-btn--quiet" onClick={() => forgetKind(entry.id)}>
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="sl-tools">
              <input
                className="sl-input sl-input--tight"
                placeholder="new kind"
                value={newKind.name}
                aria-label="Name for a new vertex kind"
                onChange={(event) => setNewKind({ ...newKind, name: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') defineKind();
                }}
              />
              <input
                type="color"
                className="sl-colour"
                value={newKind.colour}
                aria-label="Colour for the new kind"
                onChange={(event) => setNewKind({ ...newKind, colour: event.target.value })}
              />
              <input
                className="sl-number"
                type="number"
                min={0.05}
                max={20}
                step={0.05}
                value={newKind.charge}
                aria-label="Charge for the new kind"
                onChange={(event) => setNewKind({ ...newKind, charge: Number(event.target.value) })}
              />
              <button type="button" className="sl-btn" onClick={defineKind}>
                Define
              </button>
            </div>
          </section>

          <section className="sl-block">
            <h3 className="sl-head">
              Counts
              <span>
                {stats.vertices} · {stats.edges} · {stats.faces}
              </span>
            </h3>
            <p className="sl-sum">
              {stats.euler === null ? (
                'No faces yet, so there is nothing to count up.'
              ) : (
                <>
                  V − E + F = {stats.vertices} − {stats.edges} + {stats.faces} = <strong>{stats.euler}</strong>
                  {stats.euler === 2 && ' — a sphere, which every closed convex solid is.'}
                  {stats.euler === 0 && ' — a torus. One hole.'}
                  {stats.euler === 1 && ' — a disc: this is a patch with a rim, not a closed solid.'}
                </>
              )}
            </p>
            {stats.edges > 0 && (
              <p className="sl-sum">
                Edges run {stats.shortest.toFixed(3)} to {stats.longest.toFixed(3)}
                {stats.spread < 1e-3 ? (
                  <strong> — every edge the same, to within a thousandth.</strong>
                ) : (
                  <> — a spread of {(stats.spread * 100).toFixed(1)}%.</>
                )}
              </p>
            )}
          </section>
        </div>
      </div>

      <section className="sl-saves" aria-labelledby="sl-saves-head">
        <h3 id="sl-saves-head" className="sl-head">
          Saved shapes
          <span>kept in this browser only</span>
        </h3>
        <div className="sl-tools">
          <input
            className="sl-input"
            placeholder="name this shape"
            value={saveName}
            aria-label="Name for the saved shape"
            onChange={(event) => setSaveName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save();
            }}
          />
          <button type="button" className="sl-btn" onClick={save}>
            Save
          </button>
        </div>
        {saves.length === 0 ? (
          <p className="sl-empty">Nothing saved yet.</p>
        ) : (
          <ul className="sl-saved-list">
            {saves.map((entry) => (
              <li key={entry.name}>
                <span className="sl-saved-name">{entry.name}</span>
                <span className="sl-readout">
                  {entry.shape.vertices?.length ?? 0} vertices · {entry.shape.faces?.length ?? 0} faces
                </span>
                <button type="button" className="sl-btn sl-btn--quiet" onClick={() => load(entry)}>
                  Load
                </button>
                <button
                  type="button"
                  className="sl-btn sl-btn--quiet"
                  onClick={() => {
                    keep(saves.filter((item) => item.name !== entry.name));
                    setNotice(`Deleted "${entry.name}".`);
                  }}
                >
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
