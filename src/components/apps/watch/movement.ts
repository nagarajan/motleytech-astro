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

// ---------------------------------------------------------------- automatic winding

/**
 * The automatic work: an oscillating weight and the train that connects it to the barrel.
 *
 * Rotor pinion drives the reduction wheel, the reduction pinion drives the reversing
 * wheel, and the reversing pinion drives the ratchet wheel — the same ratchet wheel the
 * crown winds through, which is why an automatic can still be wound by hand.
 */
export const AUTO = {
  rotorPinion: 9,
  reduction: 45,
  reductionPinion: 8,
  reversing: 40,
  reversingPinion: 9,
} as const;

/**
 * Rotor turns per turn of the barrel arbor: 5 × 5 × 4 = 100.
 *
 * This number is the whole design problem of an automatic in one place. It cannot be
 * small, because the rotor has to be able to wind a spring that is already nearly full and
 * the torque it can muster is tiny — so the reduction is what turns a feeble weight into
 * something that can pull against a mainspring. But every stage of reduction is another
 * wheel, another pinion, another two bearings and more friction, in a watch that has no
 * room for any of them.
 *
 * It also explains the shape of the module. One wheel-and-pinion stage gets you perhaps
 * five to one, so a hundred to one is three stages, and there is no way round that: the
 * teeth you can fit on a two-millimetre wheel are what they are.
 */
export const AUTO_RATIO =
  (AUTO.reduction / AUTO.rotorPinion) *
  (AUTO.reversing / AUTO.reductionPinion) *
  (KEYLESS.ratchet / AUTO.reversingPinion);

/** Moment of inertia of the rotor about its pivot, kg·m². A few grams of tungsten. */
const ROTOR_INERTIA = 1.5e-7;

/**
 * Mass times the distance out to the centre of gravity, kg·m — the only property of the
 * rotor's shape that matters to the physics. Multiply it by an acceleration and you have
 * the torque. At one g that is 235 µN·m, against the 42 µN·m the winding train asks for
 * with a full mainspring, so the rotor has about five times the muscle it needs. It has to:
 * a rotor that could only just wind a slack spring would stop winding half way up.
 */
const ROTOR_MOMENT = 2.4e-5;

/**
 * Ball race friction, plus what the reduction pinion costs to drag round even unloaded.
 * Set for a Q of about six: free enough that the rotor coasts through the top of a swing,
 * damped enough that it does not sit and ring at its own six-hertz resonance, which is
 * what an undamped one does and which put the winding rate out by a factor of four.
 */
const ROTOR_DRAG = 1.0e-6;

/** What survives three reductions and a reverser. */
const AUTO_EFFICIENCY = 0.55;

const GRAVITY = 9.81;

/** How often the rotor is integrated. Its natural flutter is about 6 Hz; this is ample. */
const ROTOR_STEP = 2e-3;

/** How long a sample of wrist motion is worth watching before believing its average. */
const ROTOR_SAMPLE = 2;

export interface Wrist {
  id: string;
  label: string;
  /** How far the watch itself turns, in radians either side of level. */
  swing: number;
  /** Swings per second. */
  pace: number;
  /**
   * The radius of the arc the watch travels on, in metres — how much the swing translates
   * it as well as turning it. These have to be separate, because the two things a wrist
   * does to a rotor are not the same thing. An arm swinging from the shoulder carries the
   * watch on a 60 cm arc and throws it about; a hand turning over at a keyboard rotates
   * the watch just as far while barely moving it anywhere. Collapse them into one number
   * and desk work comes out either as no winding at all or as half a g of shaking.
   */
  reach: number;
  /** How ragged it is. A real arm does not run on a sine wave. */
  jitter: number;
  /**
   * How much of gravity lies in the plane the rotor turns in: 1 with the watch on edge,
   * 0 with it lying flat. This is not a detail — it is the reason an automatic left face
   * up on a bedside table stops, and stops even if you nudge the table. A rotor can only
   * be pulled round by the part of gravity it can actually see.
   */
  lean: number;
  note: string;
}

