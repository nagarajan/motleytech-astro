/**
 * A hand-wound watch movement, simulated rather than animated.
 *
 * Nothing here is keyed to a clock. There is a mainspring holding a torque, a train of
 * wheels that is rigid gearing and nothing more, and a balance wheel obeying
 *
 *     I·θ̈ = −k·θ − (losses) + (whatever the escapement hands it)
 *
 * The seconds hand moves because the balance is vibrating, and for no other reason. Take
 * the torque away and the amplitude decays and the watch stops; wind it and the amplitude
 * climbs back. The rate, the amplitude, the power reserve and the forty-hour run are
 * consequences of the numbers below rather than values typed in anywhere.
 *
 * Units are SI throughout: newton-metres, kilogram metres squared, radians, seconds.
 */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- the gear train

/**
 * A classic 18,000 A/h train. Every one of these tooth counts is doing a job, and the
 * whole point of the set is that the numbers multiply out to something exact.
 */
export const TRAIN = {
  barrel: 80,
  centrePinion: 10,
  centre: 64,
  thirdPinion: 8,
  third: 60,
  fourthPinion: 8,
  fourth: 70,
  escapePinion: 7,
  escape: 15,
} as const;

/** Motion work: the little gearing under the dial that makes the hour hand from the minute hand. */
export const MOTION_WORK = {
  cannon: 12,
  minute: 36,
  minutePinion: 10,
  hour: 40,
} as const;

/** How far each wheel turns for one turn of the one before it. */
export const STEP_UP = {
  centre: TRAIN.barrel / TRAIN.centrePinion, // 8
  third: TRAIN.centre / TRAIN.thirdPinion, // 8
  fourth: TRAIN.third / TRAIN.fourthPinion, // 7.5
  escape: TRAIN.fourth / TRAIN.escapePinion, // 10
} as const;

/** Escape wheel turns per barrel turn: 8 × 8 × 7.5 × 10. */
export const TRAIN_RATIO = STEP_UP.centre * STEP_UP.third * STEP_UP.fourth * STEP_UP.escape;

/** Two beats per tooth — one as the tooth locks on each pallet. */
export const BEATS_PER_ESCAPE_TURN = TRAIN.escape * 2;

/** The angle the escape wheel advances between one beat and the next: half a tooth. */
export const BEAT_STEP = TAU / BEATS_PER_ESCAPE_TURN;

/**
 * And here is the number the tooth counts were chosen to produce. The centre wheel turns
 * once an hour by construction, so the escape wheel turns 600 times an hour, and at two
 * beats a tooth that is 18,000 beats an hour — five a second, a balance at 2.5 Hz.
 */
export const BEATS_PER_HOUR = 600 * BEATS_PER_ESCAPE_TURN;
export const BALANCE_HZ = BEATS_PER_HOUR / 7200;

// ---------------------------------------------------------------- the mainspring

/** Turns of tension the barrel holds when it is wound right up. */
export const FULL_WIND = 5.5;

/** Barrel torque at full wind. */
const BARREL_TORQUE_MAX = 2.3e-3;

/**
 * How barrel torque falls as the spring unwinds.
 *
 * A real mainspring is not a linear spring: it is a long strip coiled against the inside
 * of a barrel, and as it relaxes the working coils lengthen and the torque sags along a
 * curve that is flattish in the middle and drops away sharply at the end. The exponent
 * below is a fit to that shape rather than anything derived, and it is the reason the last
 * half-turn of a watch is worthless: torque is already down to a sixth of full there, and
 * the amplitude has collapsed long before the spring is actually slack.
 */
export function barrelTorque(wind: number, strength = 1): number {
  if (wind <= 0) return 0;
  return strength * BARREL_TORQUE_MAX * Math.pow(Math.min(wind, FULL_WIND) / FULL_WIND, 0.55);
}

/** Losses through four meshes of roughly 93% each. */
const TRAIN_EFFICIENCY = 0.75;

/** Torque at the escape wheel, which is the only place the train's torque is ever used. */
export function escapeTorque(wind: number, strength = 1): number {
  return (barrelTorque(wind, strength) * TRAIN_EFFICIENCY) / TRAIN_RATIO;
}

// ---------------------------------------------------------------- the balance

/** Glucydur balance, 9.5 mm across, a shade under a tenth of a gram. */
const BALANCE_INERTIA = 1.0e-9;

