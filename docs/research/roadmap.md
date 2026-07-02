# MiiTuber Roadmap

Two phases. **Phase 1 is "make the product actually work and feel finished."**
**Phase 2 is "the stuff a first-time shipper doesn't think about until it bites
them"** — legal, distribution, and real-user concerns.

Do Phase 1 first. Don't let Phase 2 items block you from building — but don't
ship publicly until Phase 2 is handled.

---

## Phase 1 — Get to a finished product (features)

Ordered roughly by dependency.

1. **Swap FFL server → FFL.js** (see `prd-ffl-js-swap.md`).
   Self-contained rendering, no external server. This unblocks real shipping.
2. **Resource file handling.** Decide bundle vs. user-supplied for
   `AFLResHigh_2_3.dat`; wire up loading at startup.
3. **Expression coverage pass.** Confirm the MediaPipe → `FFLExpression`
   mapping covers every face you want; fill gaps.
4. **Thumbnails via FFL.js.** Replace `render_mii_png` with an in-webview render.
5. **Native GL output path still works** with the new renderer (OBS Game
   Capture + alpha — this is the #1 priority feature, don't regress it).
6. **Polish the core loop:** import → pick avatar → track → output. Make each
   step's status/errors clear.
7. **Settings persistence** — camera/mic choice, tuning profile, last avatar.
8. **Expression hotkeys (stylized faces).** Enable a few non-physical FFL
   expressions (heart eyes/LOVE 25, CAT 49, MONEY 56, SPIRAL 57, etc.) that the
   webcam can't detect, and bind them to keyboard triggers — a common VTuber
   feature. Depends on the CharModel being built with those expressions enabled
   via makeExpressionFlag. (Separate from the 0-18 face-driven fix.)
9. **Shading/color fidelity tuning** — only AFTER the functional path is solid.

**Phase 1 done =** a stranger can install it, import a Mii, and stream their
face as a transparent avatar into OBS, with no server and no internet.

---

## Phase 2 — Shipping to real users (the non-obvious stuff)

Things that don't show up while you're coding for yourself, but matter the
moment other people run your app.

### Legal & licensing
1. **Apply AGPL-3.0 to the repo.** Add `LICENSE` file (verbatim AGPL text),
   set `"license": "AGPL-3.0-only"` in `package.json`, keep FFL.js's notices
   intact. (No signup — just files. See prior discussion.)
2. **Nintendo IP posture.** MiiTuber renders Miis via reconstructed Nintendo
   tech + Nintendo asset data. Decide:
   - Keep it non-commercial + open-source (safest).
   - **Do NOT redistribute `AFLResHigh_2_3.dat`** if avoidable — have users
     supply their own dump. Removes the clearest asset-redistribution risk.
   - Accept that a takedown is the realistic Nintendo interaction, not a buyout.
3. **Third-party licenses.** MediaPipe, Three.js, Tauri, etc. — bundle a
   credits/licenses list (many licenses require attribution).

### Distribution & trust
4. **Code signing.** Unsigned Windows apps trigger SmartScreen "unknown
   publisher" scary warnings. Decide whether to sign (costs $) or document the
   warning for users.
5. **Installer / auto-update.** How do users get it and get fixes? Tauri
   updater vs. manual downloads.
6. **Release channel.** GitHub Releases is the natural fit for an AGPL project
   (source is right there, satisfies the license too).

### Real-user reality
7. **Error handling for other people's machines.** No webcam, no mic, weird GPU,
   missing `.dat`, permission denials. Fail with a clear message, not a crash.
8. **Privacy statement.** Confirm face-tracking data never leaves the machine
   (with FFL.js, nothing does — that's a selling point; say so).
9. **First-run onboarding.** A stranger doesn't know what an FFSD file is or
   where to get one. Guide them.
10. **Basic docs / README for users** (not just devs): what it is, how to
    install, how to get a Mii in, how to set up OBS.
11. **A way to receive bug reports.** GitHub issues link in-app.

**Phase 2 done =** someone who isn't you can find it, trust the installer, run
it without hitting a wall, and you're not exposed on licensing or IP.
