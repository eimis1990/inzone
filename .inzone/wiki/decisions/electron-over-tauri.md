# Stay on Electron, don't rewrite to Tauri

**Status**: accepted
**Date**: 2026-05-09

## Context

Tauri 2 is genuinely attractive for desktop apps shipping in 2026 —
~7 MB bundles vs Electron's ~150 MB, native system webview, Rust
backend, smaller memory footprint. After looking at the
crynta/terax-ai project (Tauri-based AI terminal at 7 MB) the
question came up: should INZONE rewrite to Tauri?

## Decision

**Stay on Electron.** Not as a "for now" — as the answer.

## Reasoning

The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) is **Node.js
only**. It's our core runtime: SessionPool spawns one SDK process
per chat pane, the SDK exposes streaming events the renderer
subscribes to, every agent personality and skill is loaded by SDK
code that requires a Node runtime. Moving to Tauri would mean:

- Reimplementing the SDK against Anthropic's raw HTTP API in
  Rust (months of work, parity with a moving target).
- Or shelling out to a Node sidecar process per pane (defeats the
  size win and adds serialization overhead).
- Or restricting INZONE to a pure-HTTP agent loop, losing every
  SDK feature: structured tool use, MCP integration, skill loading,
  prompt caching, transcripts, the lot.

Bundle size isn't even our biggest pain. Users install INZONE once
and use it daily — a one-time 150 MB download is fine. Memory is
the more interesting axis (each Electron renderer owns a Chromium
instance), but Tauri shares the system webview which on macOS means
Safari/WebKit — different bug surface, different keyboard quirks,
different Web API support, and we'd have to re-test everything.

Anthropic also announced Managed Agents in April 2026 — cloud-hosted
runtime at $0.08/session-hour. If the Agent SDK ever splits "client
library" (HTTP wrapper, Rust-portable) from "runtime" (Node-only),
Tauri becomes plausible. Until then, Node is on the critical path.

## Consequences

- We accept the 150 MB binary size as the cost of using the SDK
  natively.
- Performance work focuses on what actually moves the needle inside
  Electron: WebGL terminal renderer (v1.10), lazy mounting,
  scrollback budgeting, off-screen pane suspension.
- We keep an eye on Anthropic's runtime split announcement and
  revisit if it ships.

## Sources

- Tauri 2 docs (https://v2.tauri.app/) — system webview model
- @anthropic-ai/claude-agent-sdk package — Node-only runtime
- [src/main/sessions.ts](../../../src/main/sessions.ts) — SessionPool design depends on Node
- crynta/terax-ai (Tauri AI terminal) — comparison point only
- Conversation: 2026-05-08 (just before v1.9.0 release)
- Wiki: [[architecture]]
