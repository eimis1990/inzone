# Decisions

Architecture-decision-record (ADR) style. One file per decision.
See [[wiki-schema]] for the template.

Files in this directory:

- [[decisions/electron-over-tauri]] — stay on Electron despite
  Tauri's smaller binary size
- [[decisions/safestorage-over-keytar]] — use Electron's built-in
  encryption instead of the deprecated keytar native module
- [[decisions/anthropic-only]] — INZONE is intentionally
  single-provider (Anthropic / Claude Agent SDK)
- [[decisions/elevenlabs-over-whisper]] — voice agent uses
  ElevenLabs Conversational AI rather than Whisper STT