const BALANCE_OMEGA = TAU * BALANCE_HZ;

/** Hairspring stiffness, fixed by the inertia and the frequency we want: k = I·ω². */
export const HAIRSPRING_K = BALANCE_INERTIA * BALANCE_OMEGA * BALANCE_OMEGA;

/** How far the regulator can shift the stiffness either way: worth about ±90 s a day. */
const INDEX_RANGE = 0.004;

/**
 * Two kinds of loss, because a watch has two kinds of loss and they answer differently.
 *
 * Pivot friction is roughly proportional to speed and costs energy in proportion to the
 * square of the amplitude. Air drag on the rim goes as the square of the speed and costs
 * in proportion to the cube. So amplitude climbs as somewhere between the square root and
 * the cube root of the torque driving it, which is why doubling the mainspring's torque
 * emphatically does not double the amplitude.
 */
const DRAG_LINEAR = 1.7e-11;
const DRAG_SQUARE = 2.9e-13;

// ---------------------------------------------------------------- the escapement

/**
 * The Swiss lever escapement, in the only five numbers that matter.
 *
 * The balance is *detached*: for all but 52° out of a swing of five hundred and something,
 * it is connected to nothing at all and is simply a pendulum running down. The escapement
 * gets one brief appointment per beat, in the middle of the swing, where it takes a little
 * energy off the balance to unlock itself and then hands back rather more.
 */
export const LIFT_ANGLE = 52 * DEG;

/**
 * How the lift angle is split, and this split is the whole of the escapement's timekeeping.
 *
 * The balance arrives, spends the first 5° pushing the lever through the lock, and then
 * receives its impulse over the remaining 47° — which are arranged *symmetrically about
 * zero*, the balance's own rest position. That symmetry is not decoration. A push delivered
 * late, after the balance has passed centre, retards it; a push delivered early advances
 * it; a push spread evenly either side cancels to first order and leaves the rate alone.
 * Getting this wrong by a few degrees is worth a minute a day, which I know because the
 * first version of this file had the impulse centred 5° late and ran 85 seconds a day slow.
 */
const UNLOCK_SPAN = 5 * DEG;
const IMPULSE_HALF = (LIFT_ANGLE - UNLOCK_SPAN) / 2;
/** How far out the impulse jewel has to be before the escapement will accept it again. */
const ENGAGE_ANGLE = IMPULSE_HALF + UNLOCK_SPAN;

/** The fork's whole travel, banking pin to banking pin. */
export const FORK_SWING = 20 * DEG;
const HALF_FORK = FORK_SWING / 2;
/** The share of that travel used up getting the tooth off the locking face. */
const LOCK_SHARE = 0.15;

/** The fork turns the other way from the balance, as any pair of meshing things does. */
const FORK_SENSE = -1;

/**
 * Of the escape wheel's 12° per beat: a little backwards to unlock, then the impulse, then
 * a free drop onto the next pallet.
 *
 * The recoil is the interesting one. The locking faces of the pallets are cut at an angle
 * — "draw" — so the escape wheel's own torque pulls the lever *harder* against its banking
 * pin the deeper it is locked. That is what stops a jolt to the case from throwing the
 * lever across and letting the train run. It is also not free: the balance has to shove the
 * whole train backwards by this much before anything unlocks, and pays for it.
 */
const RECOIL = 0.3 * DEG;
const IMPULSE_ADVANCE = 10.2 * DEG;
const DROP = BEAT_STEP + RECOIL - IMPULSE_ADVANCE;

/** How much of the escape wheel's work reaches the balance. Lever escapements are poor. */
const IMPULSE_EFFICIENCY = 0.4;

/** And unlocking costs more than the recoil alone, because the locking face is sticky. */
const UNLOCK_FRICTION = 1.6;

/** Reflected inertia of the train at the escape wheel, which only matters during the drop. */
const TRAIN_INERTIA = 1.2e-11;

/**
 * Below this the escapement can no longer be worked: the balance either cannot reach the
 * fork or cannot push it through the lock, and the watch stops with the train held.
 */
const STALL_AMPLITUDE = ENGAGE_ANGLE * 1.25;

