import { BodyIndex } from '../core/physics';
import type { Pose } from '../core/sim';
import { BODY_RADII, type Terrain } from '../core/terrain';
import type { Animator } from './animator';
import type { Sprite, Sprites } from './sprites';

/**
 * Draws the track and the bike. Ported from the drawing halves of `Game/GameView.java`,
 * `Game/Physics.java` and `Levels/Level.java`.
 *
 * Everything is laid out in dp, the density-independent unit of the Android port; the caller
 * scales the canvas. Drawing only reads simulation state, so floating point is fine here.
 */

export interface SceneOptions {
  /** Draw the track with depth. */
  perspective: boolean;
  shadows: boolean;
  /** Draw the rider with sprites rather than lines. */
  driverSprite: boolean;
  /** Draw the bike with sprites rather than lines. */
  bikeSprite: boolean;
  /** Washed-out colours, as behind the menu. */
  dimmed: boolean;
}

export interface Viewport {
  /** Size of the view in dp. */
  width: number;
  height: number;
  /** How far the scene is lifted to clear an on-screen keypad, in dp. */
  lift: number;
}

/** dp per unit of body space, and per unit of track space, which is stored at half scale. */
const BODY_SCALE = 4 / 65536;
const TRACK_SCALE = 8 / 65536;
const ONE = 65536;

// Rider poses: eight points each, as (across the bike, along the bike) offsets from the frame.
// Three postures — leaning back, upright, leaning forward — for the sprite rider and the line rider.
type RiderPose = readonly (readonly [number, number])[];
const SPRITE_RIDER_BACK: RiderPose = [
  [0x2e666, -0x1b333],
  [0x4b333, -0x39999],
  [0x51999, -0x1c000],
  [0x60000, -58982],
  [0x40000, 0x18000],
  [0x10000, -0x1e666],
  [13107, -0x13333],
  [0x46666, 0x14000],
];
const SPRITE_RIDER_UPRIGHT: RiderPose = [
  [0x2cccc, -52428],
  [0x40000, -0x28000],
  [0x63333, -0x10000],
  [0x6cccc, -39321],
  [0x39999, 39321],
  [16384, -0x23333],
  [13107, -0x13333],
  [0x46666, 0x14000],
];
const SPRITE_RIDER_FORWARD: RiderPose = [
  [0x26666, 13107],
  [0x48000, -13107],
  [0x59999, 0x16666],
  [0x63333, 0x2e666],
  [0x54ccc, 0x11999],
  [39321, -0x18000],
  [13107, -52428],
  [0x48000, 0x14000],
];
const LINE_RIDER_BACK: RiderPose = [
  [0x2e666, -0x16666],
  [0x3e666, -0x39999],
  [0x51999, -0x1c000],
  [0x60000, -42598],
  [0x49999, 6553],
  [0x10000, -0x13333],
  [13107, -0x13333],
  [0x46666, 0x14ccc],
];
const LINE_RIDER_UPRIGHT: RiderPose = [
  [0x2cccc, -39321],
  [0x40000, -0x20000],
  [0x60000, -0x10000],
  [0x70000, -39321],
  [0x48000, 6553],
  [16384, -0x23333],
  [13107, -0x13333],
  [0x46666, 0x14ccc],
];
const LINE_RIDER_FORWARD: RiderPose = [
  [0x26666, 13107],
  [0x48000, -13107],
  [0x59999, 0x19999],
  [0x63333, 0x2b333],
  [0x54ccc, 0x11999],
  [39321, -0x18000],
  [13107, -52428],
  [0x46666, 0x14ccc],
];
/** Where along the torso the body sprite sits, per posture (`m_JaaI`). */
const TORSO_ANCHOR = [45875, 32768, 52428] as const;

type Octet = [number, number, number, number, number, number, number, number];

/** The original's cheap vector length (`Physics._doIII`), kept so proportions match. */
function approxLength(x: number, y: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  return (64448 / ONE) * Math.max(ax, ay) + (28224 / ONE) * Math.min(ax, ay);
}

