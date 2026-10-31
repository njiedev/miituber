# Release notes

Each version has a JSON file used by both the app and the GitHub release workflow. Keep package.json, package-lock.json, Cargo.toml, Cargo.lock, and tauri.conf.json versions aligned. Run npm run release:check before releasing.

For small updates, set presentation to "toast", previousVersion to the preceding release, and items to one short plain-text note. The app shows a nonblocking bottom-left notice after an upgrade, with the actual previously launched version when available. The changed version suffix is green. It fades up, stays for eight seconds, and fades out; hovering or keyboard focus pauses dismissal. The close button dismisses it immediately. Dismissal records the version as seen. Clean capture mode hides the notice.

Omit presentation (or use "modal") for the full release-note dialog. Installation prompts and progress still use the existing updater modal for all releases.

Preview small notes locally at /?test-updates=1 using Small update preview. This preview does not mark notes as seen. What’s New (once) exercises the current version's seen-state behavior; Clear seen version resets it.

The release workflow validates the notes, builds signed updater artifacts, and creates a draft GitHub release. Adding notes or changing the version locally does not publish a release.

The compact notice plays a short synthesized Web Audio chime when it appears. If autoplay is blocked, it can play after an interaction while the notice remains visible. Dismissal cancels any pending sound; no audio plays for a hidden notice or in clean capture mode. The development preview reads the current package version and its release JSON.
