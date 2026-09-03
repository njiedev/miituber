import { appendFile, readFile } from "node:fs/promises";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function validateNotes(notes, expectedVersion) {
  if (notes.version !== expectedVersion) {
    throw new Error(
      `Release notes version ${JSON.stringify(notes.version)} does not match app version ${expectedVersion}.`,
    );
  }
  requireString(notes.title, "Release notes title");
  requireString(notes.imageUrl, "Release notes imageUrl");
  if (!Array.isArray(notes.items) || notes.items.length === 0) {
    throw new Error("Release notes items must contain at least one entry.");
  }
  notes.items.forEach((item, index) => {
    requireString(item, `Release notes item ${index + 1}`);
  });
  if (notes.footer !== undefined) {
    requireString(notes.footer, "Release notes footer");
  }
}

function toMarkdown(notes) {
  const sections = [
    `## ${notes.title}`,
    notes.items.map((item) => `- ${item}`).join("\n"),
  ];
  if (notes.footer) sections.push(notes.footer);
  return `${sections.join("\n\n")}\n`;
}

async function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;

  const delimiter = `MIITUBER_${name.toUpperCase()}_EOF`;
  if (value.includes(delimiter)) {
    throw new Error(`Release output ${name} contains the reserved delimiter ${delimiter}.`);
  }
  await appendFile(
    outputPath,
    `${name}<<${delimiter}\n${value}\n${delimiter}\n`,
  );
}

const packageJson = await readJson("package.json");
const tauriConfig = await readJson("src-tauri/tauri.conf.json");
const cargoToml = await readFile("src-tauri/Cargo.toml", "utf8");
const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargoToml)?.[1];
const version = requireString(packageJson.version, "package.json version");

if (!SEMVER_PATTERN.test(version)) {
  throw new Error(`App version ${JSON.stringify(version)} is not valid semantic versioning.`);
}

const versions = {
  "package.json": version,
  "src-tauri/Cargo.toml": cargoVersion,
  "src-tauri/tauri.conf.json": tauriConfig.version,
};
for (const [file, fileVersion] of Object.entries(versions)) {
  if (fileVersion !== version) {
    throw new Error(`${file} has version ${JSON.stringify(fileVersion)}; expected ${version}.`);
  }
}

const notesPath = `release-notes/${version}.json`;
const notes = await readJson(notesPath).catch((error) => {
  throw new Error(`Could not read ${notesPath}: ${error.message}`);
});
validateNotes(notes, version);

const tag = `v${version}`;
if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== tag) {
  throw new Error(
    `Pushed tag ${process.env.GITHUB_REF_NAME} does not match the app version; expected ${tag}.`,
  );
}

const body = toMarkdown(notes);
await writeOutput("tag", tag);
await writeOutput("name", `MiiTuber ${tag}`);
await writeOutput("body", body.trimEnd());

console.log(`Prepared ${tag} from ${notesPath}.`);
if (!process.env.GITHUB_OUTPUT) console.log(`\n${body}`);
