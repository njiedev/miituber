import * as THREE from "three";
import type { HeadRotation } from "./types";

export class UpperBodyFollow {
  private readonly rest: THREE.Quaternion;
  private readonly before = new THREE.Quaternion();
  private readonly after = new THREE.Quaternion();
  private readonly turn = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3(0, 1, 0);
  private readonly euler = new THREE.Euler();
  private yaw = 0;
  private swayPhase = 0;
  private swayAmount = 0;
  private readonly swayAxis = new THREE.Vector3(0, 0, 1);
  private readonly swayTurn = new THREE.Quaternion();

  constructor(
    private readonly chest: THREE.Object3D,
    private readonly headBone: THREE.Object3D,
    private readonly head: THREE.Object3D,
  ) {
    this.rest = chest.quaternion.clone();
  }

  update(rotation: HeadRotation, trackedYaw: number, enabled: boolean, dt: number, intensity = 100, idleSway = false) {
    const strength = normalizeBodyIntensity(intensity) / 100;
    const elapsed = Math.max(0, dt);
    this.swayPhase = (this.swayPhase + elapsed * Math.PI * 2 / 6) % (Math.PI * 2);
    this.swayAmount += ((idleSway ? strength : 0) - this.swayAmount) * (1 - Math.exp(-elapsed / 0.4));
    const target = enabled && Number.isFinite(trackedYaw)
      ? THREE.MathUtils.clamp(trackedYaw * 0.25 * strength, -12 * strength, 12 * strength)
      : 0;
    this.yaw += (target - this.yaw) * (1 - Math.exp(-Math.max(0, dt) / 0.18));
    if (!enabled) this.yaw = 0;

    this.chest.quaternion.copy(this.rest);
    this.headBone.getWorldQuaternion(this.before);
    this.turn.setFromAxisAngle(this.axis, THREE.MathUtils.degToRad(this.yaw));
    this.chest.quaternion.premultiply(this.turn);
    this.swayTurn.setFromAxisAngle(this.swayAxis, THREE.MathUtils.degToRad(Math.sin(this.swayPhase) * 1.5 * this.swayAmount));
    this.chest.quaternion.premultiply(this.swayTurn);
    this.headBone.getWorldQuaternion(this.after);
    this.head.quaternion.setFromEuler(this.euler.set(
      THREE.MathUtils.degToRad(rotation.pitch),
      THREE.MathUtils.degToRad(rotation.yaw),
      THREE.MathUtils.degToRad(rotation.roll),
    ));
    this.head.quaternion.premultiply(this.after.invert().multiply(this.before));
  }
}

export function normalizeBodyIntensity(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? THREE.MathUtils.clamp(value, 0, 200)
    : 100;
}
