import * as THREE from "three";
import type { CharModel } from "ffl.js";
import { createCharModel, ensureReady } from "../lib/fflRenderer";
import { FFLExpression } from "../lib/types";

const FFL_RESOURCE_URL = "/AFLResHigh_2_3.dat";
const FFL_WASM_URL = "/ffl-emscripten.wasm";
const PORTRAIT_SIZE = 256;

type PortraitFrame = {
  emotion: string;
  frame: "closed" | "open";
  expression: FFLExpression;
};

const PORTRAIT_FRAMES: PortraitFrame[] = [
  { emotion: "normal", frame: "closed", expression: FFLExpression.Normal },
  { emotion: "normal", frame: "open", expression: FFLExpression.OpenMouth },
  { emotion: "happy", frame: "closed", expression: FFLExpression.Smile },
  { emotion: "happy", frame: "open", expression: FFLExpression.Happy },
  { emotion: "surprised", frame: "closed", expression: FFLExpression.Surprise },
  {
    emotion: "surprised",
    frame: "open",
    expression: FFLExpression.SurpriseOpenMouth,
  },
  { emotion: "sad", frame: "closed", expression: FFLExpression.Sorrow },
  { emotion: "sad", frame: "open", expression: FFLExpression.SorrowOpenMouth },
  { emotion: "wink", frame: "closed", expression: FFLExpression.WinkLeft },
  {
    emotion: "wink",
    frame: "open",
    expression: FFLExpression.WinkLeftOpenMouth,
  },
];

export function runPortraitCapture(): void {
  const shell = document.createElement("main");
  shell.style.cssText = [
    "min-height:100vh",
    "display:grid",
    "place-items:center",
    "background:#eceef0",
    "font:14px Segoe UI, system-ui, sans-serif",
    "color:#20242a",
  ].join(";");

  const panel = document.createElement("section");
  panel.style.cssText = [
    "display:grid",
    "gap:12px",
    "padding:20px",
    "border:1px solid #d4d7dc",
    "border-radius:8px",
    "background:#fff",
    "box-shadow:0 8px 24px rgba(20,28,38,.18)",
  ].join(";");

  const title = document.createElement("h1");
  title.textContent = "Tour portrait capture";
  title.style.cssText = "margin:0;font-size:18px";

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".ffsd,.miic,.bin,.dat";

  const status = document.createElement("p");
  status.textContent = "Choose or drop mee.ffsd to download portrait PNGs.";
  status.style.cssText = "margin:0;color:#687078";

  const canvas = document.createElement("canvas");
  canvas.width = PORTRAIT_SIZE;
  canvas.height = PORTRAIT_SIZE;
  canvas.style.cssText =
    "width:256px;height:256px;border:1px solid #d4d7dc;background:transparent";

  panel.append(title, input, status, canvas);
  shell.append(panel);
  document.body.replaceChildren(shell);

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void captureFile(file, canvas, status);
  });

  shell.addEventListener("dragover", (event) => {
    event.preventDefault();
  });
  shell.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file) void captureFile(file, canvas, status);
  });
}

async function captureFile(
  file: File,
  canvas: HTMLCanvasElement,
  status: HTMLElement,
): Promise<void> {
  status.textContent = "Loading FFL and building portrait model...";

  let charModel: CharModel | null = null;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    canvas,
    preserveDrawingBuffer: true,
  });

  try {
    renderer.setPixelRatio(1);
    renderer.setSize(PORTRAIT_SIZE, PORTRAIT_SIZE, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);

    const resource = await (await fetch(FFL_RESOURCE_URL)).arrayBuffer();
    const ffl = await ensureReady({ resource, wasmUrl: FFL_WASM_URL });
    charModel = await createCharModel(
      ffl,
      new Uint8Array(await file.arrayBuffer()),
      renderer,
    );

    const scene = createPortraitScene(charModel);
    const camera = createPortraitCamera(charModel.meshes);

    for (const frame of PORTRAIT_FRAMES) {
      status.textContent = `Rendering portrait-${frame.emotion}-${frame.frame}.png...`;
      charModel.setExpression(frame.expression);
      renderer.clear();
      renderer.render(scene, camera);
      await downloadCanvas(
        canvas,
        `portrait-${frame.emotion}-${frame.frame}.png`,
      );
    }

    status.textContent = "Done. Move the downloaded PNGs into public/tour/.";
  } catch (error) {
    status.textContent = `Portrait capture failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
  } finally {
    charModel?.dispose();
    renderer.dispose();
  }
}

function createPortraitScene(charModel: CharModel): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = null;
  scene.add(charModel.meshes);

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(1.4, 2.1, 2.8);
  scene.add(keyLight);
  scene.add(new THREE.AmbientLight(0xffffff, 1.5));

  return scene;
}

function createPortraitCamera(head: THREE.Object3D): THREE.PerspectiveCamera {
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

async function downloadCanvas(
  canvas: HTMLCanvasElement,
  filename: string,
): Promise<void> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) {
        resolve(value);
      } else {
        reject(new Error("Canvas did not produce a PNG blob."));
      }
    }, "image/png");
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
