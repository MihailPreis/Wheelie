import { approxLength, div, mul } from './fpmath';
import { BODY_RADII, Contact, type Terrain } from './terrain';

/**
 * The bike simulation, ported from `Game/Physics.java`.
 *
 * The bike is six point bodies held together by ten damped springs. Every value is a 32-bit
 * integer in 16.16 fixed point and every expression keeps the operation order of the original:
 * the result has to match it bit for bit. Names in parentheses are the original identifiers.
 */

/** What a simulation tick reports (`Physics._dovI`). */
export const Status = {
  Riding: 0,
  /** The finish line was crossed. The two values differ only in how the crossing was detected. */
  Finished: 1,
  FinishedLate: 2,
  /** The bike broke apart. The simulation keeps running. */
  Broken: 3,
  /** The bike is still behind the start line: the clock is not running. */
  BeforeStart: 4,
  /** The rider hit the ground or the bike got stuck: the run is over. */
  Crashed: 5,
} as const;
export type Status = (typeof Status)[keyof typeof Status];

/** Indices into {@link Physics.bodies}. */
export const BodyIndex = {
  Frame: 0,
  FrontWheel: 1,
  RearWheel: 2,
  FrameFront: 3,
  FrameRear: 4,
  Head: 5,
} as const;

/** State of one body at one point of the integration (`SimpleMenuElement`). */
export class BodyState {
  x = 0;
  y = 0;
  /** Rotation angle (`m_bI`). */
  angle = 0;
  /** Velocity (`m_eI`, `m_dI`). */
  vx = 0;
  vy = 0;
  /** Angular velocity (`m_gotoI`). */
  spin = 0;
  /** Accumulated force (`m_nullI`, `m_longI`). */
  fx = 0;
  fy = 0;
  /** Accumulated torque (`m_fI`). */
  torque = 0;

  reset(): void {
    this.x = this.y = this.angle = 0;
    this.vx = this.vy = this.spin = 0;
    this.fx = this.fy = this.torque = 0;
  }
}

/** Number of state slots per body: two that alternate as current and next, three scratch slots. */
const SLOT_COUNT = 5;
const SCRATCH_DERIVATIVE_A = 2;
const SCRATCH_DERIVATIVE_B = 3;
const SCRATCH_MIDPOINT = 4;

/** One of the six point bodies (`k`). */
export class Body {
  /** Collision radius (`m_aI`). */
  radius = 0;
  /** Index into {@link BODY_RADII} (`m_intI`). */
  kind = 0;
  /** Inverse mass (`m_forI`). */
  inverseMass = 0;
  /** How strongly torque spins this body up; non-zero only for the driven wheel (`m_newI`). */
  torqueResponse = 0;
  readonly slots: BodyState[] = [];

  constructor() {
    for (let i = 0; i < SLOT_COUNT; i++) this.slots.push(new BodyState());
  }
}

/** A damped spring between two bodies (the `m_ian` entries). */
class Spring {
  /** Stiffness (`x`). */
  stiffness = 0;
  /** Rest length (`y`). */
  restLength = 0;
  /** Damping (`m_bI`). */
  damping = 0;
}

/** Time step of one tick (`m_YI`). */
const TIME_STEP = 1310;
/** Gravity (`m_voidI`). */
const GRAVITY = 0x190000;
/** The step is abandoned once collision bisection gets below this (`_uII`). */
const MIN_SUB_STEP = 65;

/** Body layout at spawn: radius kind, inverse-mass divisor, offset from the spawn point, torque response. */
const BODY_LAYOUT: readonly (readonly [number, number, number, number, number])[] = [
  [1, 0x58000, 0, 0, 0],
  [0, 0x18000, 0x38000, 0, 0],
  [0, 0x58000, -0x38000, 0, 21626],
  [1, 0x38000, 0x20000, 0x30000, 0],
  [1, 0x38000, -0x20000, 0x30000, 0],
  [2, 0x48000, 0, 0x50000, 0],
];

const SPRING_REST_LENGTHS = [
  0x38000, 0x38000, 0x39b05, 0x39b05, 0x40000, 0x35aa6, 0x35aa6, 0x2d413, 0x2d413, 0x50000,
] as const;

