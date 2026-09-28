import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import {
  coordinationOf,
  element,
  shellOf,
  stateOf,
  statesOf,
  ELEMENTS,
  GROUP_NAMES,
  GROUP_ORDER,
} from './molecules/elements';
import { BOND_COLOURS, createViewer, PAIR_COLOUR, type Viewer } from './molecules/scene';
import {
  addAtom,
  atomAt,
  BOND_ORDERS,
  bondsAt,
  chargeAt,
  crowded,
  decode,
  deleteAtom,
  domainsAt,
  EMPTY,
  encode,
  formula,
  formulaText,
  IONIC_GAP,
  linkAtoms,
  lonePairsAt,
  ORDER_NAMES,
  PRESETS,
  reorderBond,
  retypeBond,
  setCharge,
  settle,
  shapeAt,
  suggestKind,
  tidy,
  unlink,
  type BondKind,
  type BondOrder,
  type Molecule,
  type SavedMolecule,
} from './molecules/model';
import './molecules/molecules.css';

const STORE = 'motleytech-molecules';
const SHELL_DEFAULT = 0.45;

const NUMERALS = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

/** Oxidation states are written in Roman numerals, so Co(III) reads the way a textbook writes it. */
function roman(value: number): string {
  const size = Math.abs(value);
  return (value < 0 ? '−' : '') + (NUMERALS[size] ?? String(size));
}

interface Saved {
  name: string;
  molecule: SavedMolecule;
  savedAt: string;
}

function readSaves(): Saved[] {
  try {
    const raw = window.localStorage.getItem(STORE);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is Saved => item && typeof item.name === 'string' && item.molecule && typeof item.molecule === 'object',
    );
  } catch {
    return [];
  }
}

/** The canvas background, taken from the page so the scene matches the active theme. */
function pageColour(): string {
  if (typeof window === 'undefined') return '#0b1020';
  const found = getComputedStyle(document.documentElement).getPropertyValue('--code-bg').trim();
  return found || '#0b1020';
}

