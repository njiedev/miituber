---
name: repo-compat-check
description: Clone a GitHub repo into a scratch dir, evaluate whether it's usable/compatible with MiiTuber, write a report, then delete the clone. Use for "would X repo work for MiiTuber", overnight batch repo research, or evaluating a fork/library candidate before committing to it.
allowed-tools: Task, Bash, Read, Grep, Glob, Write, WebFetch, WebSearch
---

# Repo Compatibility Check: $ARGUMENTS

Evaluate whether the given GitHub repo(s) would work with the MiiTuber project
(Tauri + Rust shell, TypeScript/Three.js webview forked from datkat21/mii-creator,
Go FFL-Testing renderer sidecar, MediaPipe Face Landmarker for blendshapes,
platform-specific virtual camera output). See the miituber-project skill for full context.

Target(s): $ARGUMENTS

## Step 0: Parse input

- Accept one or more repo URLs or `owner/repo` shorthand.
- If more than one repo is given, run Steps 1-4 for each **in parallel** using
  the Task tool (one subagent per repo, general-purpose type). Each subagent
  gets its own scratch dir so clones never collide. Collect their reports and
  merge into one summary at the end (Step 5).

## Step 1: Clone to scratch (per repo)

```bash
SCRATCH="/tmp/repo-check-$(date +%s)-$RANDOM"
mkdir -p "$SCRATCH"
git clone --depth 1 <repo-url> "$SCRATCH/repo"
```

Use `--depth 1` — we only need the current state of the code, not history.
If clone fails (private repo, 404, rate limit), note it and stop for that repo;
don't burn time retrying.

## Step 2: Inventory

Inside `$SCRATCH/repo`:

- Read `README.md`, `LICENSE`, and any `package.json` / `Cargo.toml` / `go.mod`.
- `find . -type f -name "*.ts" -o -name "*.rs" -o -name "*.go" | head -50` to get
  a sense of scale and structure without reading everything.
- Note the license explicitly. Flag anything GPL/AGPL as a licensing concern
  given MiiTuber's "free, open source, hobbyist" posture — not a hard blocker,
  but call it out.

## Step 3: Compatibility evaluation

Answer these directly, don't pad:

1. **What does this repo actually do**, in 2-3 sentences, based on reading code
   not just the README (READMEs oversell).
2. **Which MiiTuber layer would this touch?** (Mii creator/rendering, face
   tracking/blendshapes, Tauri/IPC, virtual camera output, or none.)
3. **Integration effort**: drop-in, adapter needed, or reference-only (read the
   approach, don't use the code)?
4. **Dependency/platform fit**: does it assume a runtime MiiTuber doesn't have
   (browser-only, Node-only, wrong Rust edition, Windows-only when we need
   cross-platform, etc.)?
5. **Is it maintained enough to trust?** Check last commit date and open
   issues count via `git log -1` and a quick look at issues if reachable.
6. **Verdict**: Good fit / Reference only / Not a fit — one line, with the
   single strongest reason.

Don't write a design doc. This is a go/no-go screen, not an implementation plan.

## Step 4: Cleanup — always, even on failure

```bash
rm -rf "$SCRATCH"
```

Run this even if Steps 2-3 failed partway through. Never leave a clone behind.

## Step 5: Report

Append (don't overwrite) to `docs/research/repo-compat-log.md` in the MiiTuber
repo, one entry per repo checked:

```markdown
## <owner/repo> — checked <date>
**Verdict:** <Good fit / Reference only / Not a fit>
<3-6 lines covering Step 3's answers>
```

If this was a multi-repo batch, also print a one-line summary table to chat
(repo, verdict, one reason) so Mohammed can scan it in the morning without
reading the full log.
