# Release Engineering

How MiiTuber is versioned, built, signed, and shipped to users. This is
**release engineering** — it uses **VCS** (git tags) and **CI/CD** (the
`.github/workflows/release.yml` pipeline) as its tools.

## Mental model (read once, internalize)

Two independent axes — never weld them together:

- **Branch** = *where I'm working*. Just `main` for now. Short-lived feature
  branches (`body-rendering`, `auto-updater`) when a chunk is risky; merge
  back and delete.
- **Tag** = *what I've released*. A `v*` tag is the deliberate "cut a release"
  act. Users run **the last tag**, not whatever is on `main`.

Consequences:
- A normal commit ships nothing. Only pushing a `v*` tag triggers a release.
- `main` can keep moving after launch without endangering released users —
  their stable anchor is the tag, not the branch.
- Adopt a permanent `develop` branch **only** once `main` needs to mean "live"
  and you're building next features while `main` stays frozen. Not before.

## Versioning (SemVer)

`MAJOR.MINOR.PATCH`:
- **PATCH** (0.1.0 → 0.1.1) — bug fixes only, nothing breaks.
- **MINOR** (0.1.0 → 0.2.0) — new features, backward-compatible.
- **MAJOR** (0.1.0 → 1.0.0) — you broke something users relied on.

While pre-`1.0`, the API is unstable by definition — breaking between minors is
allowed. Don't rush to `1.0`; it's a promise of stability.

The git tag (`v0.2.0`) and the config version (`0.2.0`) must always agree.

---

## One-time setup (do before the FIRST public build)

The updater is a tripwire compiled INTO the binary. The build users first
install can only auto-update if that build already had the updater in it. So
these must all be done before the first release that reaches real users.

### 1. Generate the updater keypair (ONCE, ever — then protect forever)

Run in your OWN terminal (never let the private key flow through logs/chat):

```bash
npx tauri signer generate -w ~/.tauri/miituber.key
```

- Prompts for a password → pick one, remember it (it encrypts the key file).
- Writes the **private key** to `~/.tauri/miituber.key` (outside the repo).
- Prints the **public key** → save it for `tauri.conf.json`.

| Output | Goes where | Secret? |
|---|---|---|
| Private key file contents | GitHub secret `TAURI_SIGNING_PRIVATE_KEY` | NEVER commit/share |
| Password you chose | GitHub secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | NEVER commit |
| Public key (printed) | `tauri.conf.json` updater config | Safe, public |

Back up the private key + password in a password manager. Lose it and you can
NEVER ship trusted updates to existing users. Regenerating breaks auto-update
for everyone already installed (their baked-in public key won't match).

### 2. Add the two GitHub secrets

`github.com/njiedev/miituber` → Settings → Secrets and variables → Actions →
New repository secret. Add both from the table above. Secrets are write-only;
the workflow references them by name.

### 3. Wire the in-app updater (must ship in the first public build)

- Install `@tauri-apps/plugin-updater` (JS) + the Rust crate.
- Add updater config to `tauri.conf.json`: the **public key** + endpoint URL
  pointing at the GitHub Releases `latest.json`.
- Add the updater permission to `src-tauri/capabilities/default.json`.
- Add startup "check for update → prompt → install → relaunch" logic.

How it works: on launch the app fetches `latest.json`, compares its version to
the running one, and if newer, downloads the bundle and verifies its
**signature** (made by your private key at build time) against the **public
key** baked into the app. GitHub Releases hosts `latest.json` — no backend to
run. `tauri-action` generates and attaches it.

---

## Cutting a release (the repeatable ritual)

On `main`, when you've reached a run-worthy state:

```bash
# 1. Bump version in BOTH files (must match):
#    - package.json            "version": "0.2.0"
#    - src-tauri/tauri.conf.json "version": "0.2.0"
git commit -am "Release v0.2.0"

# 2. Stamp THIS commit as the release and push the tag:
git tag v0.2.0
git push origin main --tags
```

The tag push triggers `.github/workflows/release.yml`, which:
- builds Windows + macOS bundles in parallel,
- signs them with your key,
- creates a **draft** GitHub Release with installers + `latest.json` attached.

Then: open the repo's Releases page → review notes → **Publish**. Draft means
nothing is public until you click Publish (your safety gate).

## Build locally (no release)

```bash
npm run tauri build
```

Outputs in `src-tauri/target/release/bundle/` (Windows: `nsis/*-setup.exe`,
`msi/*.msi`). Note: Tauri does NOT cross-compile — build the Windows installer
on Windows, the `.dmg` on macOS. That's what the CI matrix is for.

---

## Deferred (not blocking launch)

- **OS code-signing** (Microsoft publisher cert) — removes the SmartScreen
  "unknown publisher" warning. Costs money, optional, orthogonal to
  auto-update. Until then, document "click More info → Run anyway" in README.
- **Permanent `develop` branch** — adopt only when `main` must mean "live"
  while you build ahead. Post-launch concern.
- **CI workflow** (test + build on every push) — separate from release; the
  safety net for the Mac-dev / Windows-user gap. Worth adding soon.

## Status checklist

- [ ] 1. Generate updater keypair
- [ ] 2. Add GitHub signing secrets
- [ ] 3. Wire in-app updater plugin
- [ ] 4. Cut + test first signed release `v0.2.0` (verify auto-update BEFORE launch)
