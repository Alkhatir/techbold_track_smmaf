# `src/components/ui` — shadcn/ui primitives

Generated **shadcn/ui** components — Radix UI primitives styled with Tailwind v4.
They are the low-level building blocks (button, dialog, select, table, tooltip,
etc.) that the domain components in `../workspace` compose.

## ⚠️ Do not edit these by hand

These files are generated/vendored. Editing them directly makes upgrades painful
and risks inconsistency across the app. Instead:

- **Restyle** via Tailwind classes at the call site, or the `class-variance-authority`
  variants already defined in each component.
- **Compose** — wrap a primitive in a new component under `../workspace` (or a new
  folder) rather than modifying the primitive.
- **Add/update** primitives through the shadcn CLI / generator, not manual edits.

## Conventions

- Most components use `cn()` from `@/lib/utils` to merge Tailwind classes.
- Variants (sizes, intents) are defined with `class-variance-authority`.
- Theming is driven by CSS design tokens defined in `src/styles.css`
  (`--background`, `--primary`, `--danger`, …), so primitives adapt to the dark
  workspace theme automatically.

For the actual application UI and behaviour, see `../workspace/README.md`.