/** Tuning that differs between the leagues (`setLeague`). */
interface LeagueTuning {
  /** Ground bounce along the surface normal for wheels and other bodies (`m_aeI`, `m_adI`). */
  bounceA: number;
  bounceB: number;
  /** Top wheel spin (`m_PI`). */
  maxSpin: number;
  /** Engine torque limit (`m_QI`). */
  maxEngineTorque: number;
  /** Engine torque added per tick of throttle (`m_charI`). */
  engineStep: number;
  /** How quickly braking slows the wheels (`m_abI`). */
  brakeStrength: number;
  /** Extra grip while braking (`m_WI`). */
  brakeGrip: number;
  /** Strength of the rider's lean (`m_AI`). */
  leanStrength: number;
  /** Rotation speed above which leaning has no more effect (`m_longI`). */
  leanSpeedLimit: number;
  /** Stiffness shared by the springs (`m_qI`). */
  springStiffness: number;
}

const LEAGUES: readonly LeagueTuning[] = [
  {
    bounceA: 19660,
    bounceB: 19660,
    maxSpin: 0x110000,
    maxEngineTorque: 0x3200000,
    engineStep: 0x320000,
    brakeStrength: 327,
    brakeGrip: 0,
    leanStrength: 32768,
    leanSpeedLimit: 0x50000,
    springStiffness: 0x12c0000,
  },
  {
    bounceA: 32768,
    bounceB: 32768,
    maxSpin: 0x110000,
    maxEngineTorque: 0x3e80000,
    engineStep: 0x320000,
    brakeStrength: 6553,
    brakeGrip: 26214,
    leanStrength: 26214,
    leanSpeedLimit: 0x50000,
    springStiffness: 0x12c0000,
  },
  {
    bounceA: 32768,
    bounceB: 32768,
    maxSpin: 0x140000,
    maxEngineTorque: 0x47e0000,
    engineStep: 0x350000,
    brakeStrength: 6553,
    brakeGrip: 26214,
    leanStrength: 39321,
    leanSpeedLimit: 0x50000,
    springStiffness: 0x14a0000,
  },
  {
    bounceA: 32768,
    bounceB: 32768,
    maxSpin: 0x160000,
    maxEngineTorque: 0x4b00000,
    engineStep: 0x360000,
    brakeStrength: 6553,
    brakeGrip: 26214,
    leanStrength: 0x10000,
    leanSpeedLimit: 0x140000,
    springStiffness: 0x14a0000,
  },
];

export const LEAGUE_COUNT = LEAGUES.length;

// Constants shared by all leagues (`setLeague`).
/** Wheel grip (`m_gI`). */
const GRIP = 45875;
/** (`m_fI`) */
const SLIP_FROM_SURFACE = 13107;
/** (`m_eI`) */
const SURFACE_FROM_SPIN = 39321;
/** Base of the bodies' inverse masses (`m_yI`). */
const MASS_SCALE = 0x140000;
/** Spring damping (`m_xI`). */
const SPRING_DAMPING = 0x40000;
/** Engine torque lost per force evaluation (`m_jI`). */
const ENGINE_DECAY = 6553;

/** `v <= 0 ? -1 : 1`, the sign convention the original uses when steering the demo rider. */
const signLoose = (value: number) => (value <= 0 ? -1 : 1);
/** `v < 0 ? -1 : 1`. */
const signStrict = (value: number) => (value < 0 ? -1 : 1);
const abs = (value: number) => (value >= 0 ? value : -value | 0);

export class Physics {
  readonly bodies: Body[] = [];
  private readonly springs: Spring[] = [];
  private tuning: LeagueTuning = LEAGUES[0] as LeagueTuning;
  /** 0–3; decides the bike's tuning and how it is drawn (`m_hI`). */
  league = 0;

  /** Slots holding the current and the next state; they swap after every accepted sub-step (`m_vaI`, `m_waI`). */
  current = 0;
  next = 1;

  /** Body found touching the ground by the last collision test (`m_xaI`). */
  private contactBody = -1;
  /** Surface normal of that contact (`m_EI`, `m_CI`). */
  private contactNormalX = 0;
  private contactNormalY = 0;

  /** Torque the engine currently applies to the rear wheel (`m_cI`). */
  engineTorque = 0;
  /** Signed measure of how fast the bike is rotating (`m_kI`). */
  private rotation = 0;
  /** Rider's posture: 0 leaning back, 0x10000 leaning forward, 0x8000 upright (`m_TI`). */
  riderLean = 32768;

  /** The bike has broken apart (`m_IZ`). */
  broken = false;
  /** The rider's head touched the ground (`m_mZ`). */
  headHit = false;
  /** The finish line has been crossed (`m_RZ`). */
  finished = false;
  /** The front wheel has touched the ground since the start; if never, the run was one long wheelie (`m_NZ`). */
  frontWheelTouched = false;
  /** The built-in demo rider is in control and input is ignored (`m_vZ`). */
  demo = false;