export const ACTIVITY: Wrist[] = [
  {
    id: 'off',
    label: 'On the table',
    swing: 0,
    pace: 0,
    reach: 0,
    jitter: 0,
    lean: 0,
    note: 'Lying dial up. Gravity now points straight down the rotor’s axis, where the rotor has no leverage on it at all, so nothing happens — which is why a watch left face up overnight is stopped in the morning.',
  },
  {
    id: 'still',
    label: 'Worn, sitting still',
    swing: 0.07,
    pace: 0.4,
    reach: 0.1,
    jitter: 0.8,
    lean: 0.85,
    note: 'On a wrist that is barely moving. The rotor hangs and twitches. It winds, but it cannot keep up with a spring that is already strong, so the watch drifts down rather than up.',
  },
  {
    id: 'desk',
    label: 'At a desk',
    swing: 0.55,
    pace: 0.5,
    reach: 0.18,
    jitter: 1.0,
    lean: 0.8,
    note: 'Typing, reaching for a mouse, turning a page. The hand turns right over and takes the watch with it, so the rotor sees a large rotation even though nothing much is moving anywhere.',
  },
  {
    id: 'walking',
    label: 'Walking',
    swing: 0.38,
    pace: 0.9,
    reach: 0.62,
    jitter: 0.35,
    lean: 0.9,
    note: 'The arm swinging from the shoulder at about a step a second. This is the case an automatic is designed around, and it winds far faster than the watch can spend it.',
  },
  {
    id: 'brisk',
    label: 'Walking briskly',
    swing: 0.6,
    pace: 1.2,
    reach: 0.62,
    jitter: 0.3,
    lean: 0.9,
    note: 'Enough that the rotor stops hanging and starts going over the top.',
  },
  {
    id: 'running',
    label: 'Running',
    swing: 0.95,
    pace: 1.6,
    reach: 0.62,
    jitter: 0.4,
    lean: 0.9,
    note: 'The rotor goes right round, several times a second, and the bridle spends most of its time slipping.',
  },
];

export const ACTIVITY_BY_ID = new Map(ACTIVITY.map((entry) => [entry.id, entry]));

/**
 * The arm, as a pendulum about the shoulder.
 *
 * Two sinusoids rather than one, at an awkward ratio so they never quite repeat, which is
 * a cheap way to get something that looks like a person rather than a metronome. Written
 * as a closed form because the rotor needs the second derivative and taking that off a
 * noise source numerically is a good way to shake a simulation to pieces.
 *
 * The second harmonic is sized by the acceleration it contributes rather than the angle,
 * hence the division by the frequency ratio squared. Size it by angle instead and a
 * "sitting at a desk" that looks placid on a plot turns out to be shaking the watch at
 * half a g, because differentiating twice multiplies the harmonic by seven.
 */
const JITTER_RATIO = 2.7;

function armSwing(wrist: Wrist, t: number): { angle: number; rate: number; accel: number } {
  const omega = TAU * wrist.pace;
  const second = (0.4 * wrist.jitter) / (JITTER_RATIO * JITTER_RATIO);
  const scale = wrist.swing / (1 + second);
  const a = omega * t;
  const b = JITTER_RATIO * a + 1.1;
  return {
    angle: scale * (Math.sin(a) + second * Math.sin(b)),
    rate: scale * omega * (Math.cos(a) + second * JITTER_RATIO * Math.cos(b)),
    accel:
      -scale *
      omega *
      omega *
      (Math.sin(a) + second * JITTER_RATIO * JITTER_RATIO * Math.sin(b)),
  };
}

// ---------------------------------------------------------------- state

export type Phase = 'locked' | 'unlocking' | 'impulse' | 'drop' | 'stopped';

export interface Pose {
  /** Absolute escape wheel angle. Every wheel in the going train follows from this one. */
  escape: number;
  balance: number;
  fork: number;
  /** Barrel arbor angle, wound by the crown, the rotor, or both. */
  arbor: number;
  crown: number;
  /** The rotor's angle relative to the watch. */
  rotor: number;
  /** Which way the watch itself is hanging, from the swing of the arm. */
  tilt: number;
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
  /** How fast the rotor is going round, in turns a minute, either way. */
  rotorSpeed: number;
  /** Turns a hour the rotor is putting into the barrel arbor. */
  windingRate: number;
  /** Turns an hour the going train is taking back out. */
  spendRate: number;
  /** The mainspring is full and the bridle is slipping: winding into nothing. */
  slipping: boolean;
  /** Turns the bridle has let go of since the movement was reset. */
  slipped: number;
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

