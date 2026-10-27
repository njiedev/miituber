import type { MaterialConstructor } from "ffl.js";

/** Lighting styles reproduced by the shader materials bundled with FFL.js. */
export const SHADING_STYLES = ["wiiu", "switch", "miitomo", "3ds", "wii"] as const;

export type ShadingStyle = (typeof SHADING_STYLES)[number];

export const DEFAULT_SHADING_STYLE: ShadingStyle = "wiiu";

export function isShadingStyle(value: unknown): value is ShadingStyle {
  return SHADING_STYLES.includes(value as ShadingStyle);
}

export type ShadingMaterials = {
  /** Material used for the head and body meshes. */
  material: MaterialConstructor;
  /**
   * Material used to draw the face/faceline render textures. The 3DS and Wii
   * shaders have no modulateMode, so they can't draw these textures. The Wii U
   * shader draws them instead and FFL.js converts them to RGBA.
   */
  textureMaterial: MaterialConstructor;
};

/** Lazy-load the material classes for a style, matching how FFL.js is loaded. */
export async function loadShadingMaterials(
  style: ShadingStyle,
): Promise<ShadingMaterials> {
  const { default: FFLShaderMaterial } = await import(
    "ffl.js/materials/FFLShaderMaterial.js"
  );
  const material = await loadStyleMaterial(style, FFLShaderMaterial);
  return {
    material,
    textureMaterial: supportsFflTextures(material) ? material : FFLShaderMaterial,
  };
}

async function loadStyleMaterial(
  style: ShadingStyle,
  fflShaderMaterial: MaterialConstructor,
): Promise<MaterialConstructor> {
  switch (style) {
    case "wiiu":
      return fflShaderMaterial;
    case "switch":
      return (await import("ffl.js/materials/SampleShaderMaterial.js")).default;
    case "miitomo":
      return (await import("ffl.js/materials/LUTShaderMaterial.js")).default;
    case "3ds":
      return (await import("ffl.js/materials/CTRShaderMaterial.js")).default;
    case "wii":
      return (await import("ffl.js/materials/NigaoeShaderMaterial.js")).default;
  }
}

// Same check FFL.js uses internally (matSupportsFFL), which it doesn't export.
function supportsFflTextures(material: MaterialConstructor): boolean {
  return "modulateMode" in material.prototype;
}

/** SampleShaderMaterial (Switch) needs per-Mii colorInfo or it renders unlit. */
export function needsColorInfo(material: MaterialConstructor): boolean {
  return "colorInfo" in material.prototype;
}
