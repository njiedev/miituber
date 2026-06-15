import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { HeadRotation } from "./types";

type VariantMapping = {
  material: number;
  variants: number[];
};

type MeshWithMaterial = THREE.Mesh<
  THREE.BufferGeometry,
  THREE.Material | THREE.Material[]
>;

export type AvatarLoadResult = {
  meshCount: number;
  expressionCount: number;
  size: [number, number, number];
  center: [number, number, number];
  scale: number;
};

export type AvatarSceneCallbacks = {
  onRenderFps?: (fps: number) => void;
};

export type AvatarBackground = {
  color: string;
  transparent: boolean;
};

export function expressionIndexFromVariantName(name: unknown): number | null {
  if (typeof name !== "string") return null;

  const match = /^Expression_(\d+)$/.exec(name);
  if (!match) return null;

  const index = Number(match[1]);
  return Number.isInteger(index) ? index : null;
}

export class AvatarScene {
  private static readonly DEFAULT_BACKGROUND = new THREE.Color(0xe8f0f7);

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly loader = new GLTFLoader();
  private readonly modelRoot = new THREE.Group();
  private readonly controls: OrbitControls;
  private readonly variantMaterials = new Map<number, THREE.Material>();
  private readonly originalMaterials = new Map<MeshWithMaterial, THREE.Material | THREE.Material[]>();
  private readonly debugMaterial = new THREE.MeshNormalMaterial();

