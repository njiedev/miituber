import { describe, expect, it } from "vitest";
import FFLShaderMaterial from "ffl.js/materials/FFLShaderMaterial.js";
import {
  isShadingStyle,
  loadShadingMaterials,
  needsColorInfo,
  SHADING_STYLES,
} from "./shadingStyle";

describe("shading styles", () => {
  it("validates stored style names", () => {
    expect(isShadingStyle("switch")).toBe(true);
    expect(isShadingStyle("gamecube")).toBe(false);
    expect(isShadingStyle(null)).toBe(false);
  });

  it("draws face textures with the style material when it supports them", async () => {
    for (const style of ["wiiu", "switch", "miitomo"] as const) {
      const { material, textureMaterial } = await loadShadingMaterials(style);
      expect(textureMaterial).toBe(material);
    }
  });

  it("falls back to the Wii U material for face textures on 3DS and Wii", async () => {
    for (const style of ["3ds", "wii"] as const) {
      const { material, textureMaterial } = await loadShadingMaterials(style);
      expect(material).not.toBe(FFLShaderMaterial);
      expect(textureMaterial).toBe(FFLShaderMaterial);
    }
  });

  it("only needs colorInfo for the Switch style", async () => {
    for (const style of SHADING_STYLES) {
      const { material } = await loadShadingMaterials(style);
      expect(needsColorInfo(material)).toBe(style === "switch");
    }
  });
});
