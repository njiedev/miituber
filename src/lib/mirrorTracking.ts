import type { BlendshapeCategory } from "./types";

export function mirrorBlendshapes(blendshapes: BlendshapeCategory[]): BlendshapeCategory[] {
  return blendshapes.map(({ categoryName, score }) => ({
    categoryName: mirrorBlendshapeName(categoryName),
    score,
  }));
}

function mirrorBlendshapeName(categoryName: string) {
  if (categoryName.endsWith("Left")) return `${categoryName.slice(0, -4)}Right`;
  if (categoryName.endsWith("Right")) return `${categoryName.slice(0, -5)}Left`;
  return categoryName;
}

// Computes S * M * S with S = diag(-1, 1, 1, 1) on a column-major 4x4 matrix.
export function mirrorTransformMatrix(matrix: Float32Array): Float32Array {
  const mirrored = new Float32Array(matrix);
  for (let index = 0; index < 16; index += 1) {
    const row = index % 4;
    const column = Math.floor(index / 4);
    if ((row === 0) !== (column === 0)) mirrored[index] = -mirrored[index];
  }
  return mirrored;
}