/**
 * Above this the impulse jewel comes all the way round and strikes the *outside* of the
 * fork horn. Watchmakers call it knocking or rebanking; it is what a watch does when a
 * mainspring is too strong for its balance, and it is self-limiting in the ugliest way,
 * by smashing energy out of the balance once a beat.
 */
const KNOCK_ANGLE = TAU - ENGAGE_ANGLE;

// ---------------------------------------------------------------- the keyless works

/**
 * Winding: crown → winding pinion (14) → crown wheel → ratchet wheel (36). The crown wheel
 * is an idler, so its own tooth count cancels and only reverses the direction; it is there
 * to put the ratchet wheel's rotation the right way round for the click to hold it.
 */
export const KEYLESS = { windingPinion: 14, crownWheel: 24, ratchet: 36, setting: 0.2 } as const;

const WIND_RATIO = KEYLESS.windingPinion / KEYLESS.ratchet;

// ---------------------------------------------------------------- state

export type Phase = 'locked' | 'unlocking' | 'impulse' | 'drop' | 'stopped';

export interface Pose {
  /** Absolute escape wheel angle. Every wheel in the going train follows from this one. */
  escape: number;
  balance: number;
  fork: number;
  /** Barrel arbor angle, which moves only when the crown does. */
  arbor: number;
  crown: number;
}

export interface Reading {
  phase: Phase;
  running: boolean;
  /** Peak swing of the balance to one side, in degrees. 270 or so is healthy. */
  amplitude: number;
  /** Turns of tension left in the mainspring. */
  wind: number;
  barrelTorque: number;
  escapeTorque: number;
  /** Beats per hour as actually measured, against 18,000 nominal. */
  beatRate: number;
  /** Seconds a day fast (+) or slow (−), from the measured beat rate. */
  rate: number;
  /** Hours of running left, at the present rate of unwinding. */
  reserve: number;
  knocking: boolean;
  /** Regulator index, −1 slow to +1 fast. */
  regulator: number;
  /** Simulated seconds since the movement was reset. */
  elapsed: number;
  /** What the hands say, in seconds since midnight. */
  shown: number;
  beats: number;
}

export interface Hands {
  hour: number;
  minute: number;
  second: number;
}

const START_TIME = 10 * 3600 + 9 * 60 + 36;

export class Movement {
  // The going train, held in one number: the escape wheel's absolute angle.
  private escape = 0;
  private lock = 0;
  private dropLeft = 0;
  private dropRate = 0;

  private theta = 0;
  private omega = 0;

  /** Which way the balance must be travelling for the waiting tooth to be unlocked. */
  private unlockDir: 1 | -1 = 1;
  private armed = true;
  private fork = FORK_SENSE * -HALF_FORK;
  private phase: Phase = 'locked';

  /** The regulator index, −1 slow to +1 fast, scaling the hairspring's working length. */
  private index = 0;

  /**
   * A mainspring of the wrong strength, for anyone who wants to see what that does. It is
   * not a knob a watch has: it is a barrel you fit once and live with, and fitting the
   * wrong one is a real and common repair fault.
   */
  private strength = 1;

  /** Turns wound into the barrel arbor, and turns the barrel has since run off. */
  private arborTurns = FULL_WIND;
  private crownTurns = 0;
  private crownOut = false;

  /** The cannon pinion's slip against the centre arbor, in seconds of shown time. */
  private handShift = START_TIME;

  private elapsed = 0;
  private beats = 0;
  private knockedAt = -1;
  private knocking = false;

  // Amplitude is measured, not stored: remember the peak since the last zero crossing.
  private peak = 0;
  private lastPeak = 0;
  private lastBeatAt = 0;
  private beatPeriod = 1 / (2 * BALANCE_HZ);

  constructor() {
    this.kick();
  }

  // ---------------------------------------------------------------- power

  /** Turns of tension in the mainspring: what has been wound in, less what has run off. */
  get wind(): number {
    return Math.max(0, this.arborTurns - this.escape / TAU / TRAIN_RATIO);
  }

  get torque(): number {
    return escapeTorque(this.wind, this.strength);
  }

  setMainspring(strength: number): void {
    this.strength = Math.max(0.2, Math.min(3, strength));
  }

  get mainspring(): number {
    return this.strength;
  }