  // Controls as last set by the player (`m_ifZ`, `m_sZ`, `m_OZ`, `m_rZ`).
  private inputThrottle = false;
  private inputBrake = false;
  private inputLeanBack = false;
  private inputLeanForward = false;

  // Controls in effect for the current tick (`m_dZ`, `m_FZ`, `m_XZ`, `m_wZ`).
  private throttle = false;
  private brake = false;
  private leanBack = false;
  private leanForward = false;

  constructor(
    private readonly terrain: Terrain,
    league: number,
  ) {
    for (let i = 0; i < BODY_LAYOUT.length; i++) this.bodies.push(new Body());
    for (let i = 0; i < SPRING_REST_LENGTHS.length; i++) this.springs.push(new Spring());
    this.setLeague(league);
  }

  /** `setLeague`. Also puts the bike back on the start, as in the original. */
  setLeague(league: number): void {
    this.league = league >= 0 && league < LEAGUES.length ? league : 0;
    this.tuning = LEAGUES[this.league] as LeagueTuning;
    this.reset();
  }

  /** Puts the bike on the start with everything at rest (`_doZV`). */
  reset(): void {
    this.placeBike(this.terrain.spawnX, this.terrain.spawnY);
    this.engineTorque = 0;
    this.rotation = 0;
    this.broken = false;
    this.headHit = false;
    this.finished = false;
    this.frontWheelTouched = false;
    this.demo = false;
  }

  /** Hands the bike to the built-in demo rider (`_casevV`). */
  startDemo(): void {
    this.reset();
    this.demo = true;
  }

  /** `_iIIV` */
  private placeBike(x: number, y: number): void {
    for (let i = 0; i < this.bodies.length; i++) {
      const body = this.bodies[i] as Body;
      const [kind, massDivisor, offsetX, offsetY, torqueResponse] = BODY_LAYOUT[i] as (typeof BODY_LAYOUT)[number];
      for (const slot of body.slots) slot.reset();
      body.radius = BODY_RADII[kind] as number;
      body.kind = kind;
      // Java: (int) ((long) (int) (0x1000000000000L / (long) l1 >> 16) * (long) m_yI >> 16)
      body.inverseMass = mul(Math.floor(0x100000000 / massDivisor) | 0, MASS_SCALE);
      const state = body.slots[this.current] as BodyState;
      state.x = (x + offsetX) | 0;
      state.y = (y + offsetY) | 0;
      body.torqueResponse = torqueResponse;
    }

    const stiffness = this.tuning.springStiffness;
    for (let i = 0; i < this.springs.length; i++) {
      const spring = this.springs[i] as Spring;
      spring.stiffness = stiffness;
      spring.restLength = SPRING_REST_LENGTHS[i] as number;
      spring.damping = SPRING_DAMPING;
    }
    (this.springs[5] as Spring).damping = mul(SPRING_DAMPING, 45875);
    (this.springs[6] as Spring).stiffness = mul(6553, stiffness);
    (this.springs[5] as Spring).stiffness = mul(6553, stiffness);
    (this.springs[9] as Spring).stiffness = mul(0x11999, stiffness);
    (this.springs[8] as Spring).stiffness = mul(0x11999, stiffness);
    (this.springs[7] as Spring).stiffness = mul(0x11999, stiffness);
  }

  /**
   * Sets the controls for the coming ticks (`_aIIV`). `throttle` above zero accelerates, below
   * zero brakes; `lean` above zero leans forward, below zero leans back. Ignored during the demo.
   */
  setInput(throttle: number, lean: number): void {
    if (this.demo) return;
    this.inputThrottle = this.inputBrake = this.inputLeanForward = this.inputLeanBack = false;
    if (throttle > 0) this.inputThrottle = true;
    else if (throttle < 0) this.inputBrake = true;
    if (lean > 0) this.inputLeanForward = true;
    else if (lean < 0) this.inputLeanBack = true;
  }

  private at(body: number, slot: number): BodyState {
    return (this.bodies[body] as Body).slots[slot] as BodyState;
  }

  /** Advances the simulation by one tick (`_dovI`). */
  tick(): Status {
    this.throttle = this.inputThrottle;
    this.brake = this.inputBrake;
    this.leanBack = this.inputLeanBack;
    this.leanForward = this.inputLeanForward;
    if (this.demo) this.steerDemo();
    this.applyControls();
    const result = this.advance(TIME_STEP);
    if (result === Status.Crashed || this.headHit) return Status.Crashed;
    if (this.broken) return Status.Broken;
    if (this.isBeforeStart()) {
      this.frontWheelTouched = false;
      return Status.BeforeStart;
    }
    return result;
  }

