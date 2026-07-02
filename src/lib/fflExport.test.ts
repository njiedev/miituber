import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

/**
 * Minimal FileReader polyfill for the Node test env. GLTFExporter uses
 * FileReader (readAsArrayBuffer / readAsDataURL) to finalize buffers; Node 22
 * ships Blob but not FileReader. Only the surface GLTFExporter touches is
 * implemented.
 */
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }

  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      let binary = "";
      for (const byte of new Uint8Array(buffer)) {
        binary += String.fromCharCode(byte);
      }
      const type = blob.type || "application/octet-stream";
      this.result = `data:${type};base64,${btoa(binary)}`;
      this.onloadend?.();
    });
  }
}

beforeAll(() => {
  if (typeof globalThis.FileReader === "undefined") {
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
  }
});
import {
  FFL_MASK_MATERIAL_NAME,
  packNativeOutputPayload,
  prepareMeshesForExport,
  toExportableMaterial,
  type FflNativeExport,
} from "./fflExport";

/**
 * Stand-in for FFLShaderMaterial: a THREE.ShaderMaterial with a name. This is
 * the exact shape that broke native output — GLTFExporter silently drops any
 * ShaderMaterial, so the mask mesh (and its FFLMask name) never reached the GLB.
 */
function fflLikeShaderMaterial(name: string): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    vertexShader: "void main(){ gl_Position = vec4(0.0); }",
    fragmentShader: "void main(){ gl_FragColor = vec4(1.0); }",
  });
  material.name = name;
  return material;
}

function triangleMesh(material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      3,
    ),
  );
  return new THREE.Mesh(geometry, material);
}

describe("toExportableMaterial", () => {
  it("replaces a ShaderMaterial with a non-shader standard material", () => {
    const source = fflLikeShaderMaterial(FFL_MASK_MATERIAL_NAME);
    const result = toExportableMaterial(source);

    expect(result.isMeshStandardMaterial).toBe(true);
    // The crux: it must NOT be a ShaderMaterial, or GLTFExporter drops it.
    expect((result as THREE.Material as { isShaderMaterial?: boolean }).isShaderMaterial).toBeFalsy();
    expect(result.name).toBe(FFL_MASK_MATERIAL_NAME);
  });

  it("preserves the map and constant colour", () => {
    const source = fflLikeShaderMaterial("Head");
    const map = new THREE.DataTexture(new Uint8Array([1, 2, 3, 4]), 1, 1);
    (source as THREE.Material as { map?: THREE.Texture }).map = map;
    (source as THREE.Material as { color?: THREE.Color }).color = new THREE.Color(0.25, 0.5, 0.75);

    const result = toExportableMaterial(source);

    expect(result.map).toBe(map);
    expect(result.color.getHex()).toBe(new THREE.Color(0.25, 0.5, 0.75).getHex());
  });
});

describe("prepareMeshesForExport", () => {
  it("converts every mesh material so none is a ShaderMaterial", () => {
    const root = new THREE.Object3D();
    root.add(triangleMesh(fflLikeShaderMaterial(FFL_MASK_MATERIAL_NAME)));
    root.add(triangleMesh(fflLikeShaderMaterial("Head")));

    prepareMeshesForExport(root);

    const names: string[] = [];
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.Material & { isShaderMaterial?: boolean };
      expect(material.isShaderMaterial).toBeFalsy();
      names.push(material.name);
    });
    expect(names).toContain(FFL_MASK_MATERIAL_NAME);
  });

  it("exports a glTF whose materials include FFL_MASK_MATERIAL_NAME", async () => {
    // End-to-end guard against the native "'FFLMask' not found in GLB" failure:
    // GLTFExporter drops ShaderMaterials, so without prepareMeshesForExport the
    // glTF has zero materials and this assertion fails. (Non-binary export is
    // used so the test needs no DOM FileReader; the material list is identical.)
    const root = new THREE.Object3D();
    root.add(triangleMesh(fflLikeShaderMaterial(FFL_MASK_MATERIAL_NAME)));
    root.add(triangleMesh(fflLikeShaderMaterial("Head")));

    prepareMeshesForExport(root);

    const gltf = (await new GLTFExporter().parseAsync(root, {
      binary: false,
    })) as { materials?: Array<{ name?: string }> };
    const materialNames = (gltf.materials ?? []).map((m) => m.name);

    expect(materialNames).toContain(FFL_MASK_MATERIAL_NAME);
  });
});

describe("packNativeOutputPayload", () => {
  it("round-trips glb + masks in the little-endian container layout", () => {
    const exported: FflNativeExport = {
      glb: new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01]),
      maskTextures: [
        { expression: 3, width: 2, height: 1, rgba: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) },
      ],
    };

    const buffer = packNativeOutputPayload(exported);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    let offset = 0;
    const glbLen = view.getUint32(offset, true);
    offset += 4;
    expect(glbLen).toBe(exported.glb.byteLength);
    expect(Array.from(bytes.subarray(offset, offset + glbLen))).toEqual(
      Array.from(exported.glb),
    );
    offset += glbLen;

    const maskCount = view.getUint32(offset, true);
    offset += 4;
    expect(maskCount).toBe(1);

    expect(view.getUint32(offset, true)).toBe(3); // expression
    expect(view.getUint32(offset + 4, true)).toBe(2); // width
    expect(view.getUint32(offset + 8, true)).toBe(1); // height
    expect(view.getUint32(offset + 12, true)).toBe(8); // rgbaLen
    offset += 16;
    expect(Array.from(bytes.subarray(offset, offset + 8))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
