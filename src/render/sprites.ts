/** The original sprites, loaded from the highest-density set and drawn at their size in dp. */

const SPRITE_SET = '3x';
const SPRITE_DENSITY = 3;

const NAMES = [
  's_helmet',
  's_steering',
  's_wheel1',
  's_wheel2',
  's_engine',
  's_fender',
  's_bluearm',
  's_blueleg',
  's_bluebody',
  's_flag_start0',
  's_flag_start1',
  's_flag_start2',
  's_flag_finish0',
  's_flag_finish1',
  's_flag_finish2',
] as const;

export type SpriteName = (typeof NAMES)[number];

export interface Sprite {
  image: CanvasImageSource;
  /** Size in dp, the unit the scene is laid out in. */
  width: number;
  height: number;
}

export type Sprites = Record<SpriteName, Sprite>;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load ${url}`));
    image.src = url;
  });
}

export async function loadSprites(baseUrl: string): Promise<Sprites> {
  const entries = await Promise.all(
    NAMES.map(async (name) => {
      const image = await loadImage(`${baseUrl}assets/sprites/${SPRITE_SET}/${name}.png`);
      const sprite: Sprite = {
        image,
        width: Math.round(image.naturalWidth / SPRITE_DENSITY),
        height: Math.round(image.naturalHeight / SPRITE_DENSITY),
      };
      return [name, sprite] as const;
    }),
  );
  return Object.fromEntries(entries) as Sprites;
}