  /**
   * Turn the crown. Returns how much of the turn the crown would actually accept, which is
   * what makes a fully wound watch feel like it has hit a wall and an unwinding turn feel
   * like it is slipping over teeth: both are the crown refusing to move the mechanism.
   */
  turnCrown(turns: number): number {
    if (this.crownOut) {
      // Setting. The cannon pinion is a friction fit on the centre arbor, so the hands move
      // and the train does not even notice. This is also why you can set a watch without
      // stopping it, and why the seconds hand carries on regardless: it is on the fourth
      // wheel, upstream of the slip.
      this.crownTurns += turns;
      this.handShift += turns * KEYLESS.setting * 3600;
      return turns;
    }

    if (turns <= 0) {
      // Backwards. The winding pinion and the sliding pinion meet on ratchet teeth cut at
      // an angle, so they simply skate over one another and nothing downstream moves.
      this.crownTurns += turns;
      return turns;
    }

    const room = FULL_WIND - this.wind;
    const taken = Math.min(turns, room / WIND_RATIO);
    this.arborTurns += taken * WIND_RATIO;
    this.crownTurns += taken;
    // Winding a stopped watch usually starts it, which is not a nicety of the simulation:
    // the jolt of the click dropping into the next tooth is what sets the balance going.
    if (this.phase === 'stopped' && taken > 0) this.kick();
    return taken;
  }

  pullCrown(out: boolean): void {
    this.crownOut = out;
  }

  get crownPulled(): boolean {
    return this.crownOut;
  }

  /** Shake the watch. A wound balance that has stopped needs a push to get going again. */
  kick(): void {
    if (this.wind <= 0) return;
    if (this.phase === 'stopped') this.phase = 'locked';
    const swing = Math.max(Math.abs(this.omega), BALANCE_OMEGA * ENGAGE_ANGLE * 2.2);
    this.omega = this.omega >= 0 ? swing : -swing;
  }

  /**
   * Move the regulator. This is the only adjustment a watch has: a pair of pins on a
   * moveable arm that grip the hairspring near its outer end, so sliding them changes how
   * much of the spring is free to breathe. Shorter spring, stiffer spring, faster watch.
   */
  setIndex(index: number): void {
    this.index = Math.max(-1, Math.min(1, index));
  }

  get regulator(): number {
    return this.index;
  }

  private get stiffness(): number {
    return HAIRSPRING_K * (1 + INDEX_RANGE * this.index);
  }

  letDown(): void {
    this.arborTurns = this.escape / TAU / TRAIN_RATIO;
  }

  fullWind(): void {
    this.arborTurns = this.escape / TAU / TRAIN_RATIO + FULL_WIND;
    this.kick();
  }

  // ---------------------------------------------------------------- the integrator

  /**
   * Advance by `seconds` of simulated time, in steps small enough to resolve the
   * escapement. Everything interesting happens inside a 52° window that the balance
   * crosses in about a fiftieth of a second, so the step has to be a good deal shorter
   * than that.
   */
  advance(seconds: number, step = 2e-4): void {
    let left = seconds;
    while (left > 1e-9) {
      const dt = Math.min(step, left);
      this.tick(dt);
      left -= dt;
    }
  }

  private tick(dt: number): void {
    this.elapsed += dt;
    const torque = this.torque;

    if (this.phase === 'stopped') {
      // Still a pendulum, just an undriven one, so it visibly rings down rather than
      // stopping dead. If it was only the torque that failed, it will restart on its own
      // the moment the crown is turned.
      this.free(dt, 0);
      if (torque > 0 && this.peakSwing() > STALL_AMPLITUDE) this.phase = 'locked';
      return;
    }

    if (torque <= 0) {
      this.phase = 'stopped';
      this.free(dt, 0);
      return;
    }

    switch (this.phase) {
      case 'locked':
        this.free(dt, 0);
        this.tryUnlock();
        break;
      case 'unlocking':
      case 'impulse':
        this.engaged(dt, torque);
        break;
      case 'drop':
        this.free(dt, 0);
        this.falling(dt, torque);
        break;
    }

    if (this.peakSwing() < STALL_AMPLITUDE && this.phase !== 'drop') this.phase = 'stopped';
  }