export default function MoleculeBuilder(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);

  const [molecule, setMolecule] = useState<Molecule>(EMPTY);
  const [symbol, setSymbol] = useState('C');
  const [selected, setSelected] = useState<number | null>(null);
  const [linking, setLinking] = useState(false);
  const [shell, setShell] = useState(SHELL_DEFAULT);
  const [showShells, setShowShells] = useState(true);
  const [usePairs, setUsePairs] = useState(true);
  const [bondChoice, setBondChoice] = useState<'auto' | BondKind>('auto');
  const [orderChoice, setOrderChoice] = useState<BondOrder>(1);
  const [saves, setSaves] = useState<Saved[]>([]);
  const [saveName, setSaveName] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => setSaves(readSaves()), []);

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
    // The site theme switcher repaints the page under us, so follow it.
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
    viewerRef.current?.draw(molecule, {
      shell,
      showShells,
      showPairs: usePairs,
      selected,
      pending: linking ? selected : null,
    });
  }, [molecule, shell, showShells, usePairs, selected, linking]);

  // ---------------------------------------------------------------- editing
  const anchor = selected !== null && atomAt(molecule, selected) ? selected : null;

  /** Every edit relaxes, and every relaxation needs to know whether lone pairs count. */
  const rules = useMemo(() => ({ lonePairs: usePairs }), [usePairs]);

  const newBond = (): { kind?: BondKind; order: BondOrder } => ({
    kind: bondChoice === 'auto' ? undefined : bondChoice,
    order: orderChoice,
  });

  const place = (which: string): void => {
    const step = addAtom(molecule, which, anchor, newBond(), rules);
    setMolecule(step.molecule);
    // Selecting the atom just added is what makes a chain grow, but an atom that can only
    // manage one bond has nothing left to hang anything off, so keep the anchor instead.
    // Otherwise clicking carbon and then hydrogen four times builds a chain of hydrogens
    // rather than the methane everybody means.
    const canAnchor = element(which).valence > 1;
    setSelected(canAnchor || anchor === null ? step.id : anchor);
    setLinking(false);
    setNotice(
      anchor === null
        ? `Added ${element(which).name.toLowerCase()}. Pick an element again to hang the next atom off it.`
        : '',
    );
  };

  const pick = (id: number): void => {
    if (linking && selected !== null) {
      if (selected === id) {
        setLinking(false);
        setNotice('An atom cannot bond to itself, so that is off again.');
        return;
      }
      const joined = linkAtoms(molecule, selected, id, newBond(), rules);
      setLinking(false);
      if (joined.error) {
        setNotice(joined.error);
        return;
      }
      setMolecule(joined.molecule);
      setSelected(id);
      setNotice('Bonded.');
      return;
    }
    setSelected(id);
    setNotice('');
  };

  /**
   * A drag that starts and ends on the canvas still fires a click, so rotating the view
   * would otherwise reselect whatever atom happened to be under the cursor when you let
   * go. Only a press that barely moved counts as aiming at something.
   */
  const pressRef = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    pressRef.current = { x: event.clientX, y: event.clientY };
  };

  const onCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    const press = pressRef.current;
    pressRef.current = null;
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) return;

    const hit = viewerRef.current?.pick(event.clientX, event.clientY) ?? null;
    if (hit === null) {
      setSelected(null);
      setLinking(false);
      return;
    }
    pick(hit);
  };

  const remove = (): void => {
    if (selected === null) return;
    setMolecule(deleteAtom(molecule, selected, rules));
    setSelected(null);
    setLinking(false);
    setNotice('');
  };

  const clear = (): void => {
    setMolecule(EMPTY);
    setSelected(null);
    setLinking(false);
    setNotice('');
    viewerRef.current?.frame();
  };

  /**
   * The expensive operations get a paint in between, so the button can say it is working
   * rather than the page appearing to hang for half a second.
   */
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

  const straighten = (): void =>
    slowly(() => {
      setMolecule((current) => tidy(current, rules));
      setNotice('Tidied up.');
    });

  const loadPreset = (name: string): void => {
    const found = PRESETS.find((entry) => entry.name === name);
    if (!found) return;
    slowly(() => {
      setMolecule(found.build(rules));
      setSelected(null);
      setLinking(false);
      setNotice(found.note);
      viewerRef.current?.frame();
    });
  };

  /**
   * Turning lone pairs on or off changes the geometry, not just the picture, so the molecule
   * has to be rebuilt either way. That is the whole demonstration: water is straight without
   * them and bent with them, and nothing else about the model changes.
   */
  const togglePairs = (on: boolean): void => {
    setUsePairs(on);
    if (molecule.bonds.length === 0) return;
    slowly(() => {
      setMolecule((current) => tidy(current, { lonePairs: on }));
      setNotice(
        on
          ? 'Lone pairs are counted again, and everything with a spare pair has bent.'
          : 'Lone pairs ignored. This is the older, simpler model, where water comes out straight.',
      );
    });
  };

  // ---------------------------------------------------------------- saving
  const keep = (saved: Saved[]): void => {
    setSaves(saved);
    try {
      window.localStorage.setItem(STORE, JSON.stringify(saved));
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
    if (molecule.atoms.length === 0) {
      setNotice('There is nothing to save yet.');
      return;
    }
    const entry: Saved = { name, molecule: encode(molecule), savedAt: new Date().toISOString() };
    keep([...saves.filter((item) => item.name !== name), entry]);
    setSaveName('');
    setNotice(`Saved as "${name}".`);
  };

  const load = (entry: Saved): void => {
    const restored = decode(entry.molecule);
    if (!restored) {
      setNotice(`"${entry.name}" could not be read back.`);
      return;
    }
    // Lone pairs are not saved, so the loaded molecule has none until it settles. Downhill
    // only, from coordinates that were already at rest, so the shape does not jump.
    setMolecule(settle(restored, { ...rules, steps: 900, hops: 1 }));
    setSelected(null);
    setLinking(false);
    setNotice(`Loaded "${entry.name}".`);
    viewerRef.current?.frame();
  };

  const forget = (name: string): void => {
    keep(saves.filter((item) => item.name !== name));
    setNotice(`Deleted "${name}".`);
  };

  // ---------------------------------------------------------------- readouts
  const parts = useMemo(() => formula(molecule), [molecule]);
  const overloaded = useMemo(() => crowded(molecule), [molecule]);
  const ionicCount = molecule.bonds.filter((bond) => bond.kind === 'ionic').length;
  const chosen = selected === null ? null : atomAt(molecule, selected);
  const chosenBonds = chosen ? bondsAt(molecule, chosen.id) : [];
  // Hand-set charge plus whatever the ionic bonds have transferred, which is what the chemistry
  // and the drawn shell both go by.
  const chosenCharge = chosen ? chargeAt(molecule, chosen.id) : 0;
  // The oxidation state that charge names, when the table knows one. What makes the panel able
  // to say 'low spin, and a quarter smaller for it' rather than just printing a number.
  const chosenState = chosen ? stateOf(chosen.symbol, chosenCharge) : undefined;
  const nextKind: BondKind | null =
    bondChoice !== 'auto' ? bondChoice : chosen ? suggestKind(chosen.symbol, symbol) : null;

  return (
    <div className="mb">
      <div className="mb-bar">
        <label className="mb-field">
          Load
          <select
            className="mb-select"
            value=""
            aria-label="Load an example molecule"
            onChange={(event) => {
              if (event.target.value) loadPreset(event.target.value);
            }}
          >
            <option value="">an example…</option>
            {PRESETS.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="mb-btn" onClick={straighten} disabled={busy || molecule.bonds.length < 2}>
          {busy ? 'Working…' : 'Tidy up'}
        </button>
        <button type="button" className="mb-btn mb-btn--quiet" onClick={clear} disabled={molecule.atoms.length === 0}>
          Clear
        </button>
        <span className="mb-spacer" />
        <label className="mb-field">
          <input type="checkbox" checked={showShells} onChange={(event) => setShowShells(event.target.checked)} />
          Shells
        </label>
        <label className="mb-field" title="Lone pairs change the shape, so this rebuilds the molecule">
          <input
            type="checkbox"
            checked={usePairs}
            disabled={busy}
            onChange={(event) => togglePairs(event.target.checked)}
          />
          Lone pairs
        </label>
        <label className="mb-field">
          Size
          <input
            className="mb-slider"
            type="range"
            min={0.25}
            max={1}
            step={0.05}
            value={shell}
            disabled={!showShells}
            aria-label="Shell size as a fraction of the van der Waals radius"
            onChange={(event) => setShell(Number(event.target.value))}
          />
          <span className="mb-readout">{Math.round(shell * 100)}%</span>
        </label>
      </div>

      {notice && <p className="mb-notice">{notice}</p>}

      <div className="mb-panes">
        <div className="mb-stage">
          <canvas
            ref={canvasRef}
            className="mb-canvas"
            onPointerDown={onPointerDown}
            onClick={onCanvasClick}
            aria-label={
              molecule.atoms.length === 0
                ? 'An empty 3D workspace'
                : `A 3D model of ${formulaText(molecule)}, ${molecule.atoms.length} atoms and ${molecule.bonds.length} bonds. Drag to rotate.`
            }
          />
          {molecule.atoms.length === 0 && (
            <p className="mb-hint">Pick an element to drop the first atom in, or load an example.</p>
          )}
          <p className="mb-legend">
            <span className="mb-key" style={{ background: BOND_COLOURS.covalent }} /> covalent
            <span className="mb-key" style={{ background: BOND_COLOURS.ionic }} /> ionic
            {usePairs && (
              <>
                <span className="mb-key" style={{ background: PAIR_COLOUR }} /> lone pair
              </>
            )}
            <span className="mb-legend-note">drag to rotate · scroll to zoom · click an atom to select it</span>
          </p>
        </div>

        <div className="mb-side">
          <section className="mb-block">
            <h3 className="mb-head">
              Add an atom
              <span>{anchor === null ? 'unbonded' : `bonded to ${element(chosen!.symbol).symbol}${chosen!.id}`}</span>
            </h3>
            {GROUP_ORDER.map((group) => (
              <div key={group} className="mb-group">
                <span className="mb-group-name">{GROUP_NAMES[group]}</span>
                <div className="mb-elements">
                  {ELEMENTS.filter((entry) => entry.group === group).map((entry) => (
                    <button
                      key={entry.symbol}
                      type="button"
                      className={entry.symbol === symbol ? 'mb-el mb-el--on' : 'mb-el'}
                      title={
                        entry.block === 'transition'
                          ? `${entry.name} — ${entry.states
                              .map((state) => `${entry.symbol}(${roman(state.charge)})`)
                              .join(', ')}`
                          : `${entry.name} — usually makes ${entry.valence} bond${entry.valence === 1 ? '' : 's'}`
                      }
                      aria-label={entry.name}
                      onClick={() => {
                        setSymbol(entry.symbol);
                        place(entry.symbol);
                      }}
                    >
                      <span className="mb-dot" style={{ background: entry.colour }} />
                      {entry.symbol}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="mb-tools">
              <label className="mb-field">
                Bonds
                <select
                  className="mb-select"
                  value={bondChoice}
                  aria-label="Bond type for new bonds"
                  onChange={(event) => setBondChoice(event.target.value as 'auto' | BondKind)}
                >
                  <option value="auto">decide for me</option>
                  <option value="covalent">always covalent</option>
                  <option value="ionic">always ionic</option>
                </select>
              </label>
              <label className="mb-field">
                Order
                <select
                  className="mb-select"
                  value={orderChoice}
                  aria-label="Bond order for new bonds"
                  onChange={(event) => setOrderChoice(Number(event.target.value) as BondOrder)}
                >
                  {BOND_ORDERS.map((order) => (
                    <option key={order} value={order}>
                      {ORDER_NAMES[order]}
                    </option>
                  ))}
                </select>
              </label>
              {nextKind && (
                <span className="mb-readout">
                  next: {ORDER_NAMES[orderChoice]} {nextKind}
                </span>
              )}
            </div>
          </section>

          <section className="mb-block">
            <h3 className="mb-head">
              {molecule.atoms.length === 0 ? (
                'Nothing yet'
              ) : (
                <span className="mb-formula">
                  {parts.map(({ symbol: part, count }) => (
                    <span key={part}>
                      {part}
                      {count > 1 && <sub>{count}</sub>}
                    </span>
                  ))}
                </span>
              )}
              <span>
                {molecule.atoms.length} {molecule.atoms.length === 1 ? 'atom' : 'atoms'} ·{' '}
                {molecule.bonds.length} {molecule.bonds.length === 1 ? 'bond' : 'bonds'}
                {ionicCount > 0 ? ` · ${ionicCount} ionic` : ''}
                {molecule.lonePairs.length > 0 ? ` · ${molecule.lonePairs.length} lone pairs` : ''}
              </span>
            </h3>

            {molecule.atoms.length === 0 ? (
              <p className="mb-empty">Atoms you add will be listed here. Selecting one here is the same as clicking it in the view.</p>
            ) : (
              <ul className="mb-atoms">
                {molecule.atoms.map((atom) => {
                  const info = element(atom.symbol);
                  const count = bondsAt(molecule, atom.id).length;
                  return (
                    <li key={atom.id} className={atom.id === selected ? 'mb-atom mb-atom--on' : 'mb-atom'}>
                      <button type="button" className="mb-atom-pick" onClick={() => pick(atom.id)}>
                        <span className="mb-dot" style={{ background: info.colour }} />
                        <span className="mb-atom-name">
                          {info.symbol}
                          {atom.id}
                        </span>
                        <span className="mb-atom-meta">
                          {/* Against the most it manages, not the fewest, so that sulfur
                              hexafluoride reads as 6 of 6 rather than the alarming 6 of 2, and
                              against the chosen oxidation state where there is one. */}
                          {count} of {coordinationOf(atom.symbol, chargeAt(molecule, atom.id))}
                          {lonePairsAt(molecule, atom.id) > 0 && (
                            <span className="mb-pairs" title={`${lonePairsAt(molecule, atom.id)} lone pairs`}>
                              {'·'.repeat(lonePairsAt(molecule, atom.id) * 2)}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {chosen && (
              <div className="mb-chosen">
                <p className="mb-chosen-head">
                  {element(chosen.symbol).name} {chosen.id}
                  <span className="mb-shape">{shapeAt(molecule, chosen.id)}</span>
                  {chosenCharge !== 0 && (
                    <span className="mb-shape">
                      ion, {shellOf(chosen.symbol, chosenCharge).toFixed(2)} Å across
                    </span>
                  )}
                </p>
                {/* The electron sum, spelled out, because the shape is a consequence of it and
                    the whole point is that you can check the arithmetic yourself. */}
                <p className="mb-sum">
                  {element(chosen.symbol).block === 'main' ? (
                    <>
                      {element(chosen.symbol).electrons} valence electrons
                      {chosenCharge !== 0 && <> {chosenCharge > 0 ? '−' : '+'} {Math.abs(chosenCharge)} for the charge</>}
                      {' − '}
                      {chosenBonds.reduce((sum, bond) => sum + (bond.kind === 'ionic' ? 0 : bond.order), 0)} in
                      shared bonds{' = '}
                      {lonePairsAt(molecule, chosen.id)}{' '}
                      {lonePairsAt(molecule, chosen.id) === 1 ? 'lone pair' : 'lone pairs'}
                      {', '}
                      {domainsAt(molecule, chosen.id)} domains in all
                    </>
                  ) : (
                    <>
                      A transition metal: counting electrons does not predict its shape, so it
                      gets no lone pairs. Its coordination number is looked up, not worked out:{' '}
                      {coordinationOf(chosen.symbol, chosenCharge)} ligands.
                    </>
                  )}
                </p>
                {/* Cobalt is the reason this control exists. Co(II) and Co(III) are different
                    sizes and different shapes, and no amount of counting gets from one to the
                    other — so the state is chosen, and everything else follows from it. */}
                {element(chosen.symbol).block === 'transition' && (
                  <div className="mb-tools">
                    <label className="mb-field">
                      State
                      <select
                        className="mb-select"
                        value={chosen.charge}
                        aria-label="Oxidation state"
                        onChange={(event) =>
                          setMolecule(setCharge(molecule, chosen.id, Number(event.target.value), rules))
                        }
                      >
                        <option value={0}>uncharged — the metal on its own</option>
                        {statesOf(chosen.symbol).map((state) => (
                          <option key={state.charge} value={state.charge}>
                            {chosen.symbol}({roman(state.charge)}) · {state.radius.toFixed(3)} Å ·{' '}
                            {state.coordination} ligands
                            {state.flat === state.coordination ? ', square' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                {chosenState?.note && <p className="mb-sum">{chosenState.note}.</p>}
                <div className="mb-tools">
                  <span className="mb-readout">Charge</span>
                  <div className="mb-step">
                    <button
                      type="button"
                      className="mb-btn mb-btn--quiet"
                      aria-label="Decrease formal charge"
                      onClick={() => setMolecule(setCharge(molecule, chosen.id, chosen.charge - 1, rules))}
                    >
                      −
                    </button>
                    <span className="mb-charge">{chosenCharge > 0 ? `+${chosenCharge}` : chosenCharge}</span>
                    <button
                      type="button"
                      className="mb-btn mb-btn--quiet"
                      aria-label="Increase formal charge"
                      onClick={() => setMolecule(setCharge(molecule, chosen.id, chosen.charge + 1, rules))}
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="mb-tools">
                  <button
                    type="button"
                    className={linking ? 'mb-btn mb-btn--primary' : 'mb-btn'}
                    onClick={() => {
                      setLinking(!linking);
                      setNotice(linking ? '' : 'Now click the atom to bond it to.');
                    }}
                    disabled={molecule.atoms.length < 2}
                  >
                    {linking ? 'Cancel bond' : 'Bond to…'}
                  </button>
                  <button type="button" className="mb-btn" onClick={remove}>
                    Delete atom
                  </button>
                </div>
                {chosenBonds.length > 0 && (
                  <ul className="mb-bonds">
                    {chosenBonds.map((bond) => {
                      const other = atomAt(molecule, bond.a === chosen.id ? bond.b : bond.a);
                      if (!other) return null;
                      const gap = Math.abs(
                        element(chosen.symbol).electronegativity - element(other.symbol).electronegativity,
                      );
                      return (
                        <li key={bond.id}>
                          <span className="mb-bond-kind" style={{ background: BOND_COLOURS[bond.kind] }} />
                          <span className="mb-bond-name">
                            to {element(other.symbol).symbol}
                            {other.id}
                          </span>
                          <span className="mb-atom-meta" title="difference in electronegativity">
                            Δχ {gap.toFixed(2)}
                          </span>
                          <select
                            className="mb-select mb-select--tight"
                            value={bond.order}
                            aria-label={`Order of the bond to ${element(other.symbol).symbol}${other.id}`}
                            onChange={(event) =>
                              setMolecule(
                                reorderBond(molecule, bond.id, Number(event.target.value) as BondOrder, rules),
                              )
                            }
                          >
                            {BOND_ORDERS.map((order) => (
                              <option key={order} value={order}>
                                {ORDER_NAMES[order]}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="mb-btn mb-btn--quiet"
                            onClick={() =>
                              setMolecule(
                                retypeBond(molecule, bond.id, bond.kind === 'ionic' ? 'covalent' : 'ionic'),
                              )
                            }
                          >
                            make {bond.kind === 'ionic' ? 'covalent' : 'ionic'}
                          </button>
                          <button
                            type="button"
                            className="mb-btn mb-btn--quiet"
                            onClick={() => setMolecule(unlink(molecule, bond.id, rules))}
                          >
                            break
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {overloaded.length > 0 && (
              <p className="mb-warn">
                {overloaded
                  .map(
                    (report) =>
                      `${element(report.atom.symbol).symbol}${report.atom.id} has ${report.bonds} bonds where ${element(report.atom.symbol).name.toLowerCase()} usually makes ${report.usual}`,
                  )
                  .join('; ')}
                . Drawn anyway — this is geometry, not chemistry.
              </p>
            )}
          </section>
        </div>
      </div>

      <section className="mb-saves" aria-labelledby="mb-saves-head">
        <h3 id="mb-saves-head" className="mb-head">
          Saved molecules
          <span>
            ionic when the electronegativities differ by {IONIC_GAP} or more
          </span>
        </h3>
        <div className="mb-tools">
          <input
            className="mb-input"
            placeholder="name this molecule"
            value={saveName}
            aria-label="Name for the saved molecule"
            onChange={(event) => setSaveName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save();
            }}
          />
          <button type="button" className="mb-btn" onClick={save}>
            Save
          </button>
        </div>
        {saves.length === 0 ? (
          <p className="mb-empty">Nothing saved yet. Saves live in this browser only.</p>
        ) : (
          <ul className="mb-saved-list">
            {saves.map((entry) => (
              <li key={entry.name}>
                <span className="mb-saved-name">{entry.name}</span>
                <span className="mb-atom-meta">
                  {entry.molecule.atoms?.length ?? 0} atoms
                </span>
                <button type="button" className="mb-btn mb-btn--quiet" onClick={() => load(entry)}>
                  Load
                </button>
                <button type="button" className="mb-btn mb-btn--quiet" onClick={() => forget(entry.name)}>
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