  private currentModel: THREE.Object3D | null = null;
  private currentGlbUrl: string | null = null;
  private variantMesh: MeshWithMaterial | null = null;
  private selectedExpression = 0;
  private debugMaterialsEnabled = false;
  private renderFrameCount = 0;
  private lastRenderFpsAt = performance.now();
  private background: AvatarBackground = {
    color: "#e8f0f7",
    transparent: false,
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: AvatarSceneCallbacks = {},
  ) {
    this.scene.background = AvatarScene.DEFAULT_BACKGROUND;
    this.scene.add(this.modelRoot);

    this.camera.position.set(0, 0.05, 3);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      canvas,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(1.8, 2.5, 2.6);
    this.scene.add(keyLight);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.35));

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 6;

    this.resize();
    this.animate();
  }

  async loadModelFromGlbBytes(bytes: number[]): Promise<AvatarLoadResult> {
    this.disposeCurrentModel();
    this.variantMaterials.clear();
    this.originalMaterials.clear();
    this.variantMesh = null;
    this.selectedExpression = 0;

    const blob = new Blob([new Uint8Array(bytes)], { type: "model/gltf-binary" });
    this.currentGlbUrl = URL.createObjectURL(blob);

    const gltf = await this.loader.loadAsync(this.currentGlbUrl);
    this.currentModel = gltf.scene;

    let meshCount = 0;
    this.currentModel.traverse((child) => {
      const mesh = child as MeshWithMaterial;

      if (!mesh.isMesh) return;
      meshCount += 1;
      mesh.frustumCulled = false;
      this.originalMaterials.set(mesh, mesh.material);
    });

    await this.cacheVariantMaterials(gltf);
    const framing = this.frameModel(this.currentModel);
    this.modelRoot.add(this.currentModel);
    this.setExpression(0);

    return {
      meshCount,
      expressionCount: this.variantMaterials.size,
      ...framing,
    };
  }

  setExpression(index: number) {
    this.selectedExpression = index;

    if (!this.variantMesh || this.debugMaterialsEnabled) return;

    const material = this.variantMaterials.get(index);
    if (material) {
      this.variantMesh.material = material;
    }
  }

  setHeadRotation(rotation: HeadRotation) {
    if (!this.currentModel) return;

    this.currentModel.rotation.set(
      THREE.MathUtils.degToRad(rotation.pitch),
      THREE.MathUtils.degToRad(rotation.yaw),
      THREE.MathUtils.degToRad(rotation.roll),
    );
  }

  setDebugMaterials(enabled: boolean) {
    this.debugMaterialsEnabled = enabled;

    if (!this.currentModel) return;

    this.currentModel.traverse((child) => {
      const mesh = child as MeshWithMaterial;

      if (!mesh.isMesh) return;

      mesh.material = enabled
        ? this.debugMaterial
        : this.originalMaterials.get(mesh) ?? mesh.material;
    });

    if (!enabled) {
      this.setExpression(this.selectedExpression);
    }
  }

  setBackground(background: Partial<AvatarBackground>) {
    this.background = {
      ...this.background,
      ...background,
    };

    this.scene.background = this.background.transparent
      ? null
      : new THREE.Color(this.background.color);
    this.renderer.setClearAlpha(this.background.transparent ? 0 : 1);
  }

  setTransparentBackground(enabled: boolean) {
    this.setBackground({ transparent: enabled });
  }

  setBackgroundColor(color: string) {
    this.setBackground({ color });
  }

  async captureJpegFrame(width: number, height: number): Promise<Uint8Array> {
    return this.captureFrame(width, height, "image/jpeg", 0.92);
  }

  async capturePngFrame(width: number, height: number): Promise<Uint8Array> {
    return this.captureFrame(width, height, "image/png");
  }

  private async captureFrame(
    width: number,
    height: number,
    mimeType: "image/jpeg" | "image/png",
    quality?: number,
  ): Promise<Uint8Array> {
    const currentSize = this.renderer.getSize(new THREE.Vector2());
    const currentAspect = this.camera.aspect;
    const currentBackground = this.scene.background;
    const currentClearAlpha = this.renderer.getClearAlpha();

    try {
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();

      if (mimeType === "image/jpeg" && this.background.transparent) {
        // JPEG has no alpha channel. Flatten the OBS stream to the chosen color
        // while keeping PNG snapshots and the preview canvas transparent.
        this.scene.background = new THREE.Color(this.background.color);
        this.renderer.setClearAlpha(1);
      }

      this.controls.update();
      this.renderer.render(this.scene, this.camera);

      const blob = await new Promise<Blob>((resolve, reject) => {
        this.canvas.toBlob((result) => {
          if (result) {
            resolve(result);
          } else {
            reject(new Error("Could not capture output frame from canvas"));
          }
        }, mimeType, quality);
      });

      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      this.renderer.setSize(currentSize.x, currentSize.y, false);
      this.camera.aspect = currentAspect;
      this.camera.updateProjectionMatrix();
      this.scene.background = currentBackground;
      this.renderer.setClearAlpha(currentClearAlpha);
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));

    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private async cacheVariantMaterials(gltf: GLTF) {
    const variantNames = gltf.parser.json.extensions?.KHR_materials_variants?.variants;

    if (!Array.isArray(variantNames)) return;

    const materialPromises: Promise<void>[] = [];

    gltf.scene.traverse((child) => {
      const mesh = child as MeshWithMaterial;
      const mappings = mesh.userData.gltfExtensions?.KHR_materials_variants
        ?.mappings as VariantMapping[] | undefined;

      if (!mesh.isMesh || !Array.isArray(mappings) || mappings.length === 0) return;

      this.variantMesh = mesh;

      for (const mapping of mappings) {
        for (const variantIndex of mapping.variants) {
          const variantName = variantNames[variantIndex]?.name;
          const expressionIndex = expressionIndexFromVariantName(variantName);

          if (expressionIndex === null) continue;

          materialPromises.push(
            gltf.parser.getDependency("material", mapping.material).then((material) => {
              this.variantMaterials.set(expressionIndex, material as THREE.Material);
            }),
          );
        }
      }
    });

    await Promise.all(materialPromises);
  }

  private frameModel(model: THREE.Object3D) {
    model.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxAxis = Math.max(size.x, size.y, size.z) || 1;
    const scale = 1.5 / maxAxis;

    model.scale.setScalar(scale);
    model.position.copy(center).multiplyScalar(-scale);
    model.rotation.set(0, 0, 0);

    this.camera.position.set(0, 0.05, 3);
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    return {
      center: center.toArray() as [number, number, number],
      size: size.toArray() as [number, number, number],
      scale,
    };
  }

  private disposeCurrentModel() {
    if (!this.currentModel) return;

    this.modelRoot.remove(this.currentModel);
    this.currentModel.traverse((child) => {
      const mesh = child as MeshWithMaterial;

      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
    });
    this.currentModel = null;

    if (this.currentGlbUrl) {
      URL.revokeObjectURL(this.currentGlbUrl);
      this.currentGlbUrl = null;
    }
  }

  private animate = () => {
    const now = performance.now();
    this.renderFrameCount += 1;

    if (now - this.lastRenderFpsAt >= 1000) {
      this.callbacks.onRenderFps?.(
        (this.renderFrameCount * 1000) / (now - this.lastRenderFpsAt),
      );
      this.renderFrameCount = 0;
      this.lastRenderFpsAt = now;
    }

    this.resize();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.animate);
  };
}
