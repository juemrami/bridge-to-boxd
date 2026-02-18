## Movie Migrate Design System Spec (Draft)

### Scope
- This spec defines **design primitives only** for the MovieLens import feature.
- It intentionally excludes UI flow, layout direction, and interaction sequencing.
- It standardizes how styles are authored using Tailwind CSS with project constraints.

---

## Authoring Rules

### Styling constraints
- Use inline Tailwind in TSX/JSX only for spacing and layout:
  - spacing (`p-*`, `px-*`, `gap-*`, `m-*`)
  - layout/position (`flex`, `grid`, `items-*`, `justify-*`, `w-*`, `h-*`, `max-w-*`, `overflow-*`)
- Keep all color, shadows, borders, and interaction behavior in `src/index.css` utilities.
- Prefer semantic utility names (`.primary-text`, `.card`, `.status-error`) over screen-specific names.

---

## Theme Tokens

Define design tokens in `@theme` in `src/index.css`.

### Color token examples (semantic)
Use semantic aliases; values can evolve without changing class names.

- Background
  - `--color-bg-{light|dark}`
- Text
  - `--color-primary-text-{light|dark}`
  - `--color-secondary-text-{light|dark}`
- Surfaces
  - `--color-{light|dark}-card`
  - `--color-{light|dark}-card-secondary`
- Brand
  - `--color-brand`
  - `--color-brand-contrast`
- Status
  - `--color-{ok|error|warning|info}-status`

---

## Utility Set (Compressed)

### Core utilities
- Text: `.primary-text`, `.secondary-text`, `.text-error`
- Surfaces: `.card`, `.secondary-card`
- Controls: `.button-behavior`, `.base-button`, `.base-button.filled`, `.primary-input`
- States: `.status-error`, `.status-warning`, `.status-success`, `.status-info`, `.focus-ring-brand`

### Table utilities (minimal)
- `.data-table`
- `.data-table-head`
- `.data-table-row`
- `.data-table-cell`
- `.data-table-row-error`

---

## State Model (Visual)

All interactive primitives should support these visual states via utility composition:
- default
- hover (pointer-capable only when appropriate)
- active/pressed
- focus-visible
- disabled
- invalid/error

Implementation notes:
- Use `@media (hover: hover)` when hover should not affect touch UX.
- Keep active movement subtle and consistent across controls.
- Disabled styles must reduce contrast and remove pointer interactions.

---

## Accessibility Standards

Keep this lean for MVP:
- Meet WCAG AA contrast for text and controls.
- Provide visible `:focus-visible` styles on all interactive elements.
- Do not rely on color alone to communicate error/success state.

---

## Tailwind Utility Composition Guidance

### In components (allowed inline)
- layout and spacing only:
  - containers: `flex`, `grid`, `gap-*`, `p-*`, `px-*`, `py-*`
  - sizing: `w-*`, `min-w-*`, `max-w-*`, `h-*`
  - positioning/overflow: `relative`, `absolute`, `overflow-*`

### In index.css (project utilities)
- all color and behavior concerns

---

## Do / Don’t

### Do
- Compose semantic utility classes from `src/index.css` with inline layout utilities.
- Reuse shared utilities before introducing new class names.

### Don’t
- Inline arbitrary color tokens in TSX/JSX.

### Try not to
- Create one-off utility classes tied to a single screen scenario.

