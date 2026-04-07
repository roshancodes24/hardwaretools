# Safe Cleanup Checklist

Use this checklist for behavior-preserving cleanup and optimization work.

## Goal

Improve maintainability and reduce waste **without changing user-visible behavior**.

## Non-Negotiable Guardrails

- Do not change UI layout, styling, wording, navigation, or flows.
- Do not change validation behavior, API contracts, response shapes, or business logic.
- Do not remove code/files unless usage is proven.
- If unsure whether something is used, keep it and mark as "risky/deferred."

## 1) Start Safely

1. Create a branch:
   - `git checkout -b chore/safe-cleanup-YYYYMMDD`
2. Confirm clean state:
   - `git status --short`
3. Capture baseline checks:
   - `npm run build --prefix frontend`
   - `npm run test:inventory`

## 2) Audit Before Editing

Build a proof matrix with three buckets:

- **Safe remove**: proven unused imports/types/files/artifacts
- **Safe refactor**: duplicate pure logic with equivalent output
- **Risky/deferred**: could affect behavior, timing, ordering, contracts

Audit areas:

- Unused files/imports/types/constants
- Duplicate logic in helpers/components/services
- Generated artifacts accidentally tracked in git
- Redundant state/renders (only if no behavior changes)
- Dependency usage (remove only if fully proven unused)

## 3) Execute in Small Batches

Apply one category at a time:

1. Repo hygiene (generated files, `.gitignore`)
2. Frontend dead-code cleanup
3. Backend dead-code cleanup
4. Low-risk refactors only

Avoid mixing risky performance rewrites with cleanup.

## 4) Verify After Every Batch

Run after each batch:

- `npm run build --prefix frontend`
- `npm run test:inventory`
- Manual smoke on critical flows:
  - product catalog load/create
  - supplier create (including duplicate handling)
  - purchase entry submit
  - stock adjustment submit

If behavior drifts, revert the batch and classify it as risky/deferred.

## 5) Commit Discipline

One focused commit per batch:

- `git add -A`
- `git commit -m "cleanup: <short description>"`

Keep commit messages explicit about "no behavior change."

## 6) Final Validation

Before merge:

- `git status --short` (expect clean)
- `npm run build --prefix frontend`
- `npm run test:inventory`
- Review diff for accidental UI/API behavior edits

## 7) Cleanup Report Template

Include these sections:

1. What changed (by file)
2. Deleted files and reasons
3. Removed dependencies and reasons
4. Risky items intentionally not removed
5. Before/after notes (maintainability/perf/bloat)
6. Verification commands + results

## Common Safe Candidates

- Unused imports and types
- Stale comments/instructions
- Redundant constants where equivalent source already exists
- Generated build/cached artifacts tracked in git

## Common Risky Candidates (Usually Defer)

- Concurrency-sensitive stock/SKU logic
- API status/error shape harmonization
- Schema/model removals that affect migrations/history
- Feature-flagged or role-gated paths with uncertain usage

