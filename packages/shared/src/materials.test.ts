import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILT_IN_FINISHES, FLOOR_FINISHES, TOP_FINISHES, WALL_FINISHES, type Finish } from "./materials";

const FOLDER = join(__dirname, "../../../apps/web/public/materials");

describe("materials", () => {
  it("every textured finish has its colour, normal and roughness maps", () => {
    const all: [string, Finish][] = [WALL_FINISHES, FLOOR_FINISHES, BUILT_IN_FINISHES, TOP_FINISHES].flatMap((o) => Object.entries(o));
    const missing = all
      .filter(([, f]) => f.texture)
      .flatMap(([key, f]) => ["color", "normal", "roughness"].filter((m) => !existsSync(join(FOLDER, f.texture!, `${m}.jpg`))).map((m) => `${key}: ${f.texture}/${m}.jpg`));
    expect(missing).toEqual([]);
  });
});