/** Angle of (x, y) measured from the +y axis, in radians (`FPMath._ifIII`). */
function angleOf(x: number, y: number): number {
  if (Math.abs(y) < 3) return ((x <= 0 ? -1 : 1) * Math.PI) / 2;
  const angle = Math.atan(x / y);
  if (x > 0) return y > 0 ? angle : Math.PI + angle;
  return y > 0 ? angle : angle - Math.PI;
}

const toDegrees = (radians: number) => (radians * 180) / Math.PI;

export class SceneRenderer {
  private ctx!: CanvasRenderingContext2D;
  private originX = 0;
  private originY = 0;
  private dimmed = false;

  constructor(private readonly sprites: Sprites) {}

  /**
   * Draws one frame. The context must already be scaled so that one unit is one dp.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    viewport: Viewport,
    terrain: Terrain,
    pose: Pose,
    animator: Animator,
    league: number,
    options: SceneOptions,
    ghost: Pose | null = null,
  ): void {
    this.ctx = ctx;
    this.dimmed = options.dimmed;
    ctx.lineWidth = 1;
    ctx.lineCap = 'butt';

    // GameView.drawGame: centre the camera on the frame, plus the look-ahead offset.
    // The original works in whole dp. Positions stay fractional here: on dense screens a dp is
    // several pixels, and snapping to it makes the scrolling stutter and the bike shake against
    // the ground.
    const cameraX = ((pose.x[BodyIndex.Frame] as number) + animator.lookX) * BODY_SCALE;
    const cameraY = ((pose.y[BodyIndex.Frame] as number) + animator.lookY) * BODY_SCALE;
    this.originX = -cameraX + viewport.width / 2;
    this.originY = cameraY + viewport.height / 2 - viewport.lift;

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    const visibleLeft = -this.originX / 8;
    const visibleRight = (-this.originX + viewport.width) / 8;

    if (options.perspective) this.drawTrackBack(terrain, pose, animator, visibleLeft, visibleRight, options.shadows);
    if (ghost) {
      // The rival of a recorded run: the same bike, faint, behind the player's.
      ctx.globalAlpha = 0.3;
      this.drawBike(ghost, league, options);
      ctx.globalAlpha = 1;
    }
    this.drawBike(pose, league, options);
    this.drawTrackFront(terrain, animator, visibleLeft, visibleRight);
  }

  private drawBike(pose: Pose, league: number, options: SceneOptions): void {
    // Physics._ifiV
    let alongX = (pose.x[3] as number) - (pose.x[4] as number);
    let alongY = (pose.y[3] as number) - (pose.y[4] as number);
    const length = approxLength(alongX, alongY);
    if (length !== 0) {
      alongX /= length;
      alongY /= length;
    }
    const acrossX = -alongY;
    const acrossY = alongX;

    if (options.bikeSprite) this.drawEngineAndFender(pose, alongX, alongY);
    if (!options.dimmed) this.drawWheelSprites(pose, league);
    this.drawWheelDetails(pose, league, options.dimmed);

    if (options.bikeSprite) this.setColor(170, 0, 0);
    else this.setColor(50, 50, 50);
    this.drawFrontMudguard(pose, alongX, alongY);
    if (!pose.broken) {
      this.setColor(128, 128, 128);
      this.bodyLine(pose.x[3] as number, pose.y[3] as number, pose.x[1] as number, pose.y[1] as number);
    }
    this.drawRider(pose, alongX, alongY, acrossX, acrossY, options.driverSprite);
    if (!options.bikeSprite) this.drawLineBike(pose, alongX, alongY, acrossX, acrossY);
  }

  // ---- primitives -------------------------------------------------------------------------

  private screenX(dp: number): number {
    return dp + this.originX;
  }

  private screenY(dp: number): number {
    return -dp + this.originY;
  }

  /** `GameView.setColor`: colours wash out while the menu is over the scene. */
  private setColor(r: number, g: number, b: number): void {
    if (this.dimmed) {
      r = Math.min(240, r + 128);
      g = Math.min(240, g + 128);
      b = Math.min(240, b + 128);
    }
    const color = `rgb(${r},${g},${b})`;
    this.ctx.strokeStyle = color;
    this.ctx.fillStyle = color;
  }

