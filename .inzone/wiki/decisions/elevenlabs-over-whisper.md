# Voice agent uses ElevenLabs Conversational AI, not Whisper STT

**Status**: accepted
**Date**: 2026-05-09

## Context

INZONE's voice agent lets users drive the app by voice. The
question of "should we switch / supplement with OpenAI Whisper?"
came up after looking at terax-ai's "Voice input" feature.

Two different products are easily confused:

1. **Voice agent** (what INZONE has) — full conversational loop:
   STT + LLM + TTS + turn detection + interrupt handling +
   tool-calling, all wired together.
2. **Voice input / dictation** — STT only, push-to-talk into
   a text field.

Whisper is *only* the STT half of (1) — and (2) entirely.

## Decision

- **Voice agent stack stays on ElevenLabs Conversational AI.** No
  swap, no parallel implementation.
- Voice dictation into the composer is **not currently
  implemented** but is a reasonable future feature that could use
  Whisper (likely `whisper.cpp` for offline, on-device). Captured
  as a backlog idea, not v1.10 / v1.11 scope.

## Reasoning

ElevenLabs Conversational AI is doing the heavy lifting we'd
otherwise rebuild from scratch:

- Real-time streaming STT
- Server-side LLM with our system prompt + tool schemas
- Server-side tool routing (we wire up the tools, ElevenLabs
  decides which to call when)
- TTS with low-latency streaming
- Voice activity detection and turn-taking
- Barge-in (user can interrupt the agent mid-sentence)
- Signed URL auth for private agents

We ship the wiring (signed URL minting in [voice.ts](../../../src/main/voice.ts), tool
implementations in [useVoiceAgent.ts](../../../src/renderer/src/voice/useVoiceAgent.ts)) and they ship the
acoustic + conversational stack. Whisper would replace one of those
layers (STT) and leave us to build everything else.

Local Whisper for **dictation specifically** is interesting because
it gives a "type by voice" affordance with no cloud roundtrip — but
that's a different feature for a different user moment, not a
swap-in for the conversational agent.

## Consequences

- Voice features depend on ElevenLabs as a vendor. If they raise
  prices or sunset the product, we'd have to rebuild — accepted risk.
- API key encryption matters more here (see
  [[decisions/safestorage-over-keytar]]) because the key is more
  valuable than typical API keys.
- If voice dictation becomes a priority, evaluate `whisper.cpp` /
  Apple's on-device speech APIs / browser SpeechRecognition. None
  of these compete with the Conversational AI stack.

## Sources

- [src/main/voice.ts](../../../src/main/voice.ts) — signed URL minting
- [src/renderer/src/voice/](../../../src/renderer/src/voice/) — client tools, agent setup
- [src/renderer/src/voice/toolSchemas.ts](../../../src/renderer/src/voice/toolSchemas.ts) — wiki + interrupt + spawn tools
- ElevenLabs Conversational AI docs
- Conversation: 2026-05-09
- Wiki: [[architecture]], [[decisions/safestorage-over-keytar]]
