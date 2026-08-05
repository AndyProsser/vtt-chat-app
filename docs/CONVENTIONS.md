# Code Conventions

Detailed version of [CLAUDE.md §3](../CLAUDE.md). If this document and CLAUDE.md ever disagree, CLAUDE.md wins — file an issue to reconcile them.

## Languages

- **TypeScript** for all application code: `backend/`, `ddb/`, `ai/`, `status/`, `tauri-client/overlay-ui/`, `shared/`.
- **Rust**, confined to `tauri-client/src-tauri/` (the Tauri shell) and `tauri-client/rust-livekit/` (the native LiveKit client). No Rust anywhere else — the backend stays Node/Express.
- Strict TypeScript (`strict: true` in `tsconfig.json`) in every package. No `any` without a comment explaining why it's unavoidable.

## UI Stack

- React 19 + Radix UI everywhere a human sees a UI: the DDB overlay (`overlay-ui/`) and the public status page (`status/`).
- Don't reach for a second frontend framework for the overlay to save bundle size — one stack, one mental model, per [CLAUDE.md §3](../CLAUDE.md).
- Style with Radix's theming primitives (tokens/CSS variables), not ad hoc inline styles or a separate CSS-in-JS library.

## Per-Module Folder Layout

Every TypeScript package (e.g. `backend/`, `ddb/`, `tauri-client/overlay-ui/`) follows this shape inside its `src/`:

```text
src/
├── components/   # React components — presentational, minimal logic (UI packages only)
├── hooks/        # Reusable React hooks (UI packages only)
├── consts/       # Constants, enums, default config values
├── types/        # Types/interfaces local to this module
├── styles/       # CSS / Radix theme tokens (UI packages only)
├── lib/          # Non-React logic: API clients, extraction, services, business logic
└── index.ts      # Package entry point / public exports
```

Backend-only packages (`backend/`, `ai/`) omit `components/`, `hooks/`, and `styles/` and instead organize `lib/` by domain (e.g. `lib/rooms/`, `lib/bookmarks/`).

Rules:

- **Don't mix concerns in one file.** A component file contains JSX and the glue to render it — not fetch logic, not constants, not type definitions. Pull those into `hooks/`, `lib/`, `consts/`, `types/` respectively.
- **A component that needs a lot of local logic gets a paired hook**, e.g. `components/BookmarkPanel.tsx` + `hooks/useBookmarkPanel.ts`.
- **No barrel-file sprawl.** Export what other modules need from `index.ts`; don't re-export everything from every folder.

## Shared Code

- Types and contracts used by more than one module (DDB character/campaign shapes, bookmark types, Tauri IPC event payloads, REST/WS contracts) live in `shared/`, imported by consumers — never copy-pasted or redefined per-module.
- `shared/` has no dependency on any other workspace package. Everything else may depend on it.

## Monorepo Tooling

- npm workspaces. Each TypeScript module is its own package with its own `package.json`, listed in the root `package.json`'s `workspaces` array.
- `tauri-client/src-tauri/` and `tauri-client/rust-livekit/` are Cargo crates in a Cargo workspace inside `tauri-client/` — not npm packages, and not listed in the root `package.json`.

## Formatting & Linting

- ESLint (flat config) + Prettier + EditorConfig for TypeScript. Run `npm run lint` / `npm run format` from the repo root.
- `cargo fmt` + `cargo clippy` for Rust, run from inside `tauri-client/`.
- CI (once configured) enforces both — don't merge with lint errors.

## Naming

- Files: `PascalCase.tsx` for React components, `camelCase.ts` for everything else (hooks, lib, types, consts).
- Types/interfaces: `PascalCase`, no `I` prefix (e.g. `BookmarkPayload`, not `IBookmarkPayload`).
- Constants: `SCREAMING_SNAKE_CASE` for true constants; `camelCase` for config objects.