  /** A line between two points given in dp. */
  private line(x1: number, y1: number, x2: number, y2: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(this.screenX(x1), this.screenY(y1));
    ctx.lineTo(this.screenX(x2), this.screenY(y2));
    ctx.stroke();
  }

  /** A line between two points in body space (`GameView.drawLine`). */
  private bodyLine(x1: number, y1: number, x2: number, y2: number): void {
    this.line(x1 * BODY_SCALE, y1 * BODY_SCALE, x2 * BODY_SCALE, y2 * BODY_SCALE);
  }

  /** A line between two points in track space. */
  private trackLine(x1: number, y1: number, x2: number, y2: number): void {
    this.line(x1 * TRACK_SCALE, y1 * TRACK_SCALE, x2 * TRACK_SCALE, y2 * TRACK_SCALE);
  }

  /** An outlined circle centred on a point in dp (`GameView.drawLineWheel`). */
  private circle(x: number, y: number, diameter: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(this.screenX(x), this.screenY(y), diameter / 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** A sprite centred on a point in dp, optionally rotated clockwise by `degrees`. */
  private sprite(sprite: Sprite, x: number, y: number, degrees = 0): void {
    const ctx = this.ctx;
    const cx = this.screenX(x);
    const cy = this.screenY(y);
    if (degrees === 0) {
      ctx.drawImage(sprite.image, cx - sprite.width / 2, cy - sprite.height / 2, sprite.width, sprite.height);
      return;
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((degrees * Math.PI) / 180);
    ctx.drawImage(sprite.image, -sprite.width / 2, -sprite.height / 2, sprite.width, sprite.height);
    ctx.restore();
  }

  // ---- track ------------------------------------------------------------------------------

  private firstVisible(terrain: Terrain, visibleLeft: number): number {
    const points = terrain.points;
    const left = visibleLeft * ONE;
    let index = 0;
    while (index < terrain.pointCount - 1 && (points[index * 2] as number) <= left) index++;
    return index > 0 ? index - 1 : 0;
  }

  private drawFlag(kind: 'start' | 'finish', x: number, y: number, animator: Animator): void {
    const frames = kind === 'start' ? ([2, 0, 1, 0] as const) : ([1, 0, 2, 0] as const);
    const frame = frames[Math.min(3, Math.floor(animator.flagPhase))] as number;
    const name = `s_flag_${kind}${frame}` as 's_flag_start0';
    const flag = this.sprites[name];
    const px = x * TRACK_SCALE;
    const py = y * TRACK_SCALE;
    this.setColor(0, 0, 0);
    this.line(px, py, px, py + 32);
    this.ctx.drawImage(flag.image, this.screenX(px), this.screenY(py) - 32, flag.width, flag.height);
  }

  /** The far edge of the track, the lines joining it to the near edge, and the shadow (`Level._aiIV`). */
  private drawTrackBack(
    terrain: Terrain,
    pose: Pose,
    animator: Animator,
    visibleLeft: number,
    visibleRight: number,
    shadows: boolean,
  ): void {
    const points = terrain.points;
    const count = terrain.pointCount;
    const right = visibleRight * ONE;
    // The far edge leans towards a point high above the bike.
    const eyeX = (pose.x[BodyIndex.Frame] as number) / 2;
    const eyeY = (pose.y[BodyIndex.Frame] as number) / 2 + 0x320000;
    const depth = (index: number): [number, number] => {
      const dx = eyeX - (points[index * 2] as number);
      const dy = eyeY - (points[index * 2 + 1] as number);
      const length = approxLength(dx, dy) / 4;
      return length === 0 ? [0, 0] : [(dx / length) * ONE, (dy / length) * ONE];
    };

    let index = this.firstVisible(terrain, visibleLeft);
    let [nextDx, nextDy] = depth(index);
    this.setColor(0, 170, 0);
    while (index < count - 1) {
      const dx = nextDx;
      const dy = nextDy;
      [nextDx, nextDy] = depth(index + 1);
      const x = points[index * 2] as number;
      const y = points[index * 2 + 1] as number;
      const x2 = points[index * 2 + 2] as number;
      const y2 = points[index * 2 + 3] as number;
      this.trackLine(x + dx, y + dy, x2 + nextDx, y2 + nextDy);
      this.trackLine(x, y, x + dx, y + dy);
      if (terrain.startIndex === index) {
        this.drawFlag('start', x + dx, y + dy, animator);
        this.setColor(0, 170, 0);
      }
      if (terrain.finishIndex === index) {
        this.drawFlag('finish', x + dx, y + dy, animator);
        this.setColor(0, 170, 0);
      }
      if (x > right) break;
      index++;
    }
    const lastX = points[(count - 1) * 2] as number;
    const lastY = points[(count - 1) * 2 + 1] as number;
    this.trackLine(lastX, lastY, lastX + nextDx, lastY + nextDy);

    if (shadows) this.drawShadow(terrain, pose, animator);
  }

  /** The bike's shadow on the track: darker the closer the bike is to the ground (`Level._ifiIV`). */
  private drawShadow(terrain: Terrain, pose: Pose, animator: Animator): void {
    const points = terrain.points;
    const from = animator.shadowFrom;
    const to = animator.shadowTo;
    if (to > terrain.pointCount - 2 || animator.shadowHeight > 0x88000) return;

    const shade = Math.floor((25 * animator.shadowHeight) / ONE);
    this.setColor(shade, shade, shade);
    const px = (i: number) => points[i * 2] as number;
    const py = (i: number) => points[i * 2 + 1] as number;
    const heightAt = (segment: number, x: number) => {
      const slope = (py(segment) - py(segment + 1)) / (px(segment) - px(segment + 1));
      return py(segment) + (x - px(segment)) * slope;
    };
    const left = pose.shadowLeft;
    const right = pose.shadowRight;
    const leftY = heightAt(from, left);
    const rightY = heightAt(to, right);
    // The shadow lies one unit up, on the surface between the near and far edges.
    if (from === to) {
      this.trackLine(left, leftY + ONE, right, rightY + ONE);
      return;
    }
    this.trackLine(left, leftY + ONE, px(from + 1), py(from + 1) + ONE);
    for (let i = from + 1; i < to; i++) this.trackLine(px(i), py(i) + ONE, px(i + 1), py(i + 1) + ONE);
    this.trackLine(px(to), py(to) + ONE, right, rightY + ONE);
  }

  /** The near edge of the track (`Level._aiV`). */
  private drawTrackFront(terrain: Terrain, animator: Animator, visibleLeft: number, visibleRight: number): void {
    const points = terrain.points;
    const count = terrain.pointCount;
    const right = visibleRight * ONE;
    this.setColor(0, 255, 0);
    for (let index = this.firstVisible(terrain, visibleLeft); index < count - 1; index++) {
      const x = points[index * 2] as number;
      const y = points[index * 2 + 1] as number;
      this.trackLine(x, y, points[index * 2 + 2] as number, points[index * 2 + 3] as number);
      if (terrain.startIndex === index) {
        this.drawFlag('start', x, y, animator);
        this.setColor(0, 255, 0);
      }
      if (terrain.finishIndex === index) {
        this.drawFlag('finish', x, y, animator);
        this.setColor(0, 255, 0);
      }
      if (x > right) break;
    }
  }

  // ---- bike -------------------------------------------------------------------------------

  /** `Physics._aiIV` */
  private drawEngineAndFender(pose: Pose, alongX: number, alongY: number): void {
    const frameX = pose.x[0] as number;
    const frameY = pose.y[0] as number;
    const frontX = pose.x[3] as number;
    const frontY = pose.y[3] as number;
    const rearX = pose.x[4] as number;
    const rearY = pose.y[4] as number;
    const engineAngle = angleOf(frameX - frontX, frameY - frontY);
    const fenderAngle = angleOf(frameX - rearX, frameY - rearY);
    const acrossX = -alongY;
    const acrossY = alongX;
    const engineX = (frameX + frontX) / 2 + (acrossX - alongX * 0.5) * ONE;
    const engineY = (frameY + frontY) / 2 + (acrossY - alongY * 0.5) * ONE;
    // The two factors differ in the original; kept as they are.
    const fenderX = (frameX + rearX) / 2 + (acrossX - alongX * (0x1cccc / ONE)) * ONE;
    const fenderY = (frameY + rearY) / 2 + (acrossY - alongY * 2) * ONE;

    let fenderDegrees = toDegrees(fenderAngle) - 180 + 15;
    if (fenderDegrees >= 360) fenderDegrees -= 360;
    this.sprite(this.sprites.s_fender, fenderX * BODY_SCALE, fenderY * BODY_SCALE, fenderDegrees);
    this.sprite(this.sprites.s_engine, engineX * BODY_SCALE, engineY * BODY_SCALE, toDegrees(engineAngle) - 180);
  }

  /** `Physics._aiV`: the smaller leagues ride on the smaller wheel. */
  private drawWheelSprites(pose: Pose, league: number): void {
    const rearSmall = league === 0;
    const frontSmall = league === 0 || league === 1;
    const rear = rearSmall ? this.sprites.s_wheel1 : this.sprites.s_wheel2;
    const front = frontSmall ? this.sprites.s_wheel1 : this.sprites.s_wheel2;
    this.sprite(rear, (pose.x[2] as number) * BODY_SCALE, (pose.y[2] as number) * BODY_SCALE);
    this.sprite(front, (pose.x[1] as number) * BODY_SCALE, (pose.y[1] as number) * BODY_SCALE);
  }

  /** Spokes, the wheel outlines behind the menu and the league-coloured hubs (`Physics._doiV`). */
  private drawWheelDetails(pose: Pose, league: number, dimmed: boolean): void {
    const radius = BODY_RADII[0];
    const spoke = radius * 0.9;
    const frontX = pose.x[1] as number;
    const frontY = pose.y[1] as number;
    const rearX = pose.x[2] as number;
    const rearY = pose.y[2] as number;
    const dp = (value: number) => value * BODY_SCALE;
    const size = (value: number) => Math.floor(value * BODY_SCALE);

    this.setColor(0, 0, 0);
    if (dimmed) {
      this.circle(dp(frontX), dp(frontY), size(radius * 2));
      this.circle(dp(frontX), dp(frontY), size(spoke * 2));
      this.circle(dp(rearX), dp(rearY), size(radius * 2));
      this.circle(dp(rearX), dp(rearY), size(radius * 0.7 * 2));
    }

    const drawSpokes = (x: number, y: number, angle: number) => {
      let dx = Math.cos(angle) * spoke;
      let dy = Math.sin(angle) * spoke;
      const step = 0x141b2 / 65535;
      const cos = Math.cos(step);
      const sin = Math.sin(step);
      for (let i = 0; i < 5; i++) {
        this.bodyLine(x, y, x + dx, y + dy);
        const previous = dx;
        dx = cos * dx - sin * dy;
        dy = sin * previous + cos * dy;
      }
    };
    drawSpokes(frontX, frontY, (pose.angle[1] as number) / 65535);
    // The rear wheel is drawn turning slower than it does, as in the Android port.
    drawSpokes(rearX, rearY, (pose.angle[2] as number) / 1.75 / 65535);

    if (league > 0) {
      if (league > 2) this.setColor(100, 100, 255);
      else this.setColor(255, 0, 0);
      this.circle(rearX * BODY_SCALE, rearY * BODY_SCALE, 4);
      this.circle(frontX * BODY_SCALE, frontY * BODY_SCALE, 4);
    }
  }

  /** The arc over the front wheel (`GameView._ifIIIV`). */
  private drawFrontMudguard(pose: Pose, alongX: number, alongY: number): void {
    const ctx = this.ctx;
    const x = (pose.x[1] as number) * BODY_SCALE;
    const y = (pose.y[1] as number) * BODY_SCALE;
    const radius = Math.floor(BODY_RADII[0] * BODY_SCALE) + 1;
    const start = toDegrees(angleOf(alongX, alongY)) - 170;
    ctx.beginPath();
    ctx.arc(this.screenX(x), this.screenY(y), radius, (start * Math.PI) / 180, ((start - 90) * Math.PI) / 180, true);
    ctx.stroke();
  }

  /** `Physics._ifiIIV` */
  private drawRider(
    pose: Pose,
    alongX: number,
    alongY: number,
    acrossX: number,
    acrossY: number,
    useSprites: boolean,
  ): void {
    const lean = pose.riderLean;
    const back = useSprites ? SPRITE_RIDER_BACK : LINE_RIDER_BACK;
    const upright = useSprites ? SPRITE_RIDER_UPRIGHT : LINE_RIDER_UPRIGHT;
    const forward = useSprites ? SPRITE_RIDER_FORWARD : LINE_RIDER_FORWARD;

    let from: RiderPose = upright;
    let to: RiderPose = upright;
    let blend = 1;
    let posture = 0;
    if (lean < 32768) {
      from = back;
      to = upright;
      blend = (lean * 2) / ONE;
    } else if (lean > 32768) {
      posture = 1;
      from = upright;
      to = forward;
      blend = ((lean - 32768) * 2) / ONE;
    }

    const frameX = pose.x[0] as number;
    const frameY = pose.y[0] as number;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < upright.length; i++) {
      const a = from[i] as readonly [number, number];
      const b = to[i] as readonly [number, number];
      const across = a[0] * (1 - blend) + b[0] * blend;
      const along = a[1] * (1 - blend) + b[1] * blend;
      xs.push((frameX + acrossX * across + alongX * along) * BODY_SCALE);
      ys.push((frameY + acrossY * across + alongY * along) * BODY_SCALE);
    }
    // The eight points, in the order of the pose tables.
    const [hipX, kneeX, shoulderX, headX, handX, footX, pegX, gripX] = xs as Octet;
    const [hipY, kneeY, shoulderY, headY, handY, footY, pegY, gripY] = ys as Octet;

    if (useSprites) {
      const torso =
        ((TORSO_ANCHOR[posture] as number) * (1 - blend) + (TORSO_ANCHOR[posture + 1] as number) * blend) / ONE;
      this.limb(this.sprites.s_blueleg, footX, footY, hipX, hipY, 0.5);
      this.limb(this.sprites.s_blueleg, hipX, hipY, kneeX, kneeY, 0.5);
      this.limb(this.sprites.s_bluebody, kneeX, kneeY, shoulderX, shoulderY, torso);
      this.limb(this.sprites.s_bluearm, shoulderX, shoulderY, handX, handY, 0.5);
      let helmet = angleOf(alongX, alongY);
      if (lean > 32768) helmet += 20588 / 65535;
      let degrees = toDegrees(helmet) - 90 - 10;
      if (degrees >= 360) degrees -= 360;
      if (degrees < 0) degrees += 360;
      this.sprite(this.sprites.s_helmet, headX, headY, degrees);
    } else {
      this.setColor(0, 0, 0);
      this.line(footX, footY, hipX, hipY);
      this.line(hipX, hipY, kneeX, kneeY);
      this.setColor(0, 0, 128);
      this.line(kneeX, kneeY, shoulderX, shoulderY);
      this.line(shoulderX, shoulderY, handX, handY);
      this.line(handX, handY, gripX, gripY);
      this.setColor(156, 0, 0);
      this.circle(headX, headY, 8);
    }
    this.sprite(this.sprites.s_steering, gripX, gripY);
    this.sprite(this.sprites.s_steering, pegX, pegY);
  }

  /** A body-part sprite laid along the line from one joint to the next (`GameView.drawBikerPart`). */
  private limb(sprite: Sprite, x1: number, y1: number, x2: number, y2: number, anchor: number): void {
    const x = x2 * anchor + x1 * (1 - anchor);
    const y = y2 * anchor + y1 * (1 - anchor);
    this.sprite(sprite, x, y, toDegrees(angleOf(x2 - x1, y2 - y1)) - 180);
  }

  /** The bike drawn with lines, for when its sprites are turned off (`Physics._aiIIV`). */
  private drawLineBike(pose: Pose, ax: number, ay: number, cx: number, cy: number): void {
    // a: along the bike, c: across it, both unit vectors; lengths below are in body units.
    const u = ONE;
    const rearX = pose.x[2] as number;
    const rearY = pose.y[2] as number;
    const frameX = pose.x[0] as number;
    const frameY = pose.y[0] as number;
    const frontWheelX = pose.x[1] as number;
    const frontWheelY = pose.y[1] as number;
    const tailX = pose.x[4] as number;
    const tailY = pose.y[4] as number;
    const headX = pose.x[3] as number;
    const headY = pose.y[3] as number;

    const swingAX = rearX + cx * 0.5 * u;
    const swingAY = rearY + cy * 0.5 * u;
    const swingBX = rearX - cx * 0.5 * u;
    const swingBY = rearY - cy * 0.5 * u;
    const noseX = frameX + ax * 0.5 * u;
    const noseY = frameY + ay * 0.5 * u;
    const baseX = noseX - ax * 2 * u;
    const baseY = noseY - ay * 2 * u;
    const seatBaseX = baseX + cx * u;
    const seatBaseY = baseY + cy * u;
    const tankX = baseX + (ax + cx) * 0.75 * u;
    const tankY = baseY + (ay + cy) * 0.75 * u;
    const engineX = baseX + cx * 0.5 * u;
    const engineY = baseY + cy * 0.5 * u;
    const seatX = tailX - ax * 0.75 * u;
    const seatY = tailY - ay * 0.75 * u;
    const seatLowX = seatX - cx * 0.5 * u;
    const seatLowY = seatY - cy * 0.5 * u;
    const tailTipX = seatX - ax * 2 * u + cx * 0.25 * u;
    const tailTipY = seatY - ay * 2 * u + cy * 0.25 * u;
    const barX = headX + cx * 0.5 * u;
    const barY = headY + cy * 0.5 * u;
    const lampX = headX + cx * 1.75 * u - ax * 0.5 * u;
    const lampY = headY + cy * 1.75 * u - ay * 0.5 * u;

    this.setColor(50, 50, 50);
    this.circle(engineX * BODY_SCALE, engineY * BODY_SCALE, 4);
    if (!pose.broken) {
      this.bodyLine(swingAX, swingAY, seatBaseX, seatBaseY);
      this.bodyLine(swingBX, swingBY, baseX, baseY);
    }
    this.bodyLine(noseX, noseY, baseX, baseY);
    this.bodyLine(noseX, noseY, headX, headY);
    this.bodyLine(tankX, tankY, barX, barY);
    this.bodyLine(barX, barY, lampX, lampY);
    if (!pose.broken) {
      this.bodyLine(headX, headY, frontWheelX, frontWheelY);
      this.bodyLine(lampX, lampY, frontWheelX, frontWheelY);
    }
    this.bodyLine(seatBaseX, seatBaseY, seatLowX, seatLowY);
    this.bodyLine(tankX, tankY, seatX, seatY);
    this.bodyLine(seatX, seatY, tailTipX, tailTipY);
    this.bodyLine(seatLowX, seatLowY, tailTipX, tailTipY);
  }
}