  /**
   * Turns the bridle has slipped. The arbor keeps turning when the spring is full — the
   * rotor has nowhere else to put them — so the tension in the spring is the turns wound
   * in, less the turns that slipped away at the barrel wall, less what has run off through
   * the train.
   */
  private slipped = 0;
  /** Turns the bridle alone has given up, for the readout. */
  private bridleTurns = 0;
  /**
   * How fast it is giving them up, in turns an hour, smoothed. A rate rather than a flag,
   * because a rotor at full wind slips in jerks — a few hundredths of a turn as it swings,
   * nothing at all while it hangs — so a flag set from the last step alone flickers several
   * times a second. And smoothed the same way for the same reason.
   */
  private slipRate = 0;

  // The rotor, relative to the watch, and the wrist that throws it about. It starts where
  // it would be found: hanging. Start it anywhere else and the first thing it does is fall,
  // and the fast-forward, which measures the rotor over a few seconds and believes the
  // answer, reads that one drop as the steady rate and winds the watch off a transient.
  private rotorAngle = -Math.PI / 2;
  private rotorRate = 0;
  private rotorClock = 0;
  private wristClock = 0;
  private wrist: Wrist = ACTIVITY[0];
  private tilt = 0;

  /** Rotor speed and winding rate, smoothed, because the raw numbers are a blur. */
  private rotorSpeed = 0;
  private windingRate = 0;
  private lastShake = -1;

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
    return Math.max(0, this.arborTurns - this.slipped - this.escape / TAU / TRAIN_RATIO);
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

  // ---------------------------------------------------------------- the rotor

  setWrist(wrist: Wrist): void {
    this.wrist = wrist;
  }

  get activity(): Wrist {
    return this.wrist;
  }

  /**
   * One step of the rotor, returning the angle it turned through. It does not touch the
   * mainspring: the caller decides what to do with the turns, which is what lets the
   * fast-forward sample the rotor without winding the watch six times over.
   *
   * The rotor is a pendulum on a very good bearing, sitting in a frame that is itself
   * swinging about a shoulder, and the whole of its behaviour comes out of that. In the
   * watch's own frame:
   *
   *     I·φ̈ = m·r·(cos φ · f_y − sin φ · f_x) − c·φ̇ − τ_load − I·ψ̈
   *
   * where φ is the rotor's angle in the watch, ψ is the watch's own rotation, and f is not
   * gravity but the *specific force* — gravity less the frame's acceleration, which is
   * what an accelerometer reads and what a weight on a pivot actually responds to. Ignore
   * the difference and the rotor would only ever be driven by tilting the watch, which
   * gets walking badly wrong: half the energy in a swinging arm is in the acceleration.
   *
   * The last term is the Euler force. The watch turns under the rotor, so some of the
   * rotor's apparent movement is the watch moving and the rotor staying where it was —
   * which is the other half of how these things wind, and the reason a rotor with a good
   * enough bearing barely needs gravity at all.
   */
  private rotorStep(dt: number): number {
    this.wristClock += dt;
    const arm = armSwing(this.wrist, this.wristClock);
    this.tilt = arm.angle;

    // Gravity in watch coordinates, less what the arm is doing to the watch. The watch
    // sweeps an arc, so it contributes a tangential term from the angular acceleration and
    // a centripetal one, towards the middle of the arc, from the speed.
    const g = GRAVITY * this.wrist.lean;
    const reach = this.wrist.reach;
    const fx = -g * Math.sin(arm.angle) - reach * arm.accel;
    const fy = -g * Math.cos(arm.angle) - reach * arm.rate * arm.rate;

    const drive =
      ROTOR_MOMENT * (Math.cos(this.rotorAngle) * fy - Math.sin(this.rotorAngle) * fx);

    // What the winding train asks for, referred back to the rotor. A reverser means the
    // rotor pulls against the mainspring whichever way it is going, so the load always
    // opposes the motion — the rotor is never coasting free once it is moving.
    //
    // The load behaves like dry friction rather than like a torque, because the train can
    // hold the rotor but can never push it, and it has to be integrated the way friction
    // is: work out where the rotor would go unresisted, then let the load take away at
    // most enough to stop it dead. Subtracting it as a plain torque instead lets a stalled
    // rotor chatter — stopped, so no load, so it accelerates, so it is moving, so the load
    // reverses it, so it is stopped — and each cycle of that counts as winding. It winds a
    // dead watch to full in half an hour off nothing but the integrator.
    const load = barrelTorque(this.wind, this.strength) / (AUTO_RATIO * AUTO_EFFICIENCY);
    const free = this.rotorRate + ((drive - ROTOR_DRAG * this.rotorRate) / ROTOR_INERTIA) * dt;
    const most = (load / ROTOR_INERTIA) * dt;
    const rate = Math.abs(free) <= most ? 0 : free - Math.sign(free) * most;

    this.rotorRate = rate;
    const moved = rate * dt;
    // Wrapped, because a running rotor turns a few hundred thousand times a day and the
    // angle is only ever wanted modulo a turn.
    this.rotorAngle = (this.rotorAngle + moved) % TAU;
    return Math.abs(moved);
  }