  /** The demo rider: keeps the throttle open and leans against the bike's tilt (`_pvV`). */
  private steerDemo(): void {
    const front = this.at(1, this.current);
    const rear = this.at(2, this.current);
    const frame = this.at(0, this.current);
    const dx = (front.x - rear.x) | 0;
    const dy = (front.y - rear.y) | 0;
    const length = approxLength(dx, dy);
    div(dx, length);
    const tilt = div(dy, length);
    this.brake = false;
    if (tilt < 0) {
      this.leanBack = true;
      this.leanForward = false;
    } else if (tilt > 0) {
      this.leanForward = true;
      this.leanBack = false;
    }
    const tipping = signLoose((rear.y - frame.y) | 0) * signLoose((rear.vx - frame.vx) | 0) > 0;
    this.throttle = (tipping && this.leanForward) || (!tipping && this.leanBack);
  }

  /** Turns the controls into engine torque, braking, mass shifts and lean impulses (`_qvV`). */
  private applyControls(): void {
    if (this.broken) return;
    const tuning = this.tuning;
    const front = this.at(1, this.current);
    const rear = this.at(2, this.current);
    let dx = (front.x - rear.x) | 0;
    let dy = (front.y - rear.y) | 0;
    const length = approxLength(dx, dy);
    dx = div(dx, length);
    dy = div(dy, length);

    if (this.throttle && this.engineTorque >= -tuning.maxEngineTorque) {
      this.engineTorque = (this.engineTorque - tuning.engineStep) | 0;
    }
    if (this.brake) {
      this.engineTorque = 0;
      front.spin = mul(front.spin, 0x10000 - tuning.brakeStrength);
      rear.spin = mul(rear.spin, 0x10000 - tuning.brakeStrength);
      if (front.spin < 6553) front.spin = 0;
      if (rear.spin < 6553) rear.spin = 0;
    }

    const bodies = this.bodies as [Body, Body, Body, Body, Body, Body];
    bodies[0].inverseMass = mul(11915, MASS_SCALE);
    bodies[4].inverseMass = mul(18724, MASS_SCALE);
    bodies[3].inverseMass = mul(18724, MASS_SCALE);
    bodies[1].inverseMass = mul(43690, MASS_SCALE);
    bodies[2].inverseMass = mul(11915, MASS_SCALE);
    bodies[5].inverseMass = mul(14563, MASS_SCALE);
    if (this.leanBack) {
      bodies[0].inverseMass = mul(18724, MASS_SCALE);
      bodies[4].inverseMass = mul(14563, MASS_SCALE);
      bodies[3].inverseMass = mul(18724, MASS_SCALE);
      bodies[1].inverseMass = mul(43690, MASS_SCALE);
      bodies[2].inverseMass = mul(10082, MASS_SCALE);
    } else if (this.leanForward) {
      bodies[0].inverseMass = mul(18724, MASS_SCALE);
      bodies[4].inverseMass = mul(18724, MASS_SCALE);
      bodies[3].inverseMass = mul(14563, MASS_SCALE);
      bodies[1].inverseMass = mul(26214, MASS_SCALE);
      bodies[2].inverseMass = mul(11915, MASS_SCALE);
    }

    if (this.leanBack || this.leanForward) {
      const perpX = -dy | 0;
      const perpY = dx;
      const frameFront = this.at(3, this.current);
      const frameRear = this.at(4, this.current);
      const head = this.at(5, this.current);
      const limit = tuning.leanSpeedLimit;

      if (this.leanBack && this.rotation > -limit) {
        let fade = 0x10000;
        if (this.rotation < 0) fade = div((limit - abs(this.rotation)) | 0, limit);
        const strength = mul(tuning.leanStrength, fade);
        const sideX = mul(perpX, strength);
        const sideY = mul(perpY, strength);
        const alongX = mul(dx, strength);
        const alongY = mul(dy, strength);
        if (this.riderLean > 32768) this.riderLean = this.riderLean - 1638 >= 0 ? this.riderLean - 1638 : 0;
        else this.riderLean = this.riderLean - 3276 >= 0 ? this.riderLean - 3276 : 0;
        frameRear.vx = (frameRear.vx - sideX) | 0;
        frameRear.vy = (frameRear.vy - sideY) | 0;
        frameFront.vx = (frameFront.vx + sideX) | 0;
        frameFront.vy = (frameFront.vy + sideY) | 0;
        head.vx = (head.vx - alongX) | 0;
        head.vy = (head.vy - alongY) | 0;
      }
      if (this.leanForward && this.rotation < limit) {
        let fade = 0x10000;
        if (this.rotation > 0) fade = div((limit - this.rotation) | 0, limit);
        const strength = mul(tuning.leanStrength, fade);
        const sideX = mul(perpX, strength);
        const sideY = mul(perpY, strength);
        const alongX = mul(dx, strength);
        const alongY = mul(dy, strength);
        if (this.riderLean > 32768) this.riderLean = this.riderLean + 1638 >= 0x10000 ? 0x10000 : this.riderLean + 1638;
        else this.riderLean = this.riderLean + 3276 >= 0x10000 ? 0x10000 : this.riderLean + 3276;
        frameRear.vx = (frameRear.vx + sideX) | 0;
        frameRear.vy = (frameRear.vy + sideY) | 0;
        frameFront.vx = (frameFront.vx - sideX) | 0;
        frameFront.vy = (frameFront.vy - sideY) | 0;
        head.vx = (head.vx + alongX) | 0;
        head.vy = (head.vy + alongY) | 0;
      }
      return;
    }

    // No lean input: the rider settles back to upright.
    if (this.riderLean < 26214) this.riderLean += 3276;
    else if (this.riderLean > 39321) this.riderLean -= 3276;
    else this.riderLean = 32768;
  }

