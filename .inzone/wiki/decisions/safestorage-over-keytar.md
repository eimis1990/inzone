# Use Electron's `safeStorage` for secrets, not `keytar`

**Status**: accepted
**Date**: 2026-05-09

## Context

For v1.10 we wanted the ElevenLabs API key encrypted at rest in the
OS keychain (it was previously plaintext in electron-store JSON).
The obvious candidate was the `keytar` npm package — historically
the standard way for Node apps to talk to OS credential stores.

The Anthropic API key was already encrypted; it used Electron's
built-in `safeStorage` ([claude-auth.ts](../../../src/main/claude-auth.ts)). So we faced a choice:
match the existing pattern (`safeStorage`) or introduce a second
mechanism (`keytar`).

## Decision

**Use `safeStorage` for everything.** Match the pattern already
established in [claude-auth.ts](../../../src/main/claude-auth.ts).

## Reasoning

`keytar` is functionally a trap in 2026:

1. **Deprecated and unmaintained.** Last meaningful release in
   2022. README points users elsewhere.
2. **Native module pain.** Bindings break across Electron major
   versions; rebuild costs at every Electron upgrade; cross-arch
   builds (arm64 + x64) need two binaries.
3. **Cross-platform fragility.** Linux libsecret support varies
   wildly across distros; community workarounds are scattered.

`safeStorage` is the right answer for Electron specifically:

- **Built-in.** Ships with Electron itself, no extra dep, no
  native rebuild, no version skew.
- **Same backing target.** macOS Keychain, Windows DPAPI, Linux
  kwallet/libsecret — exactly what `keytar` would call.
- **Available everywhere we run.** Already wired and tested via
  the Anthropic API key path.
- **Encrypts arbitrary strings**, not just credentials — useful
  for any future at-rest secret (OAuth tokens, GitHub PATs).

The only difference vs `keytar`: `safeStorage` doesn't manage the
storage itself. We hand-roll the file write/read (`userData/
elevenlabs-api-key.enc`, chmod 0600). That's ~15 lines of code we
control vs ~200 KB of native module we don't.

## Consequences

- Every secret in INZONE goes through `safeStorage` going forward.
  No `keytar`, no `node-keychain`, no homegrown crypto.
- We accept ~15 lines of file I/O boilerplate per secret. Cheap.
- Migration code lives where the secret is consumed — see
  [voice.ts](../../../src/main/voice.ts) `migrateLegacyApiKeyIfNeeded` for the pattern.
- If `safeStorage.isEncryptionAvailable()` returns false (rare —
  some Linux configs without a keyring daemon), we surface a clear
  error rather than silently writing plaintext.

## Sources

- [src/main/voice.ts](../../../src/main/voice.ts) — v1.10 implementation
- [src/main/claude-auth.ts](../../../src/main/claude-auth.ts) — original `safeStorage` pattern
- Electron docs on `safeStorage`
- keytar repository status (deprecated)
- v1.10 conversation: 2026-05-09
- Wiki: [[gotchas]] (`keytar` is a trap)
