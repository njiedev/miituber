import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const DEFAULT_EXPRESSIONS = "0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18";

const inputPath = resolve(process.argv[2] ?? "mee.ffsd");
const outputPath = process.argv[3] ? resolve(process.argv[3]) : null;

const inputBytes = await readFile(inputPath);
const hexData = Buffer.from(inputBytes).toString("hex");
const url = new URL("http://127.0.0.1:5000/miis/image.glb");
url.searchParams.set("data", hexData);
url.searchParams.set("verifyCharInfo", "1");
url.searchParams.set("expression", DEFAULT_EXPRESSIONS);
url.searchParams.set("shaderType", "wiiu");
url.searchParams.set("type", "face");
url.searchParams.set("width", "512");
url.searchParams.set("height", "512");

const response = await fetch(url);
const responseBytes = new Uint8Array(await response.arrayBuffer());

if (!response.ok) {
  throw new Error(
    `Renderer rejected ${basename(inputPath)} with HTTP ${response.status}: ${new TextDecoder().decode(responseBytes)}`,
  );
}

const glb = Buffer.from(responseBytes);
if (glb.toString("ascii", 0, 4) !== "glTF") {
  throw new Error(`Renderer response was not a GLB. First bytes: ${glb.subarray(0, 8).toString("hex")}`);
}

const json = parseGlbJson(glb);
const variants = json.extensions?.KHR_materials_variants?.variants ?? [];
const variantNames = variants.map((variant) => variant.name);
const expectedVariantNames = DEFAULT_EXPRESSIONS.split(",").map(
  (expression) => `Expression_${expression}`,
);
const missingVariants = expectedVariantNames.filter(
  (variantName) => !variantNames.includes(variantName),
);

if (missingVariants.length > 0) {
  throw new Error(`Renderer GLB is missing variants: ${missingVariants.join(", ")}`);
}

let mappingCount = 0;
for (const mesh of json.meshes ?? []) {
  for (const primitive of mesh.primitives ?? []) {
    mappingCount += primitive.extensions?.KHR_materials_variants?.mappings?.length ?? 0;
  }
}

if (mappingCount < expectedVariantNames.length) {
  throw new Error(
    `Renderer GLB has ${mappingCount} material variant mappings, expected at least ${expectedVariantNames.length}`,
  );
}

if (outputPath) {
  await writeFile(outputPath, glb);
}

console.log(
  JSON.stringify(
    {
      input: inputPath,
      inputBytes: inputBytes.length,
      glbBytes: glb.length,
      variantCount: variants.length,
      mappingCount,
      meshCount: json.meshes?.length ?? 0,
      materialCount: json.materials?.length ?? 0,
      output: outputPath,
    },
    null,
    2,
  ),
);

function parseGlbJson(glb) {
  const version = glb.readUInt32LE(4);
  if (version !== 2) {
    throw new Error(`Unsupported GLB version ${version}`);
  }

  const declaredLength = glb.readUInt32LE(8);
  if (declaredLength !== glb.length) {
    throw new Error(`GLB length mismatch: header says ${declaredLength}, got ${glb.length}`);
  }

  let offset = 12;
  while (offset + 8 <= glb.length) {
    const chunkLength = glb.readUInt32LE(offset);
    const chunkType = glb.toString("ascii", offset + 4, offset + 8);
    const chunkStart = offset + 8;

    if (chunkType === "JSON") {
      return JSON.parse(glb.toString("utf8", chunkStart, chunkStart + chunkLength));
    }

    offset = chunkStart + chunkLength;
  }

  throw new Error("GLB did not contain a JSON chunk");
}