  /** `_newvZ` */
  private isBeforeStart(): boolean {
    return this.at(1, this.current).x < this.terrain.startLineX;
  }

  /** `_longvZ` */
  private isPastFinish(): boolean {
    const finish = this.terrain.finishLineX;
    return this.at(1, this.next).x > finish || this.at(2, this.next).x > finish;
  }

  /**
   * Integrates one tick, cutting the step short wherever a body meets the ground or the finish
   * line is crossed (`_uII`).
   */
  private advance(step: number): Status {
    const wasFinished = this.finished;
    let done = 0;
    let target = step;
    for (;;) {
      if (done >= step) break;
      this.integrate((target - done) | 0);
      // 3 stands for "past the finish line"; otherwise this is a Contact value.
      let outcome: number;
      if (!wasFinished && this.isPastFinish()) outcome = 3;
      else outcome = this.testGround(this.next);

      if (!wasFinished && this.finished) return outcome === 3 ? Status.Finished : Status.FinishedLate;
      if (outcome === Contact.Deep) {
        target = (done + target) >> 1;
        if (abs((target - done) | 0) < MIN_SUB_STEP) return Status.Crashed;
      } else if (outcome === 3) {
        this.finished = true;
        target = (done + target) >> 1;
      } else {
        if (outcome === Contact.Touching) {
          let again: Contact;
          do {
            this.resolveContact(this.next);
            again = this.testGround(this.next);
            if (again === Contact.Deep) return Status.Crashed;
          } while (again !== Contact.None);
        }
        done = target;
        target = step;
        this.current = this.current !== 1 ? 1 : 0;
        this.next = this.next !== 1 ? 1 : 0;
      }
    }

    // The bike breaks when its wheels get too close together or too far apart.
    const front = this.at(1, this.current);
    const rear = this.at(2, this.current);
    const dx = (front.x - rear.x) | 0;
    const dy = (front.y - rear.y) | 0;
    const wheelbaseSquared = (mul(dx, dx) + mul(dy, dy)) | 0;
    if (wheelbaseSquared < 0xf0000) this.broken = true;
    if (wheelbaseSquared > 0x460000) this.broken = true;
    return Status.Riding;
  }

