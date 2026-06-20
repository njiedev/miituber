---
name: debug-feedback-ledger
description: Prevent repetitive debugging loops by maintaining an explicit attempt-and-feedback ledger. Use when fixing bugs, performance issues, regressions, flaky tests, CI failures, or user-reported problems where Codex tries a solution, receives feedback about whether it worked, and must avoid retrying failed or weakly effective fixes without new evidence.
---

# Debug Feedback Ledger

## Purpose

Use a lightweight feedback ledger to make debugging stateful across turns. The ledger records what was tried, what changed, what the user observed, and what that means for the next attempt.

## Core Rule

Never retry a failed attempt, equivalent attempt, or same-root-cause attempt unless new evidence explains why it should work now. If the next idea resembles a prior failed idea, first state the concrete difference.

## Workflow

1. Before changing code, inspect the current ledger if one exists.
2. If no ledger exists and the issue has already had failed attempts, create one.
3. Summarize the current evidence in one or two lines.
4. Choose one hypothesis that is not contradicted by the ledger.
5. Implement the smallest testable change for that hypothesis.
6. Run local verification.
7. Add an attempt entry before asking the user to retest.
8. When the user reports results, update that attempt with outcome and interpretation before trying anything else.

## Ledger Location

Prefer a repo-local file so future agents can find it:

```text
DEBUG_FEEDBACK_LEDGER.md
```

If the repo already has a handoff or debugging note for the same issue, use that file instead. Do not scatter ledgers across multiple files for the same bug.

## Ledger Format

Use this structure:

```markdown
# Debug Feedback Ledger

## Problem
- Symptom:
- Desired result:
- Current constraints:

## Evidence
- Confirmed:
- Ruled out:
- Unknown:

## Attempts

### Attempt 1: short name
- Hypothesis:
- Change:
- Verification:
- User feedback:
- Outcome: failed | partial | fixed | inconclusive
- Interpretation:
- Do not retry:
- Next direction:
```

Keep entries short. The point is decision memory, not a diary.

## Feedback Classification

Treat user feedback as data:

- `fixed`: the reported symptom is gone under the relevant conditions.
- `partial`: a metric improved but still misses the goal, or one path works while another fails.
- `failed`: the symptom is unchanged or worse.
- `inconclusive`: the test was not comparable, did not run, or produced conflicting signals.

For partial fixes, preserve the useful part and target the remaining bottleneck. Do not throw away progress.

## Anti-Loop Checks

Before each new fix, answer these privately or in the ledger:

- Has this exact change already been tried?
- Has this same mechanism already been tried under a different name?
- Did user feedback rule out this layer of the system?
- Does the new attempt attack the measured bottleneck, not just a plausible bottleneck?
- What observation would make this attempt clearly succeed or fail?

If the answer shows the attempt is a repeat, choose a different hypothesis.

## Using Metrics

When the user provides metrics, copy the key numbers into `Evidence` or the latest attempt. Prefer measured bottlenecks over intuition.

Example:

```markdown
- Confirmed: Capture is ~7ms, publish is ~900ms, so GPU readback is not the current bottleneck.
- Ruled out: OBS ingest as primary cause, because Browser Source and Spout both lag.
```

Then make the next attempt target `publish`, not capture.

## User Retest Prompts

Ask for feedback in a structured way:

```text
Please retest the same scenario and report:
- fixed/partial/failed
- the key metrics
- what looked better or worse
```

Do not ask vague questions like "does it work now?" when metrics matter.

## When Resuming From Another Agent

If a handoff exists, convert the relevant attempted fixes and user results into ledger entries before making new changes. This prevents inherited loops.

If the handoff and the ledger conflict, trust direct user feedback and concrete command output first, then update the ledger.
