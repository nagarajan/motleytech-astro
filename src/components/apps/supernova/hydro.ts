import {
  A_RAD,
  C_LIGHT,
  G,
  K_B,
  M_SUN,
  M_U,
  MEV,
  RHO_NUC,
  SPECIES_COUNT,
  SP_FE,
  SP_FREE,
  SP_HE,
} from './constants';
import {
  coldEnergy,
  coldPressure,
  meanIonMass,
  pressureAndSound,
  temperatureFrom,
  thermalEnergyOf,
  thermalPressure,
} from './eos';
import { buildStar } from './progenitor';
import {
  burnZone,
  captureNeutrinoEnergy,
  FREEZE_TEMP,
  neutrinosEscape,
  NSE_TEMP,
  poolLightNuclei,
  relaxToNse,
  targetYe,
} from './nuclear';
import type { Frame, Phase, RunResult, RunSettings } from './types';

/**
 * A one-dimensional Lagrangian hydrodynamics solver: the star is cut into a few hundred
 * concentric shells of fixed mass, and the job is to work out where each one goes.
 *
 * Lagrangian is the right choice here, for a reason worth stating. The alternative is to
 * fix a grid in space and watch matter flow through it, which would mean either wasting
 * almost every cell on the hydrogen envelope where nothing happens for hours, or losing the
 * neutron star between two grid points. Following the mass instead means a shell that
 * starts in the iron core stays in the iron core — from fifteen hundred kilometres down to
 * ten — and composition never needs advecting, because it never leaves its shell.
 *
 * The scheme is the classic staggered leapfrog with von Neumann-Richtmyer artificial
 * viscosity: velocities live on shell boundaries, everything else in the middle of a shell,
 * and the two are offset by half a step. It is the oldest scheme in computational
 * astrophysics and still the one to choose here, because spherical collapse is the problem
 * it was invented for.
 *
 * What this cannot do is convection, and that is not a small caveat: it is the reason
 * spherically symmetric models of core-collapse supernovae mostly fail to explode, and the
 * reason the neutrino heating below carries an adjustable factor rather than a derived one.
 */

// ---------------------------------------------------------------- tuning

/**
 * Artificial viscosity constants. A real shock front is a few particle mean free paths
 * thick, which is nothing next to a zone, so the scheme does not resolve it and does not
 * try. Instead it adds a pressure that appears only where matter is being compressed. That
 * smears the discontinuity across two or three zones while dissipating exactly the right
 * amount of energy into heat, so the jump conditions across the smeared front come out
 * right even though the front itself is a fiction.
 *
 * There is an obvious worry for a collapse problem: during homologous infall the entire
 * core is compressing, so is this heating everything spuriously? It is not, because of the
 * square. Viscous pressure goes as the square of the velocity jump across one zone, and in
 * smooth homologous flow that jump is proportional to the zone width — so the spurious
 * heating falls away as resolution improves. At the resolution used here it sits several
 * orders of magnitude below the real pressure during infall, and jumps above it the moment
 * a genuine shock arrives.
 */
const Q_QUADRATIC = 2.0;
const Q_LINEAR = 0.5;
const CFL = 0.35;

/**
 * Neutrino opacity per gram for a typical supernova neutrino. The cross section on a
 * nucleon goes as the square of the energy; at fifteen MeV this gives a mean free path of
 * about a kilometre at 10^12 g/cm^3, which is what puts the neutrinosphere where it is.
 */
const NU_OPACITY = 2.4e-18; // cm^2/g

/** Binding energy the proto-neutron star radiates away as it settles, in erg. */
const PNS_BINDING = 2.8e53;
/** Time constant of that cooling. SN 1987A's neutrinos arrived over about ten seconds. */
const PNS_COOLING_TIME = 3.0;
/** Mean squared neutrino energy in units of (15 MeV)^2, which sets the heating rate. */
const NU_ENERGY2 = 1.15;
/** Above this a neutron star cannot hold itself up, and becomes a black hole. */
const MAX_NS_MASS = 2.3 * M_SUN;
/** Density defining the edge of the proto-neutron star, by the usual convention. */
const PNS_DENSITY = 1e11;
/** Where the excision boundary ends up once the neutron star has finished shrinking. */
const PNS_FINAL_RADIUS = 2.4e6; // cm
/** How long that takes. Set by how fast neutrinos can carry the heat out. */
const PNS_CONTRACTION_TIME = 0.5;

/** How far inside the shock the inner boundary is allowed to sit, once there is a shock. */
const EXCISE_FRACTION = 0.003;

/** How much of the proto-neutron star is kept live; the rest is only gravity. */
const PNS_EXCISE_FRACTION = 0.7;

