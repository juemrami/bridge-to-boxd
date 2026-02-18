## Import UX Story Spec (Draft)

### Current implementation scope
- **Initial MVP implementation target: MovieLens only.**
- The UX and architecture should remain extensible to other sources later, but current shipped flow is MovieLens ratings import with optional logs/tags enrichment.
- After MVP implementation is complete, remove or relax MovieLens-specific wording in this document and promote source-agnostic naming where appropriate.

### Goals
- Provide a single, consistent import UX across multiple source platforms (e.g. MovieLens, IMDb, others).
- Stage data into a single **Letterboxd import-shaped table** for review and editing.
- Preserve partial success: optional inputs should never block staging when the required source input is valid.
- Make issues actionable: errors should be addressable by row/field with stable references.

### Non-goals (MVP)
- Implementing wishlist/list import flows.
- Implementing multi-service navigation UI (tabs/routes) before a second flow exists.
- Building a separate raw-import table editor for platform-specific files.
- Advanced table features (filter/sort/search, column customization).

---

## Core UX decision
The primary work surface is always the **staged export table**, shaped for Letterboxd import.

- Users spend their time fixing what will be exported.
- Source imports can have varying schemas; staging normalizes them into one editing surface.
- The staging surface should minimize manual editing: expose only fields needed to identify a film in Letterboxd plus diary metadata fields users are likely to adjust.

---

## Conceptual data model
### Inputs
Each import flow is defined by:
- **Primary dataset (required)**: the minimum file(s) needed to produce staged export rows.
  - Examples:
    - A “ratings” export file from a service
    - A watch history export
- **Additional datasets (optional, service-specific)**: extra file(s) that can fill in or improve staged fields.
  - Not all services will have this phase.
  - Example (MovieLens): activity logs and tags exports.

### Output (constant)
- A downloadable CSV in Letterboxd’s import format.
- Column order and identifier constraints are defined by the output layer (see [src/modules/letterboxd.ts](../src/modules/letterboxd.ts)).

---

## MVP page layout (single scrolling view)
### 1) Header
- Title: “Import” (or “Import to Letterboxd”)
- Subtitle: “Upload your export file, review staged rows, then download a Letterboxd CSV.”
- Primary action: “Download Letterboxd CSV”
  - Disabled until:
    - Primary dataset successfully parsed into at least one staged row, and
    - There are no export-blocking staged-row issues.
- Secondary action: “Clear import”
  - Resets uploaded files, staged rows, and issues.

### 2) Uploads section
- Render an upload row for each dataset in the active import flow.
- Initial MVP datasets (MovieLens):
  - Primary dataset (required)
  - Optional additional dataset: “Logs” (optional)
  - Optional additional dataset: “Tags” (optional)

Upload row contents:
- File picker control
- Status line: Not uploaded | Parsing… | Loaded (N rows) | Fatal error
- One-line helper text describing what this file contributes

Rules:
- Additional dataset uploads are disabled until the primary dataset is loaded.
- Additional dataset failures are non-fatal to staging (issues are recorded; staged rows remain editable).

### 3) Issues section (in-page, not tabbed)
- Shown in the same view as the staged table.
- Hidden or compact-success state when empty.
- Issues list is grouped by:
  - Primary dataset
  - Each enrichment dataset
  - Export validation (Letterboxd constraints)

Each issue must include:
- Severity: fatal | non-fatal
- Stable reference: dataset name + `rowIndex` (when applicable) + optional `field` path
- Human-readable message
- Optional context payload (e.g., JSON parse error string)

Linking behavior:
- If an issue can be fixed in the staged export table, clicking it should focus the relevant staged row/cell.
- If it cannot map to a staged row (platform-specific parsing error), it remains informational.

### 4) Staged export table
- Heading: “Staged for Letterboxd export”
- Editing surface contract (all services):
  - One leading UI-only column: Status (ok/issue)
  - Editable identifier fields: `LetterboxdURI`, `tmdbID`, `imdbID`, `Title`
  - Editable metadata fields: `Rating`/`Rating10`, `WatchedDate`, `Rewatch`, `Tags`, `Review`
  - Non-essential matching helpers (for example `Year`, `Directors`) are not required in the staging UI by default.
  - Export still targets the full Letterboxd CSV schema; non-exposed columns may be left empty unless a source profile explicitly requires them.

Editing:
- Cells are editable inline.
- After edits, revalidate only:
  - The changed field, and
  - Any dependent export constraints.

---

## Validation and gating
### Fatal (blocking) errors
Fatal errors prevent staging/export and are presented near the associated upload.
Examples:
- Required file missing
- Unreadable file
- Header validation failure (when enabled)
- Parse failure that prevents producing staged rows

### Non-fatal issues
Non-fatal issues never block table editing.
Examples:
- Row-level parsing errors in optional additional datasets
- Additional-data merge misses (no match found)
- Staged row failing Letterboxd identifier constraint

