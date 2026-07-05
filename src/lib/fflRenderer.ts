import type * as THREE from "three";
import type { CharModel, FFLContext } from "ffl.js";

export type { FFLContext } from "ffl.js";

/**
 * In-process FFL renderer.
 *
 * Wraps FFL.js initialization behind a single lazy `ensureReady()` promise so
 * the rest of the app never touches the WASM/resource lifecycle directly. This
 * is the seam that replaces the external `127.0.0.1:5000` FFL server.
 *
 * FFL.js (and its Emscripten WASM module) are imported *dynamically* — they load
 * only when FFL is first used, keeping app boot light and keeping this module
 * importable even before the git dependency is installed (so unit tests that
 * touch AvatarScene don't need the WASM package present).
 *
 * The WASM URL and the resource (`AFLResHigh_2_3.dat`) bytes are injected by the
 * caller — that keeps this module agnostic about offline (bundled .wasm + local
 * .dat) vs. dev (CDN .wasm) resolution, which is decided at wiring time.
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

/**
 * Build a CharModel from raw Mii bytes. Requires `ensureReady()` to have
 * resolved first. The returned model's `.meshes` should be added to a scene,
 * and `.dispose()` called when replacing it.
 */
/**
 * Highest standard face-driven expression (FFLExpression 0..18). These are the
 * expressions MediaPipe face-tracking maps onto, so they must all be baked so
 * `setExpression()` never throws ExpressionNotSet at runtime. Stylized extras
 * (heart eyes, cat, etc.) are enabled separately by the hotkey feature.
 */
const MAX_FACE_EXPRESSION = 18;

/**
 * `extraExpressions` opts in stylized extras beyond the face-driven 0..18
 * (e.g. STUNNED 69) — expressions must be baked at CharModel creation or
 * `setExpression()` throws ExpressionNotSet later.
 */
export async function createCharModel(
  ffl: FFLContext,
  miiBytes: Uint8Array,
  renderer: THREE.WebGLRenderer,
  extraExpressions: readonly number[] = [],
): Promise<CharModel> {
  const [
    { CharModel, FFLCharModelDescDefault, makeExpressionFlag },
    { default: FFLShaderMaterial },
  ] = await Promise.all([
    import("ffl.js"),
    import("ffl.js/materials/FFLShaderMaterial.js"),
  ]);

  // Default desc enables only NORMAL (allExpressionFlag [1,0,0]); widen it so
  // every face-driven expression is baked and switchable live.
  const faceExpressions = Array.from(
    { length: MAX_FACE_EXPRESSION + 1 },
    (_, index) => index,
  );
  const desc = {
    ...FFLCharModelDescDefault,
    allExpressionFlag: makeExpressionFlag([
      ...faceExpressions,
      ...extraExpressions,
    ]),
  };

  return new CharModel(ffl, miiBytes, desc, FFLShaderMaterial, renderer);
}

function normalizeResource(resource: ArrayBuffer | Uint8Array): Uint8Array {
  return resource instanceof Uint8Array ? resource : new Uint8Array(resource);
}
