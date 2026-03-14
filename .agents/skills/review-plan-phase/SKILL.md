---
name: review-plan-phase
description: >
  Principal-engineer review workflow for GitGandalf implementation phases driven by
  markdown plan files. Use when auditing whether an implementation fully followed a
  plan, whether the code and architecture match AGENTS.md conventions, whether any
  corners were cut, and whether plans and documentation were updated completely.
  Produces a thorough evidence-based report and stops before remediation until a
  human approves next steps.
argument-hint: 'Describe the plan file, implementation scope, and code changes to review.'
license: Apache-2.0
---

# Review Plan Phase

> **Pipeline position**: `implement` → **`review-plan-phase`** → `plan-phase-remediation`

Use this skill to perform a thorough architecture and implementation review against a
markdown plan file. This is not a lightweight checklist. The goal is to determine
whether the previous agent actually implemented the plan in full, adhered to
repository conventions, and completed all required documentation and plan-tracking
updates.

## Outcome

Produce a principal-engineer review report that:
- compares the implementation against the plan item by item
- identifies where the implementation is complete, partial, incorrect, or missing
- checks adherence to [AGENTS.md](../../../AGENTS.md) and project-specific conventions
- verifies plan status updates and documentation updates were completed everywhere required
- distinguishes solid implementation from placeholder, shallow, or shortcut work
- recommends remediation only as follow-up work after human review

The review must end with a report. Do not begin remediation in the same pass unless a
human explicitly asks for it after seeing the report.

## When To Use

Use this skill for:
- reviewing work completed against a file in `docs/plans/active/` or another repo plan markdown file
- auditing whether an agent skipped implementation details or papered over complexity
- checking whether plan completion was reflected in docs, indexes, and status trackers
- evaluating architecture quality, not just code compilation
- preparing a human decision on whether a phase is actually done

Do not use this skill for:
- writing the implementation from scratch
- making opportunistic cleanups unrelated to the plan
- starting fixes before the audit report is reviewed by a human

## Required Inputs

Before starting, identify:
- the plan file being reviewed
- the code or docs changed for that plan or phase
- any explicit repo rules that apply, especially from [AGENTS.md](../../../AGENTS.md)
- any related supporting docs in `docs/agents/`, `docs/humans/`, `docs/guides/`, and `docs/README.md`

If the scope is ambiguous, ask which plan or phase to audit before proceeding.

## Review Standard

Review as a principal engineer, not as a formatter or style checker.

That means:
- review as if auditing another agent's or engineer's work, not validating your own — assume nothing was done correctly until you have read the evidence
- favor behavioral correctness, architecture fit, and plan fidelity over cosmetic observations
- require evidence for every conclusion
- treat unimplemented plan details as misses even if the code looks reasonable
- treat undocumented architectural deviations as findings, not harmless creativity
- treat incomplete plan bookkeeping and stale docs as real completion failures
- assume that a task is not done until code, tests, plans, and docs all align

## Procedure

0. Establish the actual changed surface.
   Before reading plan items, determine what was implemented in this phase:
   - Check for recent git changes, or explicit completion claims in the plan file (checked boxes, phase-complete notes).
   - List the directories and files most likely touched for this phase using the plan's file inventory as the starting point.
   - Scope the review to what changed — do not audit code that predates this phase.
   - Identify all explicit completion claims so you know exactly what is being validated.

1. Read the governing materials first.
   Read the target plan file, [AGENTS.md](../../../AGENTS.md), and the relevant agent-oriented docs under `docs/agents/` before judging any implementation.

2. Extract concrete obligations from the plan.
   Convert the plan into reviewable obligations such as:
   - files that should exist
   - APIs or behaviors that should be implemented
   - validation, testing, and error-handling expectations
   - architecture decisions that were committed in writing
   - documentation and plan-status updates required to consider the phase complete

3. Inspect the implementation directly.
   Use precise codebase tools (e.g., file readers, directory listings, or grep searches) to review the changed code, config, tests, prompts, scripts, and documentation. Look for:
   - missing files or stubbed sections
   - TODO-driven gaps disguised as completion
   - hard-coded shortcuts that avoid the plan's intended design
   - shallow implementations that satisfy only the happy path
   - mismatches between claimed architecture and actual code structure