  /** The balance on its own: a torsion pendulum with two kinds of drag. */
  private free(dt: number, extra: number): void {
    const restoring = -this.stiffness * this.theta;
    const drag = -DRAG_LINEAR * this.omega - DRAG_SQUARE * this.omega * Math.abs(this.omega);
    const alpha = (restoring + drag + extra) / BALANCE_INERTIA;

    const was = this.omega;
    this.omega += alpha * dt;
    this.theta += this.omega * dt;

    this.peak = Math.max(this.peak, Math.abs(this.theta));
    if (was !== 0 && Math.sign(this.omega) !== Math.sign(was)) {
      this.lastPeak = this.peak;
      this.peak = Math.abs(this.theta);
    }

    this.knock();
  }

  /**
   * Rebanking. Past about 334° the impulse jewel has gone right round and meets the far
   * side of the fork horn, which is a stop rather than a slot. The balance loses a chunk of
   * its energy on the spot and the rate goes to pieces, which is exactly what an overpowered
   * watch does.
   */
  private knock(): void {
    const beyond = Math.abs(this.theta) > KNOCK_ANGLE;
    if (!beyond) {
      this.knocking = this.elapsed - this.knockedAt < 2;
      return;
    }
    if (this.elapsed - this.knockedAt < 0.05) return;
    this.knockedAt = this.elapsed;
    this.knocking = true;
    this.omega *= -0.55;
    this.theta = Math.sign(this.theta) * KNOCK_ANGLE;
  }

  /** Has the impulse jewel arrived at the fork, going the way that will unlock it? */
  private tryUnlock(): void {
    // The jewel has to have gone right out of the fork and come back. Without this the
    // beat that has just finished would re-engage on the spot, halfway through an impulse.
    if (!this.armed) {
      if (Math.abs(this.theta) > ENGAGE_ANGLE) this.armed = true;
      return;
    }
    if (Math.abs(this.theta) > ENGAGE_ANGLE) return;
    if (Math.sign(this.omega) !== this.unlockDir) return;
    this.phase = 'unlocking';
    this.armed = false;
    this.lock = this.escape;
  }

  /**
   * Jewel in the fork slot, tooth on the pallet. For this brief window three bodies are one
   * body: the escape wheel's angle is a fixed function of the balance's, so the torque the
   * balance feels is the escape wheel's torque times dφ/dθ — the gear ratio of the moment.
   *
   * Which is why the same expression does both halves of the beat without being told which
   * is which. While the fork is being pushed through the lock the escape wheel is going
   * *backwards*, dφ/dθ is negative, and the balance is being slowed. Once the tooth is on
   * the impulse plane the wheel goes forwards, dφ/dθ flips sign, and the balance is being
   * pushed. Unlocking and impulse are not two mechanisms, they are one mechanism with the
   * sign of one derivative changed.
   */
  private engaged(dt: number, torque: number): void {
    const dir = this.unlockDir;
    // How far the balance has come through the engagement, measured the way it is going,
    // so that both directions of swing share one set of equations.
    const travel = dir * this.theta;

    // Both of these hand the balance back to the free swing, and both must still integrate
    // it for this step. Leaving the step out cost 0.2 ms a beat, which sounds like nothing
    // and is 86 seconds a day.
    if (travel >= IMPULSE_HALF) {
      this.release();
      this.free(dt, 0);
      return;
    }
    if (Math.sign(this.omega) !== dir) {
      // The balance ran out of energy partway through the unlocking and fell back. The
      // draw on the locking face shoves the lever home again and the watch has stopped,
      // even though the mainspring still has turns in it.
      this.phase = 'locked';
      this.escape = this.lock;
      this.fork = FORK_SENSE * dir * -HALF_FORK;
      this.free(dt, 0);
      return;
    }

    let ratio: number;
    let along: number;
    let swung: number;

    if (travel < -IMPULSE_HALF) {
      // Unlocking. The escape wheel is being driven backwards against its own torque.
      this.phase = 'unlocking';
      const u = (travel + ENGAGE_ANGLE) / UNLOCK_SPAN;
      along = -RECOIL * u;
      ratio = (-RECOIL * dir) / UNLOCK_SPAN;
      swung = -1 + 2 * LOCK_SHARE * u;
    } else {
      // Impulse. The tooth is on the sloped face of the pallet and is pushing.
      this.phase = 'impulse';
      const s = (travel + IMPULSE_HALF) / (2 * IMPULSE_HALF);
      // A raised cosine: it fades in and out instead of switching on square, and — the
      // part that matters — it is symmetric about the balance's rest position, so the
      // first-order effect on the period is nil.
      along = -RECOIL + IMPULSE_ADVANCE * (s - Math.sin(TAU * s) / TAU);
      ratio = (IMPULSE_ADVANCE * (1 - Math.cos(TAU * s)) * dir) / (2 * IMPULSE_HALF);
      swung = -1 + 2 * (LOCK_SHARE + (1 - LOCK_SHARE) * s);
    }

    this.escape = this.lock + along;
    this.fork = FORK_SENSE * dir * HALF_FORK * swung;

    // For this window the balance, the lever and the escape wheel are one body, so the
    // torque the balance feels is the escape wheel's torque times dφ/dθ: the gear ratio of
    // the moment. Which is why one expression does both halves of the beat. Going through
    // the lock the wheel runs backwards, dφ/dθ is negative and the balance is being
    // slowed; on the impulse plane it runs forwards, the sign flips, and the balance is
    // being pushed. Unlocking and impulse are one mechanism with one derivative's sign
    // changed, not two mechanisms.
    const raw = torque * ratio;
    // Friction takes its cut whichever way the energy is going: most of the impulse never
    // arrives, and the unlocking costs more than the recoil alone.
    const applied = raw * this.omega > 0 ? raw * IMPULSE_EFFICIENCY : raw * UNLOCK_FRICTION;
    this.free(dt, applied);
  }

