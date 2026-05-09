# INZONE is intentionally Anthropic-only

**Status**: accepted
**Date**: 2026-05-09

## Context

Many AI desktop tools support multiple model providers — OpenAI,
Anthropic, Google, Groq, Cerebras, local models via LM Studio /
Ollama. The crynta/terax-ai project lists seven provider integrations
plus generic OpenAI-compatible. The instinctive question: "should
INZONE add provider support?"

## Decision

**No.** INZONE stays Anthropic-only. Every chat pane runs through
the Claude Agent SDK. Multi-provider is not on the roadmap.

## Reasoning

INZONE's value isn't "talk to a model in a window" — that's
commodity. It's:

1. **Multi-pane orchestration** — many agents working in parallel
   on the same project, each in its own pane.
2. **Lead Agent mode** — one orchestrator dispatching sub-agents.
3. **First-class agents + skills + MCP** — Claude Agent SDK
   features that other providers either don't have or implement
   differently.
4. **Consistent transcript / tool-use / interrupt model** —
   features baked into the SDK that the renderer relies on.

Adding a second provider means either:

- A least-common-denominator wrapper that loses everything that
  makes the Agent SDK valuable (tool use shape, skills, MCP, prompt
  caching, transcripts) — turning INZONE into a chat client with
  panes, not an agent cockpit.
- Two parallel runtime paths (one Anthropic, one provider-X)
  forever, doubling test surface and feature drift.

We'd rather be **the best Claude Agent SDK orchestrator** than a
mediocre everything-client. Cohesion is the feature.

## Consequences

- Every doc, agent format, skill format, system prompt assumes
  Claude. We make no apology for this.
- Local-model users are not a target audience. They have other
  great tools (LM Studio's UI, Ollama + open-webui, etc.).
- If Anthropic ever stops shipping an SDK we can use, we re-evaluate
  — but until then, single-provider is the strategy.
- The Cmd+P / pane preset for "Codex" / "Aider" / "Gemini" is a
  *terminal* preset that launches THEIR CLI inside a shell pane —
  it does NOT route through our chat UI. That's the only multi-
  provider concession.

## Sources

- Conversation w/ Eimantas across v1.5–v1.10 — "stay focused" was
  the consistent product direction
- [src/main/sessions.ts](../../../src/main/sessions.ts) — single SDK type
- [src/shared/worker-presets.ts](../../../src/shared/worker-presets.ts) — terminal-only multi-CLI option
- Wiki: [[architecture]], [[decisions/electron-over-tauri]]
