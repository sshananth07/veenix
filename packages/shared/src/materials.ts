/**
 * Finishes a room concept can use (plan 17). `texture` names a CC0 ambientCG folder in apps/web/public/materials/
 * (colour, normal and roughness maps); without one, the finish is drawn from its colour alone. `tile` is how many
 * metres one texture repeat covers, `upright` turns the texture a quarter (planks become vertical slats), and `color`
 * is the fallback, which tinted finishes take from the wall.
 */
export type Finish = { label: string; tile: number; color: string; rough: number; texture?: string; upright?: boolean };

export const WALL_FINISHES = {
  paint: { label: "Paint", tile: 2, color: "#efebe3", rough: 0.92 },
  timber_slats: { label: "Timber slats", tile: 1.2, color: "#a87d55", rough: 0.6, texture: "WoodFloor040", upright: true },
  oak_veneer: { label: "Oak veneer", tile: 1.2, color: "#c9a77c", rough: 0.55, texture: "Wood092" },
  walnut_veneer: { label: "Walnut veneer", tile: 1.2, color: "#6b4a35", rough: 0.55, texture: "Wood051" },
  fabric_panel: { label: "Fabric panel", tile: 0.8, color: "#8f9f7d", rough: 1, texture: "Fabric061" },
  subway_tile: { label: "Subway tile", tile: 0.6, color: "#f4f4f1", rough: 0.25, texture: "Tiles036" },
  large_tile: { label: "Large tile", tile: 1.2, color: "#d9d6cf", rough: 0.3, texture: "Tiles141" },
  terrazzo: { label: "Terrazzo", tile: 1, color: "#e4ded4", rough: 0.35, texture: "Terrazzo013" },
  marble: { label: "Marble", tile: 1.5, color: "#ece9e4", rough: 0.2, texture: "Marble012" },
  concrete: { label: "Concrete", tile: 2, color: "#a7a49f", rough: 0.85, texture: "Concrete034" },
  brick: { label: "Brick", tile: 1, color: "#a2583f", rough: 0.9, texture: "Bricks085" },
  linen_wallpaper: { label: "Linen wallpaper", tile: 0.8, color: "#e8e1d4", rough: 0.95, texture: "Fabric086" },
  stone: { label: "Stone", tile: 1.5, color: "#b9b1a5", rough: 0.8, texture: "Tiles139" },
  mirror: { label: "Mirror", tile: 2, color: "#d8e0e4", rough: 0.05 },
} as const satisfies Record<string, Finish>;

export const FLOOR_FINISHES = {
  light_oak: { label: "Light oak", tile: 2, color: "#c9a77c", rough: 0.8, texture: "WoodFloor051" },
  oak_herringbone: { label: "Oak herringbone", tile: 1.5, color: "#b8915f", rough: 0.75, texture: "WoodFloor034" },
  walnut: { label: "Walnut", tile: 2, color: "#6b4a35", rough: 0.8, texture: "WoodFloor043" },
  white_tile: { label: "White tile", tile: 1.2, color: "#eeece8", rough: 0.35, texture: "Tiles107" },
  grey_tile: { label: "Grey tile", tile: 1.2, color: "#9c9a96", rough: 0.35, texture: "Tiles138" },
  terrazzo: { label: "Terrazzo", tile: 1.5, color: "#e4ded4", rough: 0.35, texture: "Terrazzo013" },
  marble: { label: "Marble", tile: 2, color: "#ece9e4", rough: 0.3, texture: "Marble012" },
  concrete: { label: "Concrete", tile: 2, color: "#a7a49f", rough: 0.85, texture: "Concrete034" },
  carpet: { label: "Carpet", tile: 1, color: "#8c857b", rough: 1, texture: "Carpet016" },
  vinyl_plank: { label: "Vinyl plank", tile: 2, color: "#b49a7a", rough: 0.6, texture: "WoodFloor062" },
} as const satisfies Record<string, Finish>;

export const BUILT_IN_FINISHES = {
  white_laminate: { label: "White laminate", tile: 1, color: "#f3f2ee", rough: 0.5 },
  oak_veneer: { label: "Oak veneer", tile: 1.2, color: "#c9a77c", rough: 0.55, texture: "Wood092" },
  walnut_veneer: { label: "Walnut veneer", tile: 1.2, color: "#6b4a35", rough: 0.55, texture: "Wood051" },
  fluted_oak: { label: "Fluted oak", tile: 0.6, color: "#c29a6b", rough: 0.6, texture: "WoodFloor040", upright: true },
  matte_grey: { label: "Matte grey", tile: 1, color: "#8d9196", rough: 0.7 },
  matte_green: { label: "Matte green", tile: 1, color: "#7d8f74", rough: 0.7 },
  black_metal: { label: "Black metal", tile: 1, color: "#26272a", rough: 0.4 },
  glass: { label: "Glass", tile: 1, color: "#cfe0e6", rough: 0.05 },
  rattan: { label: "Rattan", tile: 0.5, color: "#c7a477", rough: 0.85, texture: "Wicker013" },
  fabric: { label: "Fabric", tile: 0.8, color: "#8f9f7d", rough: 1, texture: "Fabric061" },
} as const satisfies Record<string, Finish>;

export const TOP_FINISHES = {
  quartz_white: { label: "White quartz", tile: 1.5, color: "#f1f0ec", rough: 0.25 },
  marble: { label: "Marble", tile: 1.5, color: "#ece9e4", rough: 0.2, texture: "Marble012" },
  terrazzo: { label: "Terrazzo", tile: 1, color: "#e4ded4", rough: 0.3, texture: "Terrazzo013" },
  oak: { label: "Oak", tile: 1.2, color: "#c9a77c", rough: 0.5, texture: "Wood092" },
  concrete: { label: "Concrete", tile: 2, color: "#a7a49f", rough: 0.7, texture: "Concrete034" },
  stainless: { label: "Stainless steel", tile: 1, color: "#c4c7ca", rough: 0.3 },
} as const satisfies Record<string, Finish>;

export type WallFinish = keyof typeof WALL_FINISHES;
export type FloorFinish = keyof typeof FLOOR_FINISHES;
export type BuiltInFinish = keyof typeof BUILT_IN_FINISHES;
export type TopFinish = keyof typeof TOP_FINISHES;

const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
export const WALL_FINISH_KEYS = keys(WALL_FINISHES);
export const FLOOR_FINISH_KEYS = keys(FLOOR_FINISHES);
export const BUILT_IN_FINISH_KEYS = keys(BUILT_IN_FINISHES);
export const TOP_FINISH_KEYS = keys(TOP_FINISHES);

/** Wall finishes the wall's colour tints; the rest keep their own colour. */
export const TINTED_FINISHES: readonly WallFinish[] = ["paint", "fabric_panel", "linen_wallpaper"];
/** Built-in finishes the built-in's colour tints. */
export const TINTED_BUILT_INS: readonly BuiltInFinish[] = ["fabric"];
