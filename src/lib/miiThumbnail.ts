import * as THREE from "three";
import type { CharModel } from "ffl.js";
import { createCharModel, type FFLContext } from "./fflRenderer";

/**
 * In-process Mii thumbnail rendering.
 *
 * Replaces the Tauri `render_mii_png` command for library/import previews —
 * that command still POSTs to the retired external `127.0.0.1:5000` FFL
 * server, so it fails for every new import. This renders the head with the
 * same FFL.js pipeline the live workspace uses, on a throwaway offscreen
 * canvas (camera framing mirrors src/dev/capturePortraits.ts).
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

    const scene = new THREE.Scene();
    scene.background = null;
    scene.add(charModel.meshes);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(1.4, 2.1, 2.8);
    scene.add(keyLight);
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));

    renderer.render(scene, createThumbnailCamera(charModel.meshes));
    return canvas.toDataURL("image/png");
  } finally {
    charModel?.dispose();
    renderer.dispose();
  }
}

function createThumbnailCamera(head: THREE.Object3D): THREE.PerspectiveCamera {
  head.updateWorldMatrix(true, true);

  const box = new THREE.Box3().setFromObject(head);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
  const fitHeight = Math.max(size.y / 0.8, 0.01);
  const distance =
    fitHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const target = center.clone();
  target.y -= size.y * 0.03;

  camera.position.set(target.x, target.y, center.z + distance);
  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.lookAt(target);
  camera.updateProjectionMatrix();

  return camera;
}