### Export validation (minimum for MVP)
- Each staged row must include at least one identifier:
  - LetterboxdURI or tmdbID or imdbID or Title
- If any staged row fails export validation:
  - Download remains disabled until resolved.

---

## Persistence and session policy (MVP)
### Persistence strategy
- Persist staged import session in `localStorage`.
- Persist at minimum:
  - active source/service
  - staged export rows
  - issues list
  - upload metadata (file name, import timestamp, dataset status)
- On reload, restore the most recent valid session automatically.

### URL sharing
- URL-hash/shareable session state is **not** part of MVP implementation.
- Add as post-MVP TODO to avoid URL-size/privacy concerns and reduce MVP complexity.

### New upload behavior with existing staged data
- Primary dataset re-upload is allowed, but requires confirmation.
- Confirmation message: importing a new primary file overwrites existing staged data.
- No merge-on-upload flow in MVP.
- Optional datasets can be re-uploaded after primary data exists; they re-run refinement on current staged rows.

---

## Acceptance criteria (MVP)
- The staged table is the main surface and is always Letterboxd-shaped.
- The editable staged surface is minimal and source-agnostic: only identifier fields plus diary metadata fields are user-editable.
- The primary dataset is required to enable staging and download.
- Optional additional datasets can be uploaded after the primary dataset and never delete/overwrite user edits in staged rows.
- Issues are visible on the same page (not a separate tab).
- Downloaded CSV respects Letterboxd header ordering and identifier constraints.
- Session state is restored from `localStorage` on reload.
- Uploading a new primary file prompts overwrite confirmation (no merge mode).

---

## Service-specific import profiles

### MovieLens (initial MVP implementation)
Datasets:
- Required: Ratings CSV
- Optional additional: Logs CSV, Tags CSV

Quirks:
- Multi-file import where optional files refine staged rows.
- Logs may provide watch dates via action-specific payload parsing.
- Tags may append or merge into staged `Tags`.

Expected UX behavior:
- User uploads Ratings first.
- User can then upload Logs/Tags for refinement.
- Logs/Tags issues are non-fatal and listed in Issues.

Conflict policy for multiple log rating activities on the same film (MVP):
- When multiple log entries map to the same staged film, use the **most recent** valid rating-related log event.
- Apply its derived date to staged `WatchedDate` (and any date-adjacent fields used by the flow).
- Do not show a conflict-resolution UI in MVP.
- Older matched log entries are ignored in UI presentation.
- Users can still manually edit staged date/rating fields in the table.

### IMDb (WIP / minimal initial profile)
Datasets:
- Required: Ratings export CSV (single file)
- Optional additional: none currently defined

Based on sample export header in `sample_data/imdb-ratings-export.csv`:
- `Const` (IMDb title ID), `Your Rating`, `Date Rated`, `Title`, `Year`, plus other metadata columns.

Minimal staging assumptions for a first pass:
- `Const` -> staged `imdbID`
- `Title` -> staged `Title`
- `Year` may be retained as source metadata but is not part of the default editable staging surface.
- `Your Rating` -> staged rating field (mapping details TBD: `Rating` vs `Rating10`)
- `Date Rated` -> staged `WatchedDate` (if enabled for IMDb flow)

Open TODOs for IMDb profile:
- Confirm rating scale mapping strategy from IMDb “Your Rating”.
- Confirm whether `Date Rated` should always map to `WatchedDate`.
- Define required header validation set vs tolerated extra columns.
- Add IMDb-specific row validation/error messages.

### Other services (template)
For each new source, define:
- Required dataset(s)
- Optional additional dataset(s), if any
- Source quirks and mapping notes
- Validation specifics and issue messaging

---

## Future extensibility
- When a second import flow exists (e.g. Wishlist, another service), introduce tabs/routes.
- If users need to directly repair platform-specific raw rows (e.g. fix malformed JSON), add a separate “Diagnostics” view.
- After MovieLens MVP ships, revisit this document and replace MovieLens-specific labels in MVP sections with source-agnostic terms.

---

## Post-MVP cleanup checklist
- [ ] Rename UI labels from MovieLens-specific language to source-agnostic language where flow-independent.
- [ ] Update “Initial MVP datasets (MovieLens)” wording to a generic service-profile-driven section.
- [ ] Confirm upload section supports per-source dataset configuration without changing staged table UX.
- [ ] Replace hardcoded source examples in acceptance criteria with source-agnostic phrasing.
- [ ] Add/update a brief “Supported sources” section once IMDb (or another source) is implemented.
- [ ] Re-run docs pass to ensure `movielens-import-spec.md` remains parser/validation-specific and this file remains UX-focused.
- [ ] Add URL hash-based sharing design (payload contract, size limits, privacy notes, fallback behavior).
