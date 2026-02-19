## Astro Islands Readiness Spec (Solid-first)

### Status
- Date: 2026-02-19
- Scope: Prepare current Solid app for future Astro client islands without changing runtime behavior.
- Out of scope: Introducing Astro, routing changes, new UX, or new feature work.
- Baseline complete: local Solid UI components are split and wired through props in `src/App.tsx`.

---

## Goals
- Keep all current behavior, validation, persistence, and file-processing logic intact.
- Establish stable component contracts that can later become Astro island boundaries.

## Non-goals
- No Astro integration in this phase.
- No shared cross-island store in this phase.
- No design-system rework beyond existing classes.

---

## Current baseline
`App` currently keeps orchestration/stateful logic (uploads, parsing, merges, persistence, export), while primary rendering sections are split into focused local components (`UploadPanel`, `IssuesPanel`, `StagedTable`, `TableActions`).

This gives a stable pre-islands shape and reduces future migration risk.

---

## Target component structure (this phase)
Keep all components in `src/App.tsx` for now, but split into local Solid components:

1. `UploadPanel`
- Renders required/optional upload controls and status text.
- Receives state + callbacks via props only.
- No parsing logic inside component.

2. `IssuesPanel`
- Renders issue list and empty state.
- Purely presentational with issue array prop.

3. `StagedTable`
- Renders staged rows and inline editors.
- Receives edit handlers + value helpers via props.
- No parsing/export orchestration logic.

4. `TableActions`
- Renders download / clear actions and restore message.
- Receives action handlers and gating booleans via props.

`App` remains orchestrator:
- Owns signals/memos.
- Owns all file parsing/merge/export handlers.
- Owns persistence (`localStorage`) and session restore.

---

## Component contract rules
- Props are the only communication channel between local UI components and `App`.
- Child components are side-effect free.
- Parsing, storage, and export logic stay in `App`.
- Keep helper functions (`toWatchedDate`, `buildExportIssues`, row mapping) framework-agnostic.

---

## Future Astro mapping (next phase, not now)
Potential `.astro` + islands split:
- Static shell/header in Astro page.
- `UploadPanel` island: likely `client:load` (high interaction priority).
- `StagedTable` island: likely `client:visible` when below fold.
- `IssuesPanel` island: likely `client:idle` or `client:visible`.
- `TableActions` can stay with `StagedTable` or be separate depending on shared state strategy.

Important constraint:
- Multiple Astro islands hydrate independently. To split beyond one island, mutable state must move from component-local signals to a shared client module/store.

---

## Active migration checklist
Phase B (pre-Astro)
- [ ] Introduce a shared state facade (`importSessionStore`) for upload/status/rows/issues.
- [ ] Convert component props from many handlers to a compact action API.
- [ ] Add integration test coverage around upload→edit→download flow.

Phase C (Astro)
- [ ] Add Astro + Solid integration.
- [ ] Move static layout to `.astro` page.
- [ ] Hydrate selected components with `client:*` directives.
- [ ] Tune directives by interaction priority and viewport position.
