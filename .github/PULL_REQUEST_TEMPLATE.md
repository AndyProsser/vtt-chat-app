## What and why

<!-- What does this change, and why? Link the issue it closes. For anything beyond a small fix, please open an issue first. -->

## Checklist

- [ ] Tests added or updated, and they pass (`npm test --workspaces --if-present`); `npm run lint` is clean.
- [ ] User-visible change? It is under `## [Unreleased]` in [CHANGELOG.md](../CHANGELOG.md).
- [ ] Docs updated in the same change (architecture docs, `docs/BUILD-STATUS.md`, README where it applies).
- [ ] It works with every cloud adapter turned off (self-host first), and keeps recording consent visible.
- [ ] The [State & Resilience checklist](../CONTRIBUTING.md#state--resilience-checklist) is satisfied, if this touches UI state.
- [ ] **Wire change?** A change to the API or signalling between server and app changes `shared/`, bumps the MINOR version and `PROTOCOL_VERSION`. Say so here: ____
- [ ] No secrets, real credentials, or personal addresses in the diff.

## How I checked it

<!-- What you ran, and what you saw. Screenshots help for anything visual (light and dark). -->
