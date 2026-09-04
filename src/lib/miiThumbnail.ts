import * as THREE from "three";
import type { CharModel } from "ffl.js";
import { createCharModel, type FFLContext } from "./fflRenderer";
import {
  adjustCameraForBodyHead,
  getFaceCamera,
  type BodyModel,
} from "ffl.js/helpers/BodyUtilities.js";
import { attachBodyToCharModel, type AttachedBody } from "./bodyModel";

/**
 * In-process Mii thumbnail rendering.
 *
 * Renders the full body with the same FFL.js pipeline the live workspace and
 * clean-output window use, on a throwaway transparent offscreen canvas.
 */
const THUMBNAIL_SIZE = 256;

export async function renderMiiThumbnailDataUrl(
  ffl: FFLContext,
  miiBytes: Uint8Array,
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = THUMBNAIL_SIZE;
  canvas.height = THUMBNAIL_SIZE;

  let charModel: CharModel | null = null;
  let attachedBody: AttachedBody | null = null;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    canvas,
    preserveDrawingBuffer: true,
  });

  try {
    renderer.setPixelRatio(1);
    renderer.setSize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, false);
    // Correct colors to sRGB space.
    THREE.ColorManagement.enabled = false;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setClearColor(0x000000, 0);

    charModel = await createCharModel(ffl, miiBytes, renderer);
    attachedBody = await attachBodyToCharModel(charModel);

    const scene = new THREE.Scene();
    scene.background = null;
    scene.add(attachedBody.body.model);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(1.4, 2.1, 2.8);
    scene.add(keyLight);
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));

    const settlingCamera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
    settlingCamera.position.set(0, 10, 80);
    settlingCamera.lookAt(0, 10, 0);
    renderer.render(scene, settlingCamera);

    renderer.render(
      scene,
      createThumbnailCamera(attachedBody.body),
    );
    return canvas.toDataURL("image/png");
  } finally {
    charModel?.dispose();
    if (attachedBody) {
      attachedBody.disposeBodyModel(attachedBody.body.model);
      attachedBody.body.mixer.uncacheRoot(attachedBody.body.model);
    }
    renderer.dispose();
  }
}

function createThumbnailCamera(body: BodyModel) {
  const camera = getFaceCamera();
  camera.fov = 50; // Adjust FOV to look more visually distinct.
  camera.near = 10;
  camera.far = 10000;
  camera.updateProjectionMatrix(); // Apply new FOV.
  // Bring camera back a little bit.
  camera.position.y -= 0.7;
  camera.position.z -= 40;
  adjustCameraForBodyHead(camera, body);

  return camera;
}
