# Conventions

Coding patterns, naming rules, error-handling style, formatting
rules — anything that should be done **the same way** across the
project. One file per convention area.

Files in this directory:

- [[conventions/memoisation]] — when to `React.memo`, when to use a
  custom comparator, when to reach for `useShallow`. Pattern
  established during the v1.11.0 perf pass.

Likely future additions:
- `css-variables.md` — token scoping rules (root vs pane vs
  component)
- `ipc-channels.md` — naming + handler placement + broadcast
  pattern
- `secrets.md` — `safeStorage` flow for any new secret
