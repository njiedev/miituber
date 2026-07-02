// Minimal ambient declarations for the subset of ariankordi/FFL.js we use.
// FFL.js ships JSDoc but no bundled .d.ts, so we declare the surface ourselves.
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

  export class CharModel {
    constructor(
      ffl: FFLContext,
      data: Uint8Array,
      desc: unknown,
      material: unknown,
      renderer: THREE.WebGLRenderer,
    );
    /** Group of meshes to add to a Three.js scene. */
    readonly meshes: THREE.Object3D;
    /** Currently active expression (read-only). */
    readonly expression: number;
    /** Swap the mask/faceline texture to the given FFLExpression value. */
    setExpression(expression: number): void;
    /** Release GPU/textures and detach from the scene. */
    dispose(disposeTargets?: boolean): void;
  }
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