  /** The tooth has left the pallet. The train is free until the next one lands. */
  private release(): void {
    this.phase = 'drop';
    this.dropLeft = DROP;
    this.dropRate = 0;
    this.fork = FORK_SENSE * this.unlockDir * HALF_FORK;
    this.unlockDir = this.unlockDir === 1 ? -1 : 1;
    this.armed = false;
    this.beats += 1;
    const period = this.elapsed - this.lastBeatAt;
    // Ignore the first beat after a start, when there is no previous one to measure from.
    if (this.lastBeatAt > 0 && period > 0.05 && period < 1) {
      this.beatPeriod = this.beatPeriod * 0.9 + period * 0.1;
    }
    this.lastBeatAt = this.elapsed;
  }

  /**
   * The drop, driven by the train's own inertia. It takes a millisecond or two at full
   * wind and visibly longer at the end of the reserve, which is a real and slightly
   * alarming thing to watch: the drop is the only moment in the whole beat when the wheels
   * are running free, and it is where a weak mainspring shows first.
   */
  private falling(dt: number, torque: number): void {
    this.dropRate += (torque / TRAIN_INERTIA) * dt;
    const move = Math.min(this.dropLeft, this.dropRate * dt);
    this.escape += move;
    this.dropLeft -= move;
    if (this.dropLeft <= 1e-12) this.phase = 'locked';
  }

  private peakSwing(): number {
    return Math.max(this.peak, this.lastPeak);
  }

  // ---------------------------------------------------------------- fast forward

  /**
   * Hours at a time, without integrating four million beats.
   *
   * The balance is replaced by its own steady state: the amplitude at which what the
   * escapement gives equals what friction takes, found by solving the energy balance
   * directly. That is the same equilibrium the integrator above walks to on its own, so
   * the two agree to within a degree or so — and running the same movement both ways is a
   * fair test of each.
   */
  fastForward(seconds: number): void {
    const slice = 30;
    let left = seconds;
    while (left > 1e-6) {
      const dt = Math.min(slice, left);
      left -= dt;

      const torque = this.torque;
      const swing = Math.min(settledAmplitude(torque), KNOCK_ANGLE);
      if (torque <= 0 || swing < STALL_AMPLITUDE) {
        this.phase = 'stopped';
        this.omega = 0;
        this.theta = 0;
        this.elapsed += left + dt;
        return;
      }

      // Left in a state the accurate integrator can pick up from cleanly when the speed
      // comes back down: locked, armed, waiting for the balance to come round.
      this.phase = 'locked';
      this.armed = true;
      const beats = dt * 2 * BALANCE_HZ;
      this.escape += beats * BEAT_STEP;
      this.beats += beats;
      this.elapsed += dt;

      // Keep the balance visibly alive rather than frozen, even though nobody can see
      // 2.5 Hz at this speed.
      this.theta = swing * Math.sin(TAU * BALANCE_HZ * this.elapsed);
      this.peak = swing;
      this.lastPeak = swing;
      this.omega = swing * BALANCE_OMEGA * Math.cos(TAU * BALANCE_HZ * this.elapsed);
      this.fork = FORK_SENSE * Math.sign(this.theta) * HALF_FORK;
      this.beatPeriod = 1 / (2 * BALANCE_HZ);
    }
  }