  /**
   * Put a rotor's worth of turning into the barrel.
   *
   * Both directions wind, because the reverser rectifies the rotor: whichever way it goes,
   * one of the pair of reversing wheels locks and the other free-wheels, and the ratchet
   * wheel only ever turns the one way. A watch that only wound one way would waste half of
   * every swing, and the early automatics that did exactly that are why the reverser was
   * worth inventing.
   *
   * Then the bridle. The mainspring's outer end is not hooked to the barrel wall but held
   * against it by friction, so when the spring is full the arbor simply carries on turning
   * and the outer end slips. That is what stops a rotor bursting a mainspring on a day's
   * walking, and it means a worn automatic sits permanently at full wind rather than
   * anywhere near the bottom of its reserve.
   */
  private windFrom(rotorTurns: number, dt: number, ease: number): void {
    this.arborTurns += Math.max(0, rotorTurns) / AUTO_RATIO;

    const over = this.wind - FULL_WIND;
    const slip = Math.max(0, over);
    if (slip > 0) {
      this.slipped += slip;
      this.bridleTurns += slip;
    }
    this.slipRate += ((slip / dt) * 3600 - this.slipRate) * ease;

    if (rotorTurns <= 0) return;
    if (this.phase === 'stopped' && this.wind > 0.02 && this.elapsed - this.lastShake > 1) {
      // A stopped automatic on a moving wrist starts itself, and this is how: the rotor
      // slamming round is a jolt the balance feels.
      this.lastShake = this.elapsed;
      this.kick();
    }
  }

  /**
   * How many turns a second the rotor manages under the present load, measured by running
   * it. There is no formula for this: the answer depends on whether the rotor is hanging
   * and rocking, swinging over the top on some strides and not others, or going right
   * round, and which of those three it does is what the equation of motion decides.
   *
   * Three seconds is long enough to average over several strides and short enough that a
   * frame can afford it. The sample is run on the live rotor, so it genuinely carries on
   * from where the rotor was, but it is not allowed to wind: the caller does that once,
   * with the rate, for the whole jump.
   */
  private sampleRotor(): number {
    if (this.wrist.swing <= 0 && this.wrist.lean <= 0) return 0;
    let moved = 0;
    for (let t = 0; t < ROTOR_SAMPLE; t += ROTOR_STEP) moved += this.rotorStep(ROTOR_STEP);
    return moved / TAU / ROTOR_SAMPLE;
  }

  /**
   * Smooth the rotor's turns a second into something a readout can show. The raw figure
   * swings between nothing and thirty a second inside a single stride.
   */
  private watchRotor(turnsPerSecond: number, ease = 0.02): void {
    this.rotorSpeed += (turnsPerSecond * 60 - this.rotorSpeed) * ease;
    this.windingRate += ((turnsPerSecond * 3600) / AUTO_RATIO - this.windingRate) * ease;
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
    this.slipped = this.arborTurns - this.escape / TAU / TRAIN_RATIO;
  }

  fullWind(): void {
    this.slipped = this.arborTurns - this.escape / TAU / TRAIN_RATIO - FULL_WIND;
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

    // The rotor is a 6 Hz oscillator in a loop sized for a 2.5 Hz balance with a 52°
    // window in it, so it does not need anything like this step. Let it accumulate.
    this.rotorClock += dt;
    if (this.rotorClock >= ROTOR_STEP) {
      const span = this.rotorClock;
      this.rotorClock = 0;
      const moved = this.rotorStep(span);
      this.windFrom(moved / TAU, span, 0.02);
      this.watchRotor(moved / TAU / span);
    }

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
    // Ten seconds rather than thirty, because of the rotor. The balance does not care —
    // it is solved in closed form and a slice costs nothing — but the rotor's output has
    // to be measured under a particular load, and the load is exactly what the winding is
    // changing. Sample at an empty barrel, apply it for half a minute, and the watch winds
    // twice as fast as it should.
    const slice = 10;
    let left = seconds;

    while (left > 1e-6) {
      const dt = Math.min(slice, left);
      left -= dt;

      // The rotor cannot be skipped the way the balance can, because there is no
      // equilibrium to skip to: it is driven by a wrist, not by a spring, and only its
      // average survives. So measure the average — run a couple of seconds of wrist motion
      // properly and see how far the rotor got — and take that as the rate for the slice.
      const rotorRate = this.sampleRotor();
      this.windFrom(rotorRate * dt, dt, 0.4);
      this.watchRotor(rotorRate, 0.4);
      // The rotor's own angle is left exactly where the sample put it. Spinning it on to
      // cover the rest of the slice is tempting — it is what the balance gets — but the
      // rotor is not periodic and the next sample starts from wherever this one finished.
      // Drop it somewhere it would not have been and the sample measures it falling out of
      // that position, every slice, and reports the fall as the winding rate.

      const torque = this.torque;
      const swing = Math.min(settledAmplitude(torque), KNOCK_ANGLE);
      if (torque <= 0 || swing < STALL_AMPLITUDE) {
        // Out of power. The train has stopped, so nothing more runs off — but the rotor
        // does not care whether the watch is going, and on a wrist that is still moving it
        // will wind the watch back up and start it again. Which is the entire point.
        this.phase = 'stopped';
        this.omega = 0;
        this.theta = 0;
        this.elapsed += dt;
        if (rotorRate > 0) continue;
        // Nothing is going to start it again, so there is no point walking the rest.
        this.elapsed += left;
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
      rotor: this.rotorAngle,
      tilt: this.tilt,
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
      rotorSpeed: this.rotorSpeed,
      windingRate: this.windingRate,
      // What the train costs to run: one turn of the barrel every TRAIN_RATIO/600 hours.
      spendRate: running ? 600 / TRAIN_RATIO : 0,
      slipping: this.slipRate > 0.01,
      slipped: this.bridleTurns,
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

  /**
   * The automatic work, which has to be read from both ends at once.
   *
   * The rotor pinion and the reduction wheel follow the rotor, because they are bolted to
   * it through a mesh and go wherever it goes, backwards included. The reversing wheel and
   * its pinion follow the *ratchet*, because everything from there on only ever turns one
   * way. The discrepancy between the two is real, and it is the reverser: the whole job of
   * that assembly is to absorb the difference between a weight that wanders about and a
   * barrel that must only ever be wound.
   */
  autoWheels(): Record<'rotor' | 'reduction' | 'reversing', number> {
    const ratchet = -this.arborTurns * TAU;
    return {
      rotor: this.rotorAngle,
      reduction: (-this.rotorAngle * AUTO.rotorPinion) / AUTO.reduction,
      reversing: (-ratchet * KEYLESS.ratchet) / AUTO.reversingPinion,
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