  /** Accumulates the forces acting on every body in the given slot (`_aIV`). */
  private computeForces(slot: number): void {
    for (const body of this.bodies) {
      const state = body.slots[slot] as BodyState;
      state.fx = 0;
      state.fy = 0;
      state.torque = 0;
      state.fy = (state.fy - div(GRAVITY, body.inverseMass)) | 0;
    }

    const b = this.bodies as [Body, Body, Body, Body, Body, Body];
    const s = this.springs as [Spring, Spring, Spring, Spring, Spring, Spring, Spring, Spring, Spring, Spring];
    if (!this.broken) {
      this.applySpring(b[0], s[1], b[2], slot, 0x10000);
      this.applySpring(b[0], s[0], b[1], slot, 0x10000);
      this.applySpring(b[2], s[6], b[4], slot, 0x20000);
      this.applySpring(b[1], s[5], b[3], slot, 0x20000);
    }
    this.applySpring(b[0], s[2], b[3], slot, 0x10000);
    this.applySpring(b[0], s[3], b[4], slot, 0x10000);
    this.applySpring(b[3], s[4], b[4], slot, 0x10000);
    this.applySpring(b[5], s[8], b[3], slot, 0x10000);
    this.applySpring(b[5], s[7], b[4], slot, 0x10000);
    this.applySpring(b[5], s[9], b[0], slot, 0x10000);

    const rear = b[2].slots[slot] as BodyState;
    this.engineTorque = mul(this.engineTorque, 0x10000 - ENGINE_DECAY);
    rear.torque = this.engineTorque;
    const maxSpin = this.tuning.maxSpin;
    if (rear.spin > maxSpin) rear.spin = maxSpin;
    if (rear.spin < -maxSpin) rear.spin = -maxSpin;

    // Bodies moving much faster than the bike as a whole are slowed down.
    let meanVx = 0;
    let meanVy = 0;
    for (const body of this.bodies) {
      const state = body.slots[slot] as BodyState;
      meanVx = (meanVx + state.vx) | 0;
      meanVy = (meanVy + state.vy) | 0;
    }
    meanVx = div(meanVx, 0x60000);
    meanVy = div(meanVy, 0x60000);
    let relativeSpeed = 0;
    for (const body of this.bodies) {
      const state = body.slots[slot] as BodyState;
      const relativeVx = (state.vx - meanVx) | 0;
      const relativeVy = (state.vy - meanVy) | 0;
      relativeSpeed = approxLength(relativeVx, relativeVy);
      if (relativeSpeed > 0x1e0000) {
        const unitX = div(relativeVx, relativeSpeed);
        const unitY = div(relativeVy, relativeSpeed);
        state.vx = (state.vx - unitX) | 0;
        state.vy = (state.vy - unitY) | 0;
      }
    }

    // The sign tells which way the bike is rotating; the magnitude is that of the last body (the head).
    const frame = b[0].slots[slot] as BodyState;
    const side = signStrict((rear.y - frame.y) | 0);
    const direction = signStrict((rear.vx - frame.vx) | 0);
    this.rotation = side * direction > 0 ? relativeSpeed : -relativeSpeed | 0;
  }

  /** `_akkV` */
  private applySpring(bodyA: Body, spring: Spring, bodyB: Body, slot: number, scale: number): void {
    const a = bodyA.slots[slot] as BodyState;
    const b = bodyB.slots[slot] as BodyState;
    let dx = (a.x - b.x) | 0;
    let dy = (a.y - b.y) | 0;
    const length = approxLength(dx, dy);
    if (abs(length) < 3) return;
    dx = div(dx, length);
    dy = div(dy, length);
    const stretch = (length - spring.restLength) | 0;
    let forceX = mul(dx, mul(stretch, spring.stiffness));
    let forceY = mul(dy, mul(stretch, spring.stiffness));
    const relativeVx = (a.vx - b.vx) | 0;
    const relativeVy = (a.vy - b.vy) | 0;
    const damping = mul((mul(dx, relativeVx) + mul(dy, relativeVy)) | 0, spring.damping);
    forceX = (forceX + mul(dx, damping)) | 0;
    forceY = (forceY + mul(dy, damping)) | 0;
    forceX = mul(forceX, scale);
    forceY = mul(forceY, scale);
    a.fx = (a.fx - forceX) | 0;
    a.fy = (a.fy - forceY) | 0;
    b.fx = (b.fx + forceX) | 0;
    b.fy = (b.fy + forceY) | 0;
  }

  /** Writes the change over `step` implied by slot `from` into slot `to` (`_aIIV`). */
  private computeDerivative(from: number, to: number, step: number): void {
    for (const body of this.bodies) {
      const source = body.slots[from] as BodyState;
      const target = body.slots[to] as BodyState;
      target.x = mul(source.vx, step);
      target.y = mul(source.vy, step);
      const scaled = mul(step, body.inverseMass);
      target.vx = mul(source.fx, scaled);
      target.vy = mul(source.fy, scaled);
    }
  }

  /** `target = base + delta / 2`, for position and velocity (`_zIIV`). */
  private addHalf(target: number, base: number, delta: number): void {
    for (const body of this.bodies) {
      const t = body.slots[target] as BodyState;
      const b = body.slots[base] as BodyState;
      const d = body.slots[delta] as BodyState;
      t.x = (b.x + (d.x >> 1)) | 0;
      t.y = (b.y + (d.y >> 1)) | 0;
      t.vx = (b.vx + (d.vx >> 1)) | 0;
      t.vy = (b.vy + (d.vy >> 1)) | 0;
    }
  }