4. Check AGENTS.md compliance explicitly.
   Verify at minimum:
   - Bun-only workflows and commands
   - Zod at external boundaries instead of unchecked casts
   - Biome-centric lint and format conventions
   - plan checkboxes and phase status updated where applicable
   - `docs/README.md` updated when plan status changed
   - security constraints were preserved when file or search access is involved

5. Verify implementation depth.
   Ask of each major plan item:
   - Is the real implementation present, or only scaffolding?
   - Are edge cases, validation, and failure modes handled appropriately?
   - Does the code match the stated architecture, or only approximate it?
   - Do tests meaningfully prove the intended behavior?
   - Are docs aligned with the final implementation rather than the intent?

6. Audit completion bookkeeping.
   Review all plan and documentation touchpoints, including:
   - the source plan file
   - `docs/plans/active/`, `docs/plans/implemented/`, and any backlog moves when relevant
   - `docs/README.md`
   - related READMEs in `docs/agents/`, `docs/humans/`, or top-level docs affected by the change

   If a phase is claimed complete but these updates are missing or stale, report that as incomplete completion hygiene.

7. Separate findings by severity and certainty.
   Use clear categories such as:
   - Critical: the implementation materially fails the plan or introduces architectural risk
   - Major: important plan details, conventions, tests, or docs are missing or weak
   - Minor: smaller gaps that should still be closed before calling the phase complete
   - Confirmed strengths: areas implemented correctly and thoroughly

8. Produce the report and stop.
   End with a review report and recommended remediation areas, but do not start editing files until the human confirms which findings should be addressed.

## Evidence Rules

- Cite the exact plan item or requirement behind each finding.
- Cite the exact file or code area that supports the conclusion.
- Do not claim a gap without pointing to what is missing.
- Do not mark an item complete just because a similarly named file exists.
- If evidence is mixed, say it is partial and explain why.

## Decision Rules

- If the plan says a file, behavior, or workflow should exist and it does not, mark it missing.
- If the implementation substitutes a simpler approach than the plan without documenting the deviation, mark it as a gap or unauthorized deviation.
- If AGENTS.md requires a convention and the code violates it, report it even if the code works.
- If tests are absent for a meaningful new behavior, treat that as incomplete implementation unless the plan explicitly excluded tests.
- If docs or plan indexes were supposed to change and did not, do not treat the phase as fully complete.
- If the implementation appears intentionally minimal, verify whether the plan explicitly called for a thin scaffold. If not, treat it as a likely shortcut.

## Completion Checks

Before finishing the review, verify that you have answered all of these:
- Which plan items were implemented correctly?
- Which plan items were partially implemented?
- Which plan items were skipped or contradicted?
- Which AGENTS.md conventions were followed or violated?
- Which tests exist, and do they prove the planned behavior adequately?
- Which docs and plan-tracking files were updated, and which were missed?
- Is the phase actually complete, or only code-complete but not documentation-complete?
- What should be remediated first, after human approval?

## Report Format

Generate a Markdown-formatted audit output structurally identical to this:

### 1. Scope Reviewed
Name the plan, phase, and implementation surface examined.

### 2. Verdict
State whether the work is `✅ Complete`, `⚠️ Partially Complete`, or `❌ Not Complete`.

### 3. Findings
List findings by severity (Critical, Major, Minor) with concrete file paths and evidence.

### 4. What Was Implemented Well
Call out work that genuinely matches the plan and repo standards.

### 5. What Was Missed or Still Needs Work
Be explicit about remaining gaps that block completion.

### 6. Documentation and Plan Status Audit
State whether all affected docs and plan trackers were updated properly.

### 7. Recommended Remediation Areas
Suggest next fixes grouped logically, but stop and wait for human feedback before executing them.

## Preferred Prompts

- Review this phase implementation against `docs/plans/active/...` as a principal engineer and tell me what was actually completed versus skipped.
- Audit whether this agent followed the implementation plan thoroughly or cut corners.
- Compare these code changes to the plan and AGENTS.md, then produce a report before any remediation.
- Verify that this completed phase updated all plans and docs correctly, including `docs/README.md`.
- Perform a deep implementation and architecture review of this plan-driven change, then wait for my approval before fixing anything.