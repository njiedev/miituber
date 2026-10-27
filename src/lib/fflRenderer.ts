import type * as THREE from "three";
import type { CharModel, FFL as FFLContext } from "ffl.js";
import type { ShadingMaterials } from "./shadingStyle";

export type { FFLContext };

/**
 * Share one FFL initialization promise per page. The caller supplies the
 * resource bytes and WASM URL. Load FFL modules when initialization starts.
 */
export type FflInitOptions = {
  /** Raw bytes of AFLResHigh_2_3.dat (user-supplied). */
  resource: ArrayBuffer | Uint8Array;
  /** URL/path the Emscripten module should load `ffl-emscripten.wasm` from. */
  wasmUrl: string;
};

let initPromise: Promise<FFLContext> | null = null;

/**
 * Initialize FFL exactly once. Safe to call repeatedly — subsequent calls
 * return the same in-flight/settled promise. On failure the promise is reset so
 * a later retry (e.g. after the user fixes the .dat path) can run.
 */
export function ensureReady(options: FflInitOptions): Promise<FFLContext> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const [{ FFL }, { default: ModuleFFL }] = await Promise.all([
      import("ffl.js"),
      import("ffl.js/ffl-emscripten.cjs"),
    ]);

    return FFL.initWithResource(
      normalizeResource(options.resource),
      ModuleFFL({ locateFile: () => options.wasmUrl }),
    );
  })().catch((error) => {
    initPromise = null;
    throw error;
  });

  return initPromise;
}

/** Whether FFL init has been kicked off (not necessarily finished). */
export function isInitStarted(): boolean {
  return initPromise !== null;
}

const MAX_STANDARD_EXPRESSION = 18;

/**
 * Prepare standard expressions 0..18 and any extra IDs at model creation.
 * Call dispose() when the model is replaced.
 */
export async function createCharModel(
  ffl: FFLContext,
  miiBytes: Uint8Array,
  renderer: THREE.WebGLRenderer,
  materials: ShadingMaterials,
  extraExpressions: readonly number[] = [],
): Promise<CharModel> {
  const { CharModel, FFLCharModelDescDefault, makeExpressionFlag } =
    await import("ffl.js");

  const standardExpressions = Array.from(
    { length: MAX_STANDARD_EXPRESSION + 1 },
    (_, index) => index,
  );
  const desc = {
    ...FFLCharModelDescDefault,
    allExpressionFlag: makeExpressionFlag([
      ...standardExpressions,
      ...extraExpressions,
    ]),
  };

  // Skip the constructor's renderer argument so the face textures can be drawn
  // with a different material than the meshes (needed for the 3DS/Wii styles).
  const charModel = new CharModel(ffl, miiBytes, desc, materials.material);
  charModel.initTextures(renderer, materials.textureMaterial);
  return charModel;
}

function normalizeResource(resource: ArrayBuffer | Uint8Array): Uint8Array {
  return resource instanceof Uint8Array ? resource : new Uint8Array(resource);
}