  /** Integrates the current slot over `step` into the next slot (`_aaIV`). */
  private integrate(step: number): void {
    this.computeForces(this.current);
    this.computeDerivative(this.current, SCRATCH_DERIVATIVE_A, step);
    this.addHalf(SCRATCH_MIDPOINT, this.current, SCRATCH_DERIVATIVE_A);
    this.computeForces(SCRATCH_MIDPOINT);
    this.computeDerivative(SCRATCH_MIDPOINT, SCRATCH_DERIVATIVE_B, step >> 1);
    this.addHalf(SCRATCH_MIDPOINT, this.current, SCRATCH_DERIVATIVE_B);
    this.addHalf(this.next, this.current, SCRATCH_DERIVATIVE_A);
    this.addHalf(this.next, this.next, SCRATCH_DERIVATIVE_B);

    // Wheel rotation.
    for (let i = 1; i <= 2; i++) {
      const body = this.bodies[i] as Body;
      const from = body.slots[this.current] as BodyState;
      const to = body.slots[this.next] as BodyState;
      to.angle = (from.angle + mul(step, from.spin)) | 0;
      to.spin = (from.spin + mul(step, mul(body.torqueResponse, from.torque))) | 0;
    }
  }

  /** Tests the wheels, the frame and the head against the ground (`_baII`). */
  private testGround(slot: number): Contact {
    let result: Contact = Contact.None;
    const front = this.at(1, slot);
    const rear = this.at(2, slot);
    const head = this.at(5, slot);
    let rightmost = front.x >= rear.x ? front.x : rear.x;
    rightmost = rightmost >= head.x ? rightmost : head.x;
    let leftmost = front.x >= rear.x ? rear.x : front.x;
    leftmost = leftmost >= head.x ? head.x : leftmost;
    const wheelRadius = BODY_RADII[0];
    this.terrain.setWindow((leftmost - wheelRadius) | 0, (rightmost + wheelRadius) | 0, head.y);

    let dx = (front.x - rear.x) | 0;
    const dy = (front.y - rear.y) | 0;
    const length = approxLength(dx, dy);
    dx = div(dx, length);
    const offsetX = -div(dy, length) | 0;
    const offsetY = dx;

    for (let i = 0; i < this.bodies.length; i++) {
      if (i === 4 || i === 3) continue;
      const body = this.bodies[i] as Body;
      const state = body.slots[slot] as BodyState;
      // The frame is tested one unit towards the underside of the bike.
      if (i === 0) {
        state.x = (state.x + offsetX) | 0;
        state.y = (state.y + offsetY) | 0;
      }
      const contact = this.terrain.collide(state, body.kind);
      if (i === 0) {
        state.x = (state.x - offsetX) | 0;
        state.y = (state.y - offsetY) | 0;
      }
      this.contactNormalX = this.terrain.normalX;
      this.contactNormalY = this.terrain.normalY;
      if (i === 5 && contact !== Contact.None) this.headHit = true;
      if (i === 1 && contact !== Contact.None) this.frontWheelTouched = true;
      if (contact === Contact.Touching) {
        this.contactBody = i;
        result = Contact.Touching;
        continue;
      }
      if (contact !== Contact.Deep) continue;
      this.contactBody = i;
      result = Contact.Deep;
      break;
    }
    return result;
  }

  /** Pushes the touching body out of the ground and reflects its motion (`_caIV`). */
  private resolveContact(slot: number): void {
    const body = this.bodies[this.contactBody] as Body;
    const state = body.slots[slot] as BodyState;
    state.x = (state.x + mul(this.contactNormalX, 3276)) | 0;
    state.y = (state.y + mul(this.contactNormalY, 3276)) | 0;

    const tuning = this.tuning;
    let grip: number;
    let slipFromSurface: number;
    let surfaceFromSpin: number;
    let alongKeep: number;
    let bounce: number;
    if (this.brake && (this.contactBody === 2 || this.contactBody === 1) && state.spin < 6553) {
      grip = GRIP - tuning.brakeGrip;
      slipFromSurface = 13107;
      surfaceFromSpin = 39321;
      alongKeep = 26214 - tuning.brakeGrip;
      bounce = 26214 - tuning.brakeGrip;
    } else {
      grip = GRIP;
      slipFromSurface = SLIP_FROM_SURFACE;
      surfaceFromSpin = SURFACE_FROM_SPIN;
      alongKeep = tuning.bounceA;
      bounce = tuning.bounceB;
    }

    const normalLength = approxLength(this.contactNormalX, this.contactNormalY);
    this.contactNormalX = div(this.contactNormalX, normalLength);
    this.contactNormalY = div(this.contactNormalY, normalLength);
    const nx = this.contactNormalX;
    const ny = this.contactNormalY;
    const vx = state.vx;
    const vy = state.vy;
    const intoSurface = -((mul(vx, nx) + mul(vy, ny)) | 0) | 0;
    const alongSurface = -((mul(vx, -ny | 0) + mul(vy, nx)) | 0) | 0;
    const spin = (mul(grip, state.spin) - mul(slipFromSurface, div(alongSurface, body.radius))) | 0;
    const along = (mul(alongKeep, alongSurface) - mul(surfaceFromSpin, mul(state.spin, body.radius))) | 0;
    const rebound = -mul(bounce, intoSurface) | 0;
    const alongX = mul(-along | 0, -ny | 0);
    const alongY = mul(-along | 0, nx);
    const reboundX = mul(-rebound | 0, nx);
    const reboundY = mul(-rebound | 0, ny);
    state.spin = spin;
    state.vx = (alongX + reboundX) | 0;
    state.vy = (alongY + reboundY) | 0;
  }