  // ---------------------------------------------------------------- readouts

  pose(): Pose {
    return {
      escape: this.escape,
      balance: this.theta,
      fork: this.fork,
      // The arbor turns the same way as the barrel, because tension is the difference
      // between the two and it would not be a difference otherwise.
      arbor: -this.arborTurns * TAU,
      crown: this.crownTurns * TAU,
    };
  }

  /** What the hands are showing, in seconds since midnight. */
  get shown(): number {
    return this.trainSeconds + this.handShift;
  }

  /** Time as the *train* has counted it, which is what the seconds hand is geared to. */
  get trainSeconds(): number {
    return (this.escape / TAU) * (3600 / 600);
  }

  hands(): Hands {
    const shown = this.shown;
    return {
      hour: TAU * ((shown % 43200) / 43200),
      minute: TAU * ((shown % 3600) / 3600),
      // Not shifted: the seconds hand sits on the fourth wheel, upstream of the cannon
      // pinion's slip, so setting the time slides the other two hands past it.
      second: TAU * ((this.trainSeconds % 60) / 60),
    };
  }

  read(): Reading {
    const wind = this.wind;
    const running = this.phase !== 'stopped';
    const beatRate = running ? 3600 / this.beatPeriod : 0;
    const swing = running ? this.peakSwing() : 0;
    // Hours left: the barrel gives up one turn every eight hours of running.
    const reserve = Math.max(0, wind) * (TRAIN_RATIO / 600);
    return {
      phase: this.phase,
      running,
      amplitude: swing / DEG,
      wind,
      barrelTorque: barrelTorque(wind, this.strength),
      escapeTorque: escapeTorque(wind, this.strength),
      beatRate,
      rate: running ? (beatRate / BEATS_PER_HOUR - 1) * 86400 : 0,
      reserve,
      knocking: this.knocking,
      regulator: this.index,
      elapsed: this.elapsed,
      shown: this.shown,
      beats: this.beats,
    };
  }

  /**
   * Where every wheel in the going train is, given the one number that fixes them all.
   * Each mesh reverses the direction, which is why the signs alternate.
   *
   * Which way round the whole chain goes is set at the barrel, by which way the mainspring
   * was coiled, and it is not a free choice: the minute hand is two meshes downstream of
   * the barrel, so a barrel running one way gives a watch that runs backwards. This one
   * runs anticlockwise seen from the back, which is clockwise seen from the front, which
   * is the only answer anybody will accept.
   */
  wheels(): Record<'barrel' | 'centre' | 'third' | 'fourth' | 'escape', number> {
    const escape = this.escape;
    return {
      escape: -escape,
      fourth: escape / STEP_UP.escape,
      third: -escape / (STEP_UP.escape * STEP_UP.fourth),
      centre: escape / (STEP_UP.escape * STEP_UP.fourth * STEP_UP.third),
      barrel: -escape / TRAIN_RATIO,
    };
  }
}

/**
 * The amplitude at which the escapement's gift and friction's bill are equal.
 *
 * Energy in per beat is the impulse less the unlocking; energy out over the same half
 * period is (π/2)·c₁·ω·A² from the linear drag plus (4/3)·c₂·ω²·A³ from the quadratic one.
 * Setting them equal gives a cubic in A, solved here by bisection because it is once a
 * frame at worst and brevity is worth more than speed.
 */
export function settledAmplitude(torque: number): number {
  const gain = torque * (IMPULSE_ADVANCE * IMPULSE_EFFICIENCY - RECOIL * UNLOCK_FRICTION);
  if (gain <= 0) return 0;

  const cost = (amp: number): number =>
    (Math.PI / 2) * DRAG_LINEAR * BALANCE_OMEGA * amp * amp +
    (4 / 3) * DRAG_SQUARE * BALANCE_OMEGA * BALANCE_OMEGA * amp * amp * amp;

  let low = 0;
  let high = TAU;
  for (let step = 0; step < 60; step += 1) {
    const mid = (low + high) / 2;
    if (cost(mid) < gain) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export { DEG, TAU };
