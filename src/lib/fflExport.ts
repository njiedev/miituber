import type * as THREE from "three";
import type { CharModel } from "ffl.js";

/**
 * Export a built CharModel into the payload the native GL OBS output window
 * needs (roadmap #5, option 1b).
 *
 * Instead of the old FFL *server* GLB — which baked 19 separate face materials
 * plus a KHR_materials_variants switch — we lean on how FFL.js actually models
 * an expression: `setExpression(n)` just rebinds the face **mask** mesh's
 * texture to `charModel._maskTargets[n].texture` (see ffl.js ~L1662-1687).
 * Everything else (head, hair, body, materials) is identical across
 * expressions. So we export ONE static GLB + the 19 mask textures as raw RGBA,
 * and the native renderer swaps only the mask texture per expression.
 */

export type MaskTexture = {
  /** FFLExpression index this mask corresponds to. */
  expression: number;
  width: number;
  height: number;
  /** Tightly-packed RGBA pixels (width * height * 4). */
  rgba: Uint8Array;
};

export type FflNativeExport = {
  /** Static glTF-binary of the whole avatar (mask mesh carries the NORMAL mask). */
  glb: Uint8Array;
  /** One entry per enabled expression; native side rebinds by index. */
  maskTextures: MaskTexture[];
};

/**
 * Material name stamped on the mask mesh before export. The native renderer
 * finds the face part by this name (material names survive glTF export/import,
 * unlike arbitrary userData), then rebinds its texture per expression.
 */
export const FFL_MASK_MATERIAL_NAME = "FFLMask";

/**
 * FFL.js CharModel private fields we deliberately reach into for export. These
 * are underscore-prefixed internals (not public API), documented here against
 * node_modules/ffl.js/ffl.js so the coupling is explicit.
 */
type CharModelInternals = {
  /** Per-expression mask render targets; null for disabled expressions. (~L1664) */
  _maskTargets: Array<THREE.WebGLRenderTarget | null>;
  /** The mesh whose material.map is the face mask; retextured by setExpression. (~L1673) */
  _maskMesh: THREE.Mesh | null;
};

/**
 * Read every enabled mask texture off the GPU, then serialize the CharModel to
 * a GLB. Requires a live WebGLRenderer (the one that built the CharModel).
 *
 * @param charModel   the built model (expressions must have been enabled)
 * @param renderer    the WebGLRenderer used to build it
 * @param expressions expression indices to export masks for (e.g. 0..18)
 */
export async function exportCharModelForNativeOutput(
  charModel: CharModel,
  renderer: THREE.WebGLRenderer,
  expressions: number[],
): Promise<FflNativeExport> {
  const internals = charModel as unknown as CharModelInternals;

  // 1. Read raw RGBA for each mask BEFORE we mutate the meshes for export.
  const maskTextures: MaskTexture[] = [];
  for (const expression of expressions) {
    const target = internals._maskTargets[expression];
    if (!target) continue; // disabled expression — should not happen for 0..18
    const { width, height } = target;
    const rgba = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, rgba);
    maskTextures.push({ expression, width, height, rgba });
  }

  // 2. Name the mask mesh's material so the native loader can find it in the GLB.
  if (internals._maskMesh) {
    const material = internals._maskMesh.material as THREE.Material;
    material.name = FFL_MASK_MATERIAL_NAME;
  }

  // 3. Convert render-target textures to DataTextures (GLTFExporter can't
  //    serialize RenderTargets) and export the whole model as glTF-binary.
  const [{ ModelTexturesConverter }, { GLTFExporter }] = await Promise.all([
    import("ffl.js"),
    import("three/examples/jsm/exporters/GLTFExporter.js"),
  ]);
  await ModelTexturesConverter.convModelTargetsToDataTex(charModel, renderer);

  const glbBuffer = (await new GLTFExporter().parseAsync(charModel.meshes, {
    binary: true,
  })) as ArrayBuffer;

  return { glb: new Uint8Array(glbBuffer), maskTextures };
}
