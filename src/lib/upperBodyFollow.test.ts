import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { UpperBodyFollow, normalizeBodyIntensity } from "./upperBodyFollow";
import { createBodyModelLoader } from "./bodyModel";

const pose = { pitch: 18, yaw: 40, roll: -12 };

async function rig(gender: string) {
  const bytes = readFileSync(`public/body/${gender}.glb`);
  const gltf = await createBodyModelLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "",
  );
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(gltf.animations.find(a => a.name === "Wait")!).play();
  mixer.update(0);
  const chest = gltf.scene.getObjectByName("chest")!;
  const bone = gltf.scene.getObjectByName("head")!;
  const foot = gltf.scene.getObjectByName("foot_l1")!;
  const head = new THREE.Group();
  bone.add(head);
  return { chest, head, foot, follow: new UpperBodyFollow(chest, bone, head) };
}

for (const gender of ["male", "female"]) {
  describe(`${gender} upper-body follow`, () => {
    it("turns the shoulders while preserving the head heading and planted legs", async () => {
      const { chest, head, foot, follow } = await rig(gender);
      follow.update(pose, 40, false, 0);
      const originalHead = head.getWorldQuaternion(new THREE.Quaternion());
      const originalFoot = foot.getWorldQuaternion(new THREE.Quaternion());
      const originalChest = chest.quaternion.clone();
      for (let i = 0; i < 120; i++) follow.update(pose, 40, true, 1 / 60);
      expect(THREE.MathUtils.radToDeg(chest.quaternion.angleTo(originalChest))).toBeCloseTo(10, 2);
      expect(head.getWorldQuaternion(new THREE.Quaternion()).angleTo(originalHead)).toBeLessThan(1e-6);
      expect(foot.getWorldQuaternion(new THREE.Quaternion()).angleTo(originalFoot)).toBeLessThan(1e-6);
      follow.update(pose, 40, false, 0);
      expect(chest.quaternion.angleTo(originalChest)).toBeLessThan(1e-6);
      expect(head.getWorldQuaternion(new THREE.Quaternion()).angleTo(originalHead)).toBeLessThan(1e-6);
    });

    it("smooths both directions, caps the turn and returns to neutral", async () => {
      const { chest, follow } = await rig(gender);
      const rest = chest.quaternion.clone();
      follow.update(pose, 90, true, 1 / 60);
      expect(THREE.MathUtils.radToDeg(chest.quaternion.angleTo(rest))).toBeLessThan(2);
      for (let i = 0; i < 240; i++) follow.update(pose, -90, true, 1 / 60);
      expect(THREE.MathUtils.radToDeg(chest.quaternion.angleTo(rest))).toBeCloseTo(12, 3);
      const delta = chest.quaternion.clone().multiply(rest.clone().invert());
      expect(delta.y).toBeLessThan(0);
      for (let i = 0; i < 240; i++) follow.update(pose, 0, true, 1 / 60);
      expect(chest.quaternion.angleTo(rest)).toBeLessThan(1e-6);
    });
  });
}

it("normalizes saved intensity", () => {
  expect(normalizeBodyIntensity(null)).toBe(100);
  expect(normalizeBodyIntensity(NaN)).toBe(100);
  expect(normalizeBodyIntensity(-1)).toBe(0);
  expect(normalizeBodyIntensity(300)).toBe(200);
});

it("scales movement from zero to double strength", async () => {
  for (const intensity of [0, 50, 100, 200]) {
    const { chest, follow } = await rig("male");
    const rest = chest.quaternion.clone();
    for (let i = 0; i < 240; i++) follow.update(pose, 40, true, 1 / 60, intensity);
    expect(THREE.MathUtils.radToDeg(chest.quaternion.angleTo(rest))).toBeCloseTo(10 * intensity / 100, 3);
  }
});

for (const gender of ["male", "female"]) {
  it(`${gender} sways without tracking and settles when disabled`, async () => {
    const { chest, head, foot, follow } = await rig(gender);
    follow.update(pose, 0, false, 0);
    const rest = chest.quaternion.clone();
    const headRest = head.getWorldQuaternion(new THREE.Quaternion());
    const footRest = foot.getWorldQuaternion(new THREE.Quaternion());
    for (let i = 0; i < 90; i++) follow.update(pose, 0, false, 1 / 60, 100, true);
    expect(THREE.MathUtils.radToDeg(chest.quaternion.angleTo(rest))).toBeGreaterThan(1);
    expect(THREE.MathUtils.radToDeg(chest.quaternion.angleTo(rest))).toBeLessThanOrEqual(1.5);
    expect(head.getWorldQuaternion(new THREE.Quaternion()).angleTo(headRest)).toBeLessThan(1e-6);
    expect(foot.getWorldQuaternion(new THREE.Quaternion()).angleTo(footRest)).toBeLessThan(1e-6);
    for (let i = 0; i < 360; i++) follow.update(pose, 0, false, 1 / 60, 100, false);
    expect(chest.quaternion.angleTo(rest)).toBeLessThan(1e-6);
  });
}
