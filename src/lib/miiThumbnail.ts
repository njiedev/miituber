import * as THREE from "three";
import type { CharModel } from "ffl.js";
import { createCharModel, type FFLContext } from "./fflRenderer";
import {
  attachBodyToCharModel,
  computeVisualBox,
  type AttachedBody,
} from "./bodyModel";

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
    renderer.outputColorSpace = THREE.SRGBColorSpace;
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
      createThumbnaiclCamera(attachedBody.headRoot, attachedBody.body.model),
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

function createThumbnaiclCamera(
  head: THREE.Object3D,
  body: THREE.Object3D,
): THREE.PerspectiveCamera {
  head.updateWorldMatrix(true, true);
  body.updateWorldMatrix(true, true);

  const headBox = computeVisualBox(head);
  const bodyBox = computeVisualBox(body);
  const headCenter = new THREE.Vector3();
  const headSize = new THREE.Vector3();
  const bodySize = new THREE.Vector3();
  headBox.getCenter(headCenter);
  headBox.getSize(headSize);
  bodyBox.getSize(bodySize);

  const shoulderDepth = Math.max(headSize.y * 0.12, bodySize.y * 0.03);
  const topMargin = headSize.y * 0.05;
  const bottom = Math.max(bodyBox.min.y, headBox.min.y - shoulderDepth);
  const box = new THREE.Box3(
    new THREE.Vector3(headBox.min.x, bottom, headBox.min.z),
    new THREE.Vector3(headBox.max.x, headBox.max.y + topMargin, headBox.max.z),
  );
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const fitHeight = size.y / 2 / tan;
  const fitWidth = size.x / 2 / tan;
  const distance = Math.max(fitHeight, fitWidth, 0.01) * 1.02;
  const target = center.clone();
  target.x = headCenter.x;

  camera.position.set(target.x, target.y, center.z + distance);
  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.lookAt(target);
  camera.updateProjectionMatrix();

  return camera;
}
