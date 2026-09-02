// Minimal ambient declarations for the subset of ariankordi/FFL.js used by MiiTuber.
// FFL.js ships JSDoc but no bundled .d.ts, so this file declares the required surface.
// If FFL.js later ships types, delete this file.
declare module "ffl.js" {
  import type * as THREE from "three";

  /** Opaque handle returned by initialization; passed into CharModel. */
  export type FFLContext = unknown;

  export const FFL: {
    /**
     * Initialize FFL with the resource file and an instantiated Emscripten module.
     * @param resource fetch() Response/Promise, ArrayBuffer, or Uint8Array of AFLResHigh_2_3.dat
     * @param module   result of calling the ModuleFFL factory
     */
    initWithResource(
      resource: Promise<Response> | Response | ArrayBuffer | Uint8Array,
      module: unknown,
    ): Promise<FFLContext>;
  };

  /** Describes how a CharModel is built (resolution, enabled expressions, flags). */
  export type FFLCharModelDesc = {
    resolution: number;
    /** Packed bitfield of enabled expressions; build via makeExpressionFlag. */
    allExpressionFlag: Uint32Array;
    modelFlag: number;
  };

  /** Default CharModel description passed to the CharModel constructor. */
  export const FFLCharModelDescDefault: FFLCharModelDesc;

  /**
   * Pack one or more FFLExpression indices into the Uint32Array(3) bitfield
   * expected by FFLCharModelDesc.allExpressionFlag. Each enabled expression
   * gets a mask texture baked when the CharModel is constructed.
   */
  export function makeExpressionFlag(
    expressions: number | number[],
  ): Uint32Array;

  /** Subset of decoded Mii parameters (CharInfo) required for body rendering. */
  export type FFLiCharInfo = {
    /** 0 = male, 1 = female — selects which base body mesh to use. */
    gender: number;
    /** Body weight parameter (0..127); feeds getBodyScale(). */
    build: number;
    /** Body height parameter (0..127); feeds getBodyScale(). */
    height: number;
    /** Packed favorite-color index. */
    favoriteColor: number;
  };

  export class CharModel {
    constructor(
      ffl: FFLContext,
      data: Uint8Array,
      desc: unknown,
      material: unknown,
      renderer: THREE.WebGLRenderer,
    );
    /** Group of meshes to add to a Three.js scene. */
    readonly meshes: THREE.Group;
    /** Currently active expression (read-only). */
    readonly expression: number;
    /** Decoded Mii parameters — drives body gender/scale/shirt color. */
    readonly charInfo: FFLiCharInfo;
    /** Favorite color as a resolved THREE.Color (used for the body shirt). */
    readonly favoriteColor: THREE.Color;
    /** Convenience accessor for charInfo.gender. */
    readonly gender: number;
    /** Non-uniform scale vector for the body model, from build + height. */
    getBodyScale(): { x: number; y: number; z: number };
    /** Swap the mask/faceline texture to the given FFLExpression value. */
    setExpression(expression: number): void;
    /** Release GPU/textures and detach from the scene. */
    dispose(disposeTargets?: boolean): void;
  }

  /** Enum of pants color keys (RedRegular, GrayNormal, GoldSpecial, ...). */
  export const PantsColor: Record<string, number>;
  /** THREE.Color per PantsColor key. */
  export const pantsColors: Record<number, THREE.Color>;

  /** Helpers for turning a CharModel's render-target textures into exportable data. */
  export const ModelTexturesConverter: {
    /**
     * Flatten the CharModel's swizzled modulateMode textures (cap, noseline,
     * glass — R/RG formats) into plain RGBA render targets, baking in color.
     * Must run before convModelTargetsToDataTex when the CharModel was built
     * with an FFL-supporting material (which leaves those textures swizzled),
     * otherwise convModelTargetsToDataTex hits a non-render-target texture.
     * Mutates the meshes in place.
     */
    convModelTexturesToRGBA(
      charModel: CharModel,
      renderer: THREE.WebGLRenderer,
      materialTextureClass: unknown,
    ): void;
    /**
     * Convert every RenderTarget-backed texture in the CharModel's meshes into a
     * THREE.DataTexture so the model can be serialized (e.g. via GLTFExporter).
     * Mutates the meshes in place.
     */
    convModelTargetsToDataTex(
      charModel: CharModel,
      renderer: THREE.WebGLRenderer,
    ): Promise<void>;
  };
}

declare module "ffl.js/ffl-emscripten.cjs" {
  /** Emscripten module factory. Call with { locateFile } to resolve the .wasm. */
  const ModuleFFL: (options?: {
    locateFile?: (path: string, scriptDirectory: string) => string;
  }) => unknown;
  export default ModuleFFL;
}

declare module "ffl.js/materials/FFLShaderMaterial.js" {
  import type * as THREE from "three";
  const FFLShaderMaterial: new (...args: unknown[]) => THREE.Material;
  export default FFLShaderMaterial;
}

declare module "ffl.js/helpers/GeometryConverter.js" {
  import type * as THREE from "three";
  /** Normalizes CharModel geometry (de-interleave, half/SNORM -> Float32) for exporters. */
  const GeometryConverter: {
    normalize(geometry: THREE.BufferGeometry): void;
  };
  export default GeometryConverter;
}

declare module "ffl.js/helpers/BodyUtilities.js" {
  import type * as THREE from "three";
  /** A loaded body GLB plus its scale descriptor and animation state. */
  export type BodyModel = {
    model: THREE.Object3D;
    animations: THREE.AnimationClip[];
    mixer: THREE.AnimationMixer;
    /** Opaque ModelScaleDesc from detectModelDesc(); passed straight back in. */
    scaleDesc: unknown;
  };
  /** Applies shirt/pants colors, the given material, and per-Mii bone scaling. */
  export function prepareBodyForCharModel(
    body: BodyModel,
    material: unknown,
    favoriteColor: THREE.Color,
    bodyScale: { x: number; y: number; z: number },
    pantsColor: THREE.Color,
  ): void;
  /** Parents the head group onto the body's head bone (scales it to match). */
  export function attachHeadToBody(body: BodyModel, head: THREE.Object3D): void;
  /** Disposes a body model's geometry, materials, maps, and skeleton. */
  export function disposeModel(model: THREE.Object3D): void;
}

declare module "ffl.js/helpers/ModelScaleDesc.js" {
  import type * as THREE from "three";
  /** Detects how a body GLB's bones should scale (bone names, behavior flags). */
  export function detectModelDesc(object: THREE.Object3D): unknown;
}

declare module "ffl.js/helpers/SkeletonScalingExtensions.js" {
  import type * as THREE from "three";
  /** Patches THREE.Skeleton with attach()/per-bone scaling. Call once globally. */
  export function addSkeletonScalingExtensions(
    Skeleton: typeof THREE.Skeleton,
  ): void;
}