  /**
   * Appends the simulation state in a fixed order. The golden traces recorded from the original
   * are hashes of exactly this sequence, so its order must not change.
   */
  writeState(out: number[]): void {
    for (const body of this.bodies) {
      out.push(body.radius, body.kind, body.inverseMass, body.torqueResponse);
      for (const s of body.slots) out.push(s.x, s.y, s.angle, s.vx, s.vy, s.spin, s.fx, s.fy, s.torque);
    }
    out.push(
      this.current,
      this.next,
      this.contactBody,
      this.engineTorque,
      this.contactNormalX,
      this.contactNormalY,
      this.riderLean,
      this.rotation,
      this.broken ? 1 : 0,
      this.headHit ? 1 : 0,
      this.finished ? 1 : 0,
      this.frontWheelTouched ? 1 : 0,
      this.demo ? 1 : 0,
      this.throttle ? 1 : 0,
      this.brake ? 1 : 0,
      this.leanBack ? 1 : 0,
      this.leanForward ? 1 : 0,
      this.terrain.windowStart,
      this.terrain.windowEnd,
      this.terrain.normalX,
      this.terrain.normalY,
    );
  }

  /**
   * Appends what {@link writeState} leaves out but a faithful resume needs: values the original
   * keeps outside the hashed state, and the pending input.
   */
  private writeExtra(out: number[]): void {
    out.push(
      this.terrain.windowStartX,
      this.terrain.windowEndX,
      this.terrain.shadowLeft,
      this.terrain.shadowRight,
      this.terrain.shadowY,
      this.inputThrottle ? 1 : 0,
      this.inputBrake ? 1 : 0,
      this.inputLeanBack ? 1 : 0,
      this.inputLeanForward ? 1 : 0,
    );
  }

  /** Captures everything needed to continue the simulation from this exact point. */
  save(): Int32Array {
    const words: number[] = [];
    this.writeState(words);
    this.writeExtra(words);
    return Int32Array.from(words);
  }

  /** Restores a state captured by {@link save} on a simulation of the same track and league. */
  load(words: Int32Array): void {
    let i = 0;
    const next = () => words[i++] as number;
    const flag = () => next() !== 0;
    for (const body of this.bodies) {
      body.radius = next();
      body.kind = next();
      body.inverseMass = next();
      body.torqueResponse = next();
      for (const s of body.slots) {
        s.x = next();
        s.y = next();
        s.angle = next();
        s.vx = next();
        s.vy = next();
        s.spin = next();
        s.fx = next();
        s.fy = next();
        s.torque = next();
      }
    }
    this.current = next();
    this.next = next();
    this.contactBody = next();
    this.engineTorque = next();
    this.contactNormalX = next();
    this.contactNormalY = next();
    this.riderLean = next();
    this.rotation = next();
    this.broken = flag();
    this.headHit = flag();
    this.finished = flag();
    this.frontWheelTouched = flag();
    this.demo = flag();
    this.throttle = flag();
    this.brake = flag();
    this.leanBack = flag();
    this.leanForward = flag();
    this.terrain.windowStart = next();
    this.terrain.windowEnd = next();
    this.terrain.normalX = next();
    this.terrain.normalY = next();
    this.terrain.windowStartX = next();
    this.terrain.windowEndX = next();
    this.terrain.shadowLeft = next();
    this.terrain.shadowRight = next();
    this.terrain.shadowY = next();
    this.inputThrottle = flag();
    this.inputBrake = flag();
    this.inputLeanBack = flag();
    this.inputLeanForward = flag();
  }
}
