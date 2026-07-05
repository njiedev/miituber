## Delegation policy: optimize for staying under rate limits, not $

I'm on a fixed-cost plan (Claude Pro/Max + Codex CLI). Money isn't the
constraint — my 5-hour and weekly message/token limits are. Every decision
below is about minimizing MY (the orchestrator's) context growth and turn
count, not minimizing spend.

Rule of thumb: if a subtask would burn a lot of tokens *reading* things
(large files, whole codebases, long output, screenshots/computer-use,
iterative trial-and-error) — delegate it. If it's small enough that spawning
a subagent costs more overhead than doing it inline, just do it yourself.

- **Do it yourself (no subagent) when:**
  - The task is a single small edit, a quick lookup, or fits in <2-3 tool calls.
  - Spawning + briefing a subagent would take more of my context than just
    doing the thing.
- **Delegate to a Claude subagent (sonnet-5, effort: low/medium) when:**
  - It's mechanical but needs to stay in the Claude ecosystem (e.g. reading
    through multiple files, running/parsing test output, codebase-wide
    search, drafting boilerplate).
  - It's independent of other in-flight work, so it can run async while I
    keep going on something else.
  - Keep these subagents long-lived across a multi-step subtask (not
    respawned per call) — reuse of context via cache reads is the whole
    point of doing this for usage, not just cost.
- **Delegate to Codex (gpt-5.5 via CLI) when:**
  - The task is large/mechanical implementation, bulk migrations, or
    well-spec'd execution — anything that would otherwise mean me chewing
    through tokens on trial-and-error.
  - Computer-use / UI verification / visual checking — Codex tends to be
    more efficient here and it's off Fable's usage budget entirely.
  - Investigation or data analysis that doesn't fit an existing skill: run
    `codex exec -s read-only` directly with a self-contained prompt.
  - Mechanics: gpt-5.5 is only reachable through the Codex CLI. Since the
    Agent/Workflow `model` parameter only accepts Claude model strings, spawn
    a thin Claude wrapper subagent (`model: 'sonnet', effort: 'low'`) whose
    only job is to: (1) write a self-contained Codex prompt, (2) run
    `codex exec` via Bash, (3) return the result to me. This wrapper should
    barely touch its own context — it's a pass-through, not a collaborator.

- **Never do these yourself if a subagent/Codex can absorb them:**
  - Reading large files or whole directories just to check one thing.
  - Repeated build/test/lint loops — hand the loop to a subagent, ask for a
    final pass/fail + diagnosis, not a play-by-play.
  - Anything requiring more than ~3 rounds of "try, check, retry."

- **Escalate back to me (do it directly) only when:**
  - The subtask genuinely needs my full context/judgment (architecture
    decisions, ambiguous product calls, things touching multiple systems
    at once that a subagent can't see the whole picture of).

- **Reporting back:** subagents and Codex should return a short summary +
  evidence, not their full raw output/transcript — I don't need to re-read
  everything they did, just the result and what to trust.