/**
 * How far the shock must fall back below its stalling radius before the proto-neutron
 * star may be trimmed.
 *
 * The trimming is only ever needed in a model that fails, where matter goes on raining
 * onto the star for seconds and the zones at its surface are squeezed to nothing. But it
 * cannot simply be switched on after a fixed delay, because the gain region sits close
 * above that surface and trimming it takes away the very thing doing the work: applied
 * from the start it stopped the star exploding at any heating factor, and applied after
 * half a second regardless it still cost a fifth of the explosion energy.
 *
 * The condition it waits for instead is a shock that has stalled and not come back. A
 * model on its way to exploding has revived long before this — revival happens within two
 * to five hundred milliseconds of bounce — so an exploding star never notices this code
 * exists, and a failing one gets cheap at exactly the moment its fate stops being in
 * question.
 */
const PNS_EXCISE_AFTER = 0.6;

/** Fraction of the escape speed above which matter counts as ejecta and is never retired. */
const ESCAPE_MARGIN = 0.05; // s
/** Relaxation time for electron capture towards its equilibrium track. */
/** Largest share of a zone's heat that escaping capture neutrinos may carry per step. */
const MAX_CAPTURE_SPEND = 0.25;

const CAPTURE_TIME = 1e-4; // s
/** Below this density the deleptonisation fit does not apply and is not used. */
const CAPTURE_FLOOR = 3e7; // g/cm^3

export interface Options extends RunSettings {
  onProgress?: (fraction: number, note: string) => void;
  maxSteps?: number;
  /** Where to stop, in seconds after bounce. */
  endTime?: number;
  /** Report timestep diagnostics through onProgress. Used when tuning the solver. */
  diagnose?: boolean;
}

function describe(phase: Phase, time: number, bounceTime: number, bounced: boolean): string {
  if (!bounced) return `collapsing · ${(time * 1e3).toFixed(0)} ms`;
  const sb = time - bounceTime;
  const when =
    sb < 1 ? `${(sb * 1e3).toFixed(1)} ms` : sb < 3600 ? `${sb.toFixed(1)} s` : `${(sb / 3600).toFixed(1)} h`;
  return `${phase} · ${when} after bounce`;
}

