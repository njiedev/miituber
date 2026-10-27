import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { CharModel } from "ffl.js";
import type { BodyModel } from "ffl.js/helpers/BodyUtilities.js";
import { needsColorInfo, type ShadingMaterials } from "./shadingStyle";

/** Body GLBs live in public/body/ and are served from the web root. */
export const BODY_MODEL_URLS = ["/body/male.glb", "/body/female.glb"] as const;

export type AttachedBody = {
  body: BodyModel;
  headRoot: THREE.Object3D;
  disposeBodyModel: (model: THREE.Object3D) => void;
};

let bodyTemplatesPromise: Promise<[GLTF, GLTF]> | null = null;
let skeletonExtensionsReady = false;

export function createBodyModelLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

/** Load both body GLB templates once and cache the shared promise. */
export function loadBodyTemplates(
  loader = createBodyModelLoader(),
): Promise<[GLTF, GLTF]> {
  if (!bodyTemplatesPromise) {
    bodyTemplatesPromise = Promise.all([
      loader.loadAsync(BODY_MODEL_URLS[0]),
      loader.loadAsync(BODY_MODEL_URLS[1]),
    ]);
  }
  return bodyTemplatesPromise;
}

export async function attachBodyToCharModel(
  charModel: CharModel,
  materials: ShadingMaterials,
  loader?: GLTFLoader,
): Promise<AttachedBody> {
  const [
    {
      prepareBodyForCharModel,
      attachHeadToBody,
      applyMaterialToGroup,
      disposeModel,
    },
    { detectModelDesc },
    { addSkeletonScalingExtensions },
    { PantsColor, pantsColors },
    { clone: cloneSkinned },
  ] = await Promise.all([
    import("ffl.js/helpers/BodyUtilities.js"),
    import("ffl.js/helpers/ModelScaleDesc.js"),
    import("ffl.js/helpers/SkeletonScalingExtensions.js"),
    import("ffl.js"),
    import("three/examples/jsm/utils/SkeletonUtils.js"),
  ]);

  if (!skeletonExtensionsReady) {
    addSkeletonScalingExtensions(THREE.Skeleton);
    skeletonExtensionsReady = true;
  }

  const templates = await loadBodyTemplates(loader);
  const gender = charModel.charInfo.gender === 1 ? 1 : 0;
  const gltf = templates[gender];

  const model = cloneSkinned(gltf.scene);
  const animations = gltf.animations;
  const mixer = new THREE.AnimationMixer(model);
  const clip = animations.find((a) => a.name === "Wait") ?? animations[0];
  if (clip) mixer.clipAction(clip).play();
  mixer.update(0);

  const body: BodyModel = {
    model,
    animations,
    mixer,
    scaleDesc: detectModelDesc(model),
  };

  const pantsColor = pantsColors[PantsColor.GrayNormal].clone();
  prepareBodyForCharModel(
    body,
    materials.material,
    charModel.favoriteColor,
    charModel.getBodyScale(),
    pantsColor,
  );
  // prepareBodyForCharModel passes no colorInfo (an upstream TODO), which
  // leaves the Switch shader unlit. Reapply it with colorInfo; colors carry
  // over from the old materials. Runs before the head is attached so only the
  // body meshes are touched.
  if (needsColorInfo(materials.material)) {
    applyMaterialToGroup(body.model, materials.material, charModel.getColorInfo());
  }

  const headPivot = new THREE.Group();
  headPivot.name = "head-pivot";
  headPivot.add(charModel.meshes);
  attachHeadToBody(body, headPivot);

  return {
    body,
    headRoot: charModel.meshes,
    disposeBodyModel: disposeModel,
  };
}

export function computeVisualBox(model: THREE.Object3D): THREE.Box3 {
  model.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  const meshBox = new THREE.Box3();
  model.traverse((child) => {
    const mesh = child as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    if (mesh.isSkinnedMesh) {
      mesh.computeBoundingBox();
      if (!mesh.boundingBox) return;
      meshBox.copy(mesh.boundingBox).applyMatrix4(mesh.matrixWorld);
    } else {
      meshBox.setFromObject(mesh);
    }
    box.union(meshBox);
  });
  return box;
}