export function runCollapse(options: Options): RunResult {
  const started = Date.now();
  const star = buildStar();
  const n = star.count;
  const { dm, mass, r, v, rho, temp, ye, comp, energy } = star;

  const pressure = new Float64Array(n);
  const sound = new Float64Array(n);
  const viscosity = new Float64Array(n);
  const ionMass = new Float64Array(n);
  const cold = new Float64Array(n);
  const heating = new Float64Array(n);
  const cooling = new Float64Array(n);
  const balance = new Float64Array(n);
  const burnRate = new Float64Array(n);
  const depth = new Float64Array(n + 1);

  // ---------------------------------------------------------------- run state
  let time = 0;
  let dt = 1e-5;
  let step = 0;
  /** First live zone. Everything below has been absorbed into the compact object. */
  let inner = 0;

  let bounced = false;
  let bounceTime = 0;
  let peakDensity = 0;
  let phase: Phase = 'infall';
  let failed = false;

  let neutrinoEnergy = 0;
  let burnEnergy = 0;
  let nickel = 0;
  let shockRadius = 0;
  let maxShockRadius = 0;
  let stalledAt = 0;
  let maxShockTime = 0;
  let revivalSince = 0;
  let reviving = false;
  let excisionStart = 0;
  let luminosity = 0;
  let pnsRadius = 0;
  let pnsMass = 0;
  let nuSphere = 0;
  let limitZone = 0;
  let limitCause = 'courant';

  const frames: Frame[] = [];
  const endTime = options.endTime ?? 1.0e5;
  const maxSteps = options.maxSteps ?? 1_200_000;

  function refresh(i: number): void {
    cold[i] = coldEnergy(rho[i], ye[i]);
    const thermal = Math.max(energy[i] - cold[i], 1e4);
    temp[i] = temperatureFrom(thermal, rho[i], ye[i], ionMass[i], temp[i]);
    const state = pressureAndSound(rho[i], temp[i], ye[i], ionMass[i]);
    pressure[i] = state.pressure;
    sound[i] = state.soundSpeed;
  }

  for (let i = 0; i < n; i += 1) {
    ionMass[i] = meanIonMass(comp, i * SPECIES_COUNT);
    refresh(i);
  }

  // Remember how much iron each zone started with, and where the iron core ends, so that
  // newly made iron-group can be told from the iron that was always there.
  const originalIron = new Float64Array(n);
  for (let i = 0; i < n; i += 1) originalIron[i] = comp[i * SPECIES_COUNT + SP_FE];
  let firstLightZone = 0;
  while (firstLightZone < n && originalIron[firstLightZone] > 0.5) firstLightZone += 1;

  // The entropy each shell began with, which the shock is later detected against.
  const initialEntropy = new Float64Array(n);
  for (let i = 0; i < n; i += 1) initialEntropy[i] = entropyOf(i);


  /** Entropy per baryon in units of Boltzmann's constant: the shock's clearest signature. */
  function entropyOf(i: number): number {
    const rad = (4 * A_RAD * temp[i] ** 3) / (3 * rho[i]);
    const ions =
      (K_B / (ionMass[i] * M_U)) *
      (1.5 * Math.log(Math.max(temp[i], 1)) - Math.log(Math.max(rho[i], 1e-30)) + 20);
    return ((rad + Math.max(ions, 0)) * M_U) / K_B;
  }

  function locatePns(): void {
    pnsRadius = r[inner];
    pnsMass = mass[inner];
    for (let i = inner; i < n; i += 1) {
      if (rho[i] >= PNS_DENSITY) {
        pnsRadius = r[i + 1];
        pnsMass = mass[i + 1];
      }
    }
    nuSphere = pnsRadius;
    let tau = 0;
    for (let i = n - 1; i >= inner; i -= 1) {
      tau += NU_OPACITY * rho[i] * (r[i + 1] - r[i]);
      if (tau >= 0.667) {
        nuSphere = r[i + 1];
        break;
      }
    }
  }

  // ---------------------------------------------------------------- one step

  function takeStep(): void {
    for (let i = inner; i < n; i += 1) {
      const dv = v[i + 1] - v[i];
      viscosity[i] =
        dv < 0 ? rho[i] * dv * dv * Q_QUADRATIC + Q_LINEAR * rho[i] * sound[i] * -dv : 0;
    }

    depth[n] = 0;
    for (let i = n - 1; i >= inner; i -= 1) {
      depth[i] = depth[i + 1] + NU_OPACITY * rho[i] * (r[i + 1] - r[i]);
    }

    locatePns();

    // --- what the proto-neutron star is radiating
    const sinceBounce = time - bounceTime;
    luminosity = 0;
    if (bounced) {
      // Two sources, dominant at different times. Straight after bounce the shock is still
      // swallowing infalling matter, and the gravitational energy that releases comes back
      // out as neutrinos. Later the proto-neutron star's own cooling takes over, radiating
      // the binding energy of a newly made neutron star over some ten seconds — which is
      // the duration of the burst measured from SN 1987A, and most of the reason anyone
      // believes this picture.
      const cooling = (PNS_BINDING / PNS_COOLING_TIME) * Math.exp(-sinceBounce / PNS_COOLING_TIME);
      let rate = 0;
      for (let i = inner; i < n; i += 1) {
        if (r[i + 1] > pnsRadius && r[i + 1] < pnsRadius * 5 && v[i + 1] < 0) {
          rate += (dm[i] * -v[i + 1]) / Math.max(r[i + 1] - pnsRadius, 1e5);
        }
      }
      const accretion =
        pnsRadius > 0 ? (0.2 * G * pnsMass * Math.min(rate, 30 * M_SUN)) / pnsRadius : 0;
      luminosity = cooling + accretion;

      // The neutronisation burst: when the shock crosses the neutrinosphere it lets go, in
      // a few milliseconds, of all the electron neutrinos that had been trapped behind it.
      if (sinceBounce < 0.03) {
        luminosity += 2.6e53 * Math.exp(-(((sinceBounce - 0.004) / 0.004) ** 2));
      }
    }

    // --- neutrino heating and cooling behind the shock
    //
    // This is what the whole explosion hangs on, and it is a close-run thing. Neutrinos
    // streaming out of the proto-neutron star are reabsorbed by free nucleons above it,
    // depositing energy; the same nucleons radiate energy away again by capturing electrons
    // and positrons. Cooling wins close in where it is hot, heating wins further out where
    // the flux is still strong but the gas is cooler. The surface where they balance is the
    // gain radius, and the shell between there and the shock — a hundred-odd kilometres
    // thick, holding perhaps a hundredth of a solar mass — has a few hundred milliseconds
    // to absorb enough of a flux it is very nearly transparent to. A percent or two gets
    // through. That is the entire margin by which massive stars explode.
    // The rate below is written for electron neutrinos absorbed on neutrons. Electron
    // antineutrinos absorbed on protons contribute just as much, and behind the shock,
    // where everything is dissociated, there are protons and neutrons in comparable
    // numbers. Of the six neutrino species the star radiates, then, two do the heating:
    // a third of the total luminosity, not a sixth.
    const lumFactor = luminosity / 3 / 1e52;
    for (let i = inner; i < n; i += 1) {
      heating[i] = 0;
      cooling[i] = 0;
      if (!bounced || luminosity <= 0) continue;
      if (r[i + 1] <= nuSphere || depth[i] > 12) continue;
      // Only free nucleons absorb: a bound nucleus offers a neutrino nothing to react with
      // at these energies. Behind the shock everything is dissociated, so this switches the
      // heating on exactly where the shock has already been.
      const free = comp[i * SPECIES_COUNT + SP_FREE];
      if (free < 0.05) continue;

      const r7 = r[i + 1] / 1e7;
      const gain =
        (1.544e20 * options.heatingFactor * lumFactor * NU_ENERGY2 * free * Math.exp(-depth[i])) /
        (r7 * r7);
      const tMev = (K_B * temp[i]) / MEV;
      heating[i] = gain;
      cooling[i] = 1.399e20 * Math.pow(tMev / 2, 6) * free;

      // Where the two would balance. Heating barely depends on temperature while cooling
      // goes as its sixth power, so there is exactly one temperature at which a parcel
      // here would sit still, and knowing it is what keeps the integration stable: a zone
      // is never allowed to step past its own equilibrium, however long the step.
      const eqMev = 2 * Math.pow(gain / (1.399e20 * free), 1 / 6);
      balance[i] = thermalEnergyOf((eqMev * MEV) / K_B, rho[i], ye[i], ionMass[i]);
    }

    // --- choose a timestep
    let limit = Infinity;
    limitZone = inner;
    limitCause = 'courant';
    for (let i = inner; i < n; i += 1) {
      if (rho[i] < 1e-12) continue;
      const width = r[i + 1] - r[i];
      const signal = sound[i] + Math.abs(v[i + 1] - v[i]) + 1e3;
      const courant = width / signal;
      if (courant < limit) {
        limit = courant;
        limitZone = i;
        limitCause = 'courant';
      }
      const squeeze = Math.abs(v[i + 1] - v[i]) / Math.max(width, 1e2);
      if (squeeze > 0 && 0.06 / squeeze < limit) {
        limit = 0.06 / squeeze;
        limitZone = i;
        limitCause = 'squeeze';
      }
      // The net neutrino rate, measured against whichever is larger: what the zone has now
      // or what it is heading towards. Measuring against its current energy alone would be
      // a trap — a zone that has just been cooled almost to nothing would demand a
      // vanishing timestep to be warmed back up by a perfectly ordinary heating rate.
      const net = heating[i] - cooling[i];
      if (net !== 0) {
        const scale = Math.max(energy[i] - cold[i], balance[i], 1e12);
        const cap = (0.5 * scale) / Math.abs(net);
        if (cap < limit) {
          limit = cap;
          limitZone = i;
          limitCause = 'neutrino';
        }
      }
    }
    dt = Math.max(Math.min(limit * CFL, dt * 1.12), 1e-9);

    // --- accelerate the interfaces
    //
    // The inner face never moves. Before the neutron star exists that face is the centre of
    // the star, which cannot go anywhere by symmetry; afterwards it is the excision
    // boundary inside the neutron star, which is held fixed and lets the settled matter
    // below act purely as a point mass and a floor.
    v[inner] = 0;
    for (let i = inner + 1; i <= n; i += 1) {
      const pIn = pressure[i - 1] + viscosity[i - 1];
      const pOut = i < n ? pressure[i] + viscosity[i] : 0;
      const dmFace = i === n ? dm[n - 1] / 2 : (dm[i] + dm[i - 1]) / 2;
      const area = 4 * Math.PI * r[i] * r[i];
      const gravity = (-G * mass[i]) / Math.max(r[i] * r[i], 1e8);
      v[i] += (gravity + (area * (pIn - pOut)) / dmFace) * dt;
      // A Newtonian solver will happily let the inner core exceed the speed of light at
      // bounce. It may not.
      const cap = 0.5 * C_LIGHT;
      if (v[i] > cap) v[i] = cap;
      else if (v[i] < -cap) v[i] = -cap;
    }

    // --- move them, without letting shells pass through one another
    for (let i = inner + 1; i <= n; i += 1) {
      r[i] += v[i] * dt;
      const floor = r[i - 1] * 1.000001 + 1e2;
      if (r[i] < floor) {
        r[i] = floor;
        if (v[i] < 0) v[i] = 0;
      }
    }

    // --- compression work, with a predictor and a corrector
    for (let i = inner; i < n; i += 1) {
      const volumeOld = 1 / rho[i];
      const shell = (4 / 3) * Math.PI * (r[i + 1] ** 3 - r[i] ** 3);
      rho[i] = dm[i] / Math.max(shell, 1e-30);
      const dV = 1 / rho[i] - volumeOld;
      const q = viscosity[i];

      // Predict with the old pressure, then correct with the mean of old and predicted.
      // The correction earns its keep at the bounce, where pressure changes by a large
      // factor inside a single step.
      const predicted = energy[i] - (pressure[i] + q) * dV;
      const coldNew = coldEnergy(rho[i], ye[i]);
      const tGuess = temperatureFrom(Math.max(predicted - coldNew, 1e4), rho[i], ye[i], ionMass[i], temp[i]);
      const pGuess = coldPressure(rho[i], ye[i]) + thermalPressure(tGuess, rho[i], ye[i], ionMass[i]);
      energy[i] -= (0.5 * (pressure[i] + pGuess) + q) * dV;
      cold[i] = coldNew;
    }

    // --- nuclear and neutrino source terms
    let dBurn = 0;
    let dLost = 0;

    for (let i = inner; i < n; i += 1) {
      const offset = i * SPECIES_COUNT;

      // Electron capture. Electrons are only ever captured, never released, so the fraction
      // can only fall; and it only happens where the fit it comes from applies.
      if (rho[i] > CAPTURE_FLOOR) {
        const wanted = targetYe(rho[i]);
        if (wanted < ye[i] - 1e-7) {
          const change = (ye[i] - wanted) * (1 - Math.exp(-dt / CAPTURE_TIME));
          const after = ye[i] - change;
          // Removing an electron removes its share of the degeneracy energy — but that
          // energy left with the electron, so it comes off the books rather than becoming
          // heat. Subtracting the change in cold energy keeps the thermal part untouched.
          energy[i] += coldEnergy(rho[i], after) - cold[i];
          ye[i] = after;
          if (neutrinosEscape(rho[i])) {
            // The escaping neutrino carries off real energy, but only energy the zone
            // actually has. Each capture takes something like fifteen MeV with it, which
            // over a step that deleptonises a tenth of an electron per nucleon comes to
            // more heat than a zone may own — and a zone billed past zero lands on the
            // temperature floor and stays there, a shell of proto-neutron star at a
            // thousand kelvin. What the zone cannot pay this step it pays the next.
            const asked = (change * captureNeutrinoEnergy(rho[i])) / M_U;
            const lost = Math.min(asked, MAX_CAPTURE_SPEND * Math.max(energy[i] - cold[i], 0));
            energy[i] -= lost;
            dLost += lost * dm[i];
          }
          cold[i] = coldEnergy(rho[i], ye[i]);
          temp[i] = temperatureFrom(Math.max(energy[i] - cold[i], 1e4), rho[i], ye[i], ionMass[i], temp[i]);
        }
      }

      // Nuclear reactions, in one regime or the other but never both.
      //
      // Keeping these mutually exclusive matters more than it might appear. Equilibrium and
      // the burning chain describe the same physics at different temperatures, and letting
      // them run together creates a closed loop that manufactures energy from nothing:
      // equilibrium breaks iron down into alpha particles, the chain happily burns those
      // alphas back up to iron, and round it goes, releasing binding energy on every
      // circuit. The dividing line is where equilibrium genuinely takes over, at about five
      // billion kelvin.
      burnRate[i] = 0;
      const dissociated = comp[offset + SP_FREE] + comp[offset + SP_HE];
      if (temp[i] > NSE_TEMP || (dissociated > 0.02 && temp[i] > FREEZE_TEMP)) {
        // Anything lighter than iron that finds itself this hot is in equilibrium too, so
        // it joins the pool — which is a real energy release, and the main way the shock
        // makes iron-group material out of the silicon it runs through.
        let released = poolLightNuclei(comp, offset);
        released += relaxToNse(comp, offset, temp[i], rho[i], 0.35, energy[i] - cold[i] + released);
        if (released !== 0) {
          energy[i] += released;
          ionMass[i] = meanIonMass(comp, offset);
          if (released > 0) {
            burnRate[i] = released / dt;
            dBurn += released * dm[i];
          }
        }
      } else if (temp[i] > 1.4e9 && dissociated <= 0.02) {
        // Below equilibrium, the burning chain runs one way only: up.
        const { released } = burnZone(comp, offset, temp[i], dt);
        if (released > 0) {
          energy[i] += released;
          ionMass[i] = meanIonMass(comp, offset);
          burnRate[i] = released / dt;
          dBurn += released * dm[i];
        }
      }

      // Net neutrino heating, clamped so that a zone can approach the temperature at which
      // gain and loss balance but never overshoot it. That clamp is doing real work: the
      // loss term's sixth power of temperature is stiff enough that an explicit step would
      // otherwise sail straight through equilibrium and out the other side, and the gain
      // radius — the surface where the balance flips, and the inner edge of the region
      // that drives the explosion — would dissolve into numerical noise.
      const net = heating[i] - cooling[i];
      if (net !== 0) {
        const thermal = Math.max(energy[i] - cold[i], 0);
        const gap = thermal - balance[i];
        let delta = net * dt;
        if (gap > 0 && delta < -gap) delta = -gap;
        else if (gap < 0 && delta > -gap) delta = -gap;
        energy[i] += delta;
        if (delta < 0) dLost += -delta * dm[i];
      }

      refresh(i);
    }

    burnEnergy += dBurn;
    neutrinoEnergy += dLost + (bounced ? luminosity * dt : 0);

    time += dt;
    step += 1;

    // --- bounce: the central density peaks and starts to fall
    if (!bounced) {
      if (rho[inner] > peakDensity) peakDensity = rho[inner];
      if (rho[inner] > RHO_NUC && rho[inner] < peakDensity * 0.997) {
        bounced = true;
        bounceTime = time;
        phase = 'bounce';
      } else if (rho[inner] > 1e11) {
        phase = 'collapse';
      }
    }

    // --- track the shock
    //
    // Entropy is the giveaway. Compression on its own is ambiguous, since most of the star
    // is being compressed without a shock anywhere near it, but a shock is irreversible —
    // it is the one thing that leaves entropy permanently higher behind it than in front.
    // Each shell is compared against the entropy it started with rather than against a
    // fixed number, because a gram of hydrogen envelope and a gram of iron core begin
    // thousands of kelvin and fourteen orders of magnitude in density apart. Measured that
    // way the same test finds the front through every layer it crosses.
    if (bounced) {
      // Two neighbours have to agree. A single zone can be lifted over the threshold by
      // nothing more than the artificial viscosity smearing a steep compression, and one
      // stray zone far out in the envelope would otherwise report the shock as having
      // jumped thousands of kilometres for a step or two.
      const shocked = (i: number): boolean =>
        entropyOf(i) > 2.2 * initialEntropy[i] + 0.5 && rho[i] > 1e-11;
      for (let i = n - 1; i > inner; i -= 1) {
        if (shocked(i) && shocked(i - 1)) {
          shockRadius = r[i + 1];
          break;
        }
      }
      if (shockRadius > maxShockRadius) {
        maxShockRadius = shockRadius;
        maxShockTime = time;
      }

      // A stalled shock is not a motionless one. The front found by the entropy test
      // wanders a few per cent from step to step as the zone holding the jump changes, and
      // while the prompt shock is still climbing it spends much of its time slightly below
      // the best radius it has reached. Calling that a stall — which an earlier version of
      // this test did — froze the stall radius at fifty-odd kilometres during the climb,
      // and every later reading looked like a revival by comparison.
      //
      // What actually distinguishes a stall is that the shock stops setting records. A
      // climbing shock beats its own best every few milliseconds; one that has run out of
      // push goes quiet. Thirty milliseconds of silence is far longer than the jitter and
      // far shorter than the revival window.
      const sb = time - bounceTime;
      if (sb > 0.02 && !reviving) {
        if (stalledAt === 0 && maxShockRadius > 5e6 && time - maxShockTime > 0.03) {
          phase = 'stalled';
          stalledAt = maxShockRadius;
        }
        // Revival has to be held, not just touched. A stalled shock breathes, and a single
        // reading thirty per cent out is a breath; a reviving one never comes back down.
        if (stalledAt > 0 && shockRadius > stalledAt * 1.3) {
          if (revivalSince === 0) revivalSince = time;
          if (time - revivalSince > 0.02) {
            reviving = true;
            phase = 'reviving';
          }
        } else {
          revivalSince = 0;
        }
      }
      if (reviving && shockRadius > 3e8) phase = 'exploding';
      if (reviving && shockRadius > 2e10) phase = 'coasting';
      if (shockRadius > 0.85 * r[n]) phase = 'breakout';
      if (pnsMass > MAX_NS_MASS) {
        failed = true;
        phase = 'failed';
      }
    }

    // --- retire zones that have settled deep inside the neutron star
    //
    // Once the proto-neutron star exists, the zones inside it are dense, thin and going
    // nowhere, and they would pin the timestep at a microsecond for the rest of the run
    // while contributing nothing but their gravity. So they are retired: their mass stays
    // in the enclosed-mass sum and their upper face becomes the inner boundary, but the
    // solver stops integrating them. This is what makes it possible to follow one
    // calculation from a bounce lasting a millisecond to a shock breakout a day later.
    //
    // The boundary is not held still, though, and that matters. A new neutron star is born
    // puffy and hot at fifty-odd kilometres and shrinks to about fifteen over the next
    // second as neutrinos carry off its heat. Pinning the boundary would prop the star open
    // and keep the gravitational well too shallow, which would in turn park the stalled
    // shock further out than it belongs. So the boundary is walked inwards on the
    // contraction law that detailed cooling calculations produce, and the settling that
    // drives is a real part of what powers the explosion.
    // Later still, the same argument applies again but for a different reason, and this
    // one decides whether the run can reach the surface at all. Once the shock is away,
    // the neutron star is a finished object twenty kilometres across sitting at the
    // bottom of a star that now extends for tens of thousands, and the timestep — a zone
    // width over a sound speed — is set entirely by it. Measured directly: two seconds
    // after bounce, with the shock at fifteen thousand kilometres, every step in the
    // calculation was being sized by a zone at twenty-six. Left that way the run costs a
    // fixed number of microseconds per second of star, and shock breakout, which happens
    // a day later, would take billions of steps.
    //
    // So the boundary is also kept at a small fraction of the shock radius, which lets it
    // walk outwards as the explosion grows and keeps the timestep scaled to the thing
    // being watched rather than to the thing that has stopped changing. The guard is on
    // velocity: matter on its way out is ejecta and is never retired, however deep it is.
    // What gets swallowed this way is matter that failed to escape and is falling back,
    // which in the real star lands on the neutron star too.
    if (bounced && time - bounceTime > 0.003) {
      if (excisionStart === 0) excisionStart = Math.min(pnsRadius * 0.6, 6.0e6);
      const sb = time - bounceTime;
      const contracting =
        PNS_FINAL_RADIUS + (excisionStart - PNS_FINAL_RADIUS) * Math.exp(-sb / PNS_CONTRACTION_TIME);
      // And the boundary also tracks the proto-neutron star itself, which is the case the
      // contraction law alone gets wrong. When the shock fails to revive, matter keeps
      // raining onto the star and the zones pile up against its surface, squeezed thinner
      // and thinner: a run that stalled had its timestep set by a zone forty metres thick
      // sitting at thirty-two kilometres, well inside a neutron star fifty-two kilometres
      // across, and took a quarter of an hour to cover its first second. Matter that deep
      // is part of the star and its only remaining job is to be heavy, which it goes on
      // doing from the enclosed-mass sum after it is retired.
      const wanted = Math.max(
        contracting,
        EXCISE_FRACTION * shockRadius,
        !reviving && sb > PNS_EXCISE_AFTER ? PNS_EXCISE_FRACTION * pnsRadius : 0,
      );

      const leaving = (i: number): boolean =>
        v[i] > ESCAPE_MARGIN * Math.sqrt((2 * G * mass[i]) / Math.max(r[i], 1e5));

      // Everything whose outer face has ended up inside the boundary is retired, and the
      // boundary itself becomes the inner face of whatever is left.
      while (inner < n - 70 && r[inner + 1] <= wanted && !leaving(inner + 1)) inner += 1;
      // Then retire by thickness as well. What actually costs time is a thin zone, since
      // the timestep is a zone width divided by a sound speed, and zones piling up against
      // a contracting boundary get very thin indeed. Requiring the innermost live zone to
      // span a few per cent of its own radius puts a floor under the timestep directly
      // rather than hoping one falls out.
      while (
        inner < n - 70 &&
        r[inner + 1] - r[inner] < 0.05 * r[inner + 1] &&
        !leaving(inner + 1)
      ) {
        inner += 1;
      }
      // The boundary may be pulled inwards, because that is the neutron star contracting
      // and is real, but it is never pushed outwards. Dragging a rigid wall out through
      // the gas would do work on it, and the run that first tried it inflated the
      // explosion energy by forty percent. Retiring a zone simply leaves the boundary at
      // the face that zone used to have.
      if (contracting < r[inner]) r[inner] = contracting;
      v[inner] = 0;
    }
  }

  // ---------------------------------------------------------------- recording

  function capture(): void {
    const fr = new Float32Array(n + 1);
    const fv = new Float32Array(n + 1);
    const frho = new Float32Array(n);
    const ftemp = new Float32Array(n);
    const fent = new Float32Array(n);
    const fcomp = new Uint8Array(n * SPECIES_COUNT);
    const fburn = new Uint8Array(n);

    for (let i = 0; i <= n; i += 1) {
      fr[i] = r[i];
      fv[i] = v[i];
    }
    for (let i = 0; i < n; i += 1) {
      frho[i] = rho[i];
      ftemp[i] = temp[i];
      fent[i] = entropyOf(i);
      for (let s = 0; s < SPECIES_COUNT; s += 1) {
        const x = comp[i * SPECIES_COUNT + s];
        fcomp[i * SPECIES_COUNT + s] = x <= 0 ? 0 : x >= 1 ? 255 : Math.round(x * 255);
      }
      const b = burnRate[i];
      fburn[i] = b <= 0 ? 0 : Math.max(0, Math.min(255, Math.round((Math.log10(b) - 12) * 24)));
    }

    // Diagnostic explosion energy: add up, over every shell that is moving outwards and
    // has more energy than it needs to escape, the amount by which it exceeds escape. This
    // is the number quoted as "one foe" for a typical supernova, and watching it climb is
    // how you tell whether the shock has really been revived or is only wobbling.
    //
    // Only thermal energy counts, not the total. The degeneracy energy of the electrons is
    // enormous — it exceeds the gravitational binding of the core several times over — but
    // it is not available to throw anything anywhere, and including it would declare the
    // star unbound before it had even begun to collapse.
    let explosion = 0;
    let ejecta = 0;
    let peak = 0;
    for (let i = inner; i < n; i += 1) {
      if (v[i + 1] > peak) peak = v[i + 1];
      const speed = (v[i] + v[i + 1]) / 2;
      if (speed <= 0) continue;
      const mid = (r[i] + r[i + 1]) / 2;
      if (mid <= pnsRadius) continue;
      const thermal = Math.max(energy[i] - cold[i], 0);
      const specific = 0.5 * speed * speed + thermal - (G * mass[i + 1]) / Math.max(mid, 1e3);
      if (specific > 0) {
        explosion += specific * dm[i];
        ejecta += dm[i];
      }
    }

    // Iron-group material sitting where there was none before: the nickel-56 whose decay
    // will light the supernova for the next several months. Measured rather than
    // accumulated, so that material dissociating and recombining cannot be counted twice.
    let made = 0;
    for (let i = firstLightZone; i < n; i += 1) {
      made += dm[i] * (comp[i * SPECIES_COUNT + SP_FE] - originalIron[i]);
    }
    nickel = Math.max(made, 0);

    frames.push({
      time,
      sinceBounce: 0, // filled in once the bounce time is known
      phase,
      inner,
      r: fr,
      v: fv,
      rho: frho,
      temp: ftemp,
      entropy: fent,
      comp: fcomp,
      burning: fburn,
      shockRadius,
      coreRadius: pnsRadius,
      coreMass: pnsMass,
      centralDensity: rho[0],
      neutrinoLuminosity: luminosity,
      neutrinoSphere: nuSphere,
      neutrinoEnergy,
      nickel,
      explosionEnergy: explosion,
      burnEnergy,
      ejectaMass: ejecta,
      peakVelocity: peak,
      limitZone,
      limitCause,
      dt,
    });
  }

  // ---------------------------------------------------------------- main loop
  //
  // Snapshots follow the physics rather than the clock. Before bounce one is taken every
  // time the central density climbs by a fixed factor, which automatically crowds frames
  // into the final milliseconds when the collapse is running away. After bounce they fall
  // on a logarithmic grid in time since bounce, because the interesting events are spread
  // over nine orders of magnitude and a grid in seconds would spend one frame on the bounce
  // and ten thousand on the following day.
  const PRE_DENSITY_STEP = 0.028; // decades of central density
  const POST_PER_DECADE = 62;
  let nextDensityMark = Math.log10(rho[0]) + PRE_DENSITY_STEP;
  let nextPostLog = -4.2;
  let lastReport = 0;

  locatePns();
  capture();

  while (step < maxSteps) {
    takeStep();

    if (!bounced) {
      const mark = Math.log10(Math.max(rho[inner], 1));
      if (mark >= nextDensityMark) {
        nextDensityMark = mark + PRE_DENSITY_STEP;
        capture();
      }
    } else {
      const sb = time - bounceTime;
      if (sb >= Math.pow(10, nextPostLog)) {
        while (Math.pow(10, nextPostLog) <= sb) nextPostLog += 1 / POST_PER_DECADE;
        capture();
      }
    }

    if (options.onProgress && step - lastReport > 500) {
      lastReport = step;
      const done = bounced
        ? 0.4 +
          0.6 *
            Math.min(
              1,
              (Math.log10(Math.max(time - bounceTime, 1e-5)) + 5) / (Math.log10(endTime) + 5),
            )
        : 0.4 * Math.min(1, (Math.log10(Math.max(rho[inner], 1e9)) - 9.9) / 4.6);
      const note = options.diagnose
        ? `${describe(phase, time, bounceTime, bounced)} | dt=${dt.toExponential(1)} ${limitCause}@${limitZone}` +
          ` r=${(r[limitZone + 1] / 1e5).toExponential(1)}km rho=${rho[limitZone].toExponential(1)} inner=${inner} step=${step}`
        : describe(phase, time, bounceTime, bounced);
      options.onProgress(Math.max(0, Math.min(0.99, done)), note);
    }

    if (bounced && time - bounceTime > endTime) break;
    if (failed && time - bounceTime > 1.5) break;
  }

  capture();
  for (const frame of frames) frame.sinceBounce = frame.time - bounceTime;

  return {
    frames,
    dm,
    mass,
    count: n,
    totalMass: star.totalMass,
    bounceTime,
    initialEntropy,
    layers: star.layers.map((l) => ({ name: l.name, outer: l.outer, outerMass: l.outerMass })),
    failed,
    settings: { heatingFactor: options.heatingFactor, resolution: options.resolution },
    elapsed: Date.now() - started,
    steps: step,
  };
}
