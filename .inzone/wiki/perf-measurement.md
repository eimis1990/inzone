# Performance measurement protocol

How to capture a baseline before optimising, then re-measure after, so
the win is concrete and not vibes. Use the same protocol every time;
the absolute numbers vary by machine, but the *delta* is what matters.

## The four numbers we care about

| Metric | Why it matters | Where to read it |
|---|---|---|
| **FPS while agent is streaming** | The most user-visible — choppy stream feels broken | PerfOverlay (top-right of widget) + Chrome DevTools FPS meter |
| **`MessageView` renders per assistant turn** | Smoking gun for the "no memo + push-each-chunk" bug | PerfOverlay (component table) |
| **`Markdown` renders per assistant turn** | Markdown parsing dominates render cost | PerfOverlay |
| **JS heap MB at rest + during long sessions** | Memory creep over time = session pool / leaks | PerfOverlay (top-right) + Activity Monitor |

## Tools

### 1. PerfOverlay — built in

Toggle with **⌘⇧P** (Cmd+Shift+P on macOS, Ctrl+Shift+P elsewhere).
Only renders in dev (`npm run dev`); production builds tree-shake it
entirely. Shows live render counts, last render-ms, FPS, and JS heap.
Has a **reset** button — that's the key affordance for our protocol:
reset the counters, do one specific action, read the numbers.

### 2. Activity Monitor (macOS)

Open Activity Monitor → search "INzone" or "Electron". Watch the
**Memory** and **CPU %** columns. There will be multiple INzone
processes — one main, one per renderer, one per SDK agent session.
The interesting one is usually the **GPU** + the renderer.

For energy-impact-on-battery, check the **Energy** tab in Activity
Monitor. Anything over 1.0 sustained when the app is idle is a flag.

### 3. Chrome DevTools (built into Electron)

Right-click anywhere → **Inspect Element** → opens the same DevTools
Chrome has.

- **Performance tab** → click record, do an action (e.g. send a
  message, let it stream, click stop). Look at the flame chart for
  the long red bars — those are the render commits. Hover to see
  which component took time.
- **Performance Monitor** (separate tab, accessible via DevTools'
  command palette: ⌘⇧P inside DevTools → "Show Performance Monitor").
  Live graph of CPU usage, JS heap, DOM nodes, layouts/sec.
- **Memory tab** → Take a heap snapshot before + after a long
  session. Compare retained sizes. Detached DOM nodes = leaks.

### 4. React DevTools Profiler

Install the React DevTools browser extension. In Electron, it loads
automatically if installed. The **Profiler** tab records exactly
which components rendered, how many times, and what triggered each
render. Best tool for confirming "MessageView re-rendered 412 times
when it should have rendered once".

## The baseline protocol (do this BEFORE any optimisation)

Run the app in dev mode so the overlay is available:

```bash
cd /Users/eimantaskudarauskas/Documents/Claude/Projects/inzone
npm run dev
```

### Test A: cold idle

1. App boots, single empty pane, no agents running.
2. Toggle overlay (**⌘⇧P**), click **reset**.
3. Wait 30 seconds. Don't touch anything.
4. **Record**: FPS, heap MB, any unexpected component renders.
5. *Expected baseline*: FPS pinned at 60, heap stable, render
   counts barely move.

### Test B: cold streaming response

1. Pick an agent that gives moderately long answers.
2. Reset the overlay.
3. Send a prompt that produces a ~30–60 line response with at
   least one code block (e.g. "Write a Python function that does X
   and explain how it works").
4. While it streams, watch FPS. After the response finishes,
   **record** every number in the overlay table.
5. *What we're looking for*: `MessageView` and `Markdown` render
   counts way higher than the number of items in the chat. If your
   transcript has 8 items, `MessageView` renders should ideally be
   ~8–20. If it's 200+, that's the memo problem in action.

### Test C: streaming with a long transcript

1. Send 5–10 messages back-and-forth so the transcript builds up
   (~20–40 items).
2. Reset the overlay.
3. Send one more long prompt.
4. Record. The MessageView render count should now be even more
   damning — every chunk in the new response re-renders the entire
   prior transcript.

### Test D: memory creep

1. App fresh start. Note heap.
2. Run a 10-minute session: a few agents, some terminals, switch
   between two projects 3–4 times.
3. Note heap again. Look at Activity Monitor's INzone memory.
4. *What we're looking for*: heap should rise then plateau. Linear
   growth = leak (probably an uncleaned listener). The SessionPool
   warm-globally policy means heap won't fully drop on project
   switch, which is expected — but it shouldn't keep climbing if
   you alternate between the same two projects.

### Test E: pane fullscreen + Cmd+F navigation

1. Open 3–4 panes. Reset overlay.
2. Press Cmd+F repeatedly to fullscreen each. Click between pane
   tabs. Resize panes by dragging dividers.
3. Record. Pane re-renders should be tied to "things that actually
   changed" — switching focused pane should rerender 2 panes
   (old + new), not all 4.

## Capture format

Paste your numbers into a tracked spreadsheet or simple text block:

```
=== INZONE perf baseline · v1.10.2 · M1 8GB · 2026-05-09 ===

A. Cold idle (30s, single empty pane):
   FPS: __
   Heap: __ MB
   Pane renders: __
   MessageView renders: __

B. Cold streaming (~50-line response, fresh transcript):
   FPS during stream: __ (median)
   FPS lowest: __
   Pane renders: __
   MessageView renders: __  (transcript had __ items)
   Markdown renders: __
   ToolBlock renders: __
   Heap delta: __ MB

C. Streaming with ~30-item transcript:
   FPS during stream: __
   MessageView renders: __  (transcript had __ items)
   Markdown renders: __

D. 10-min mixed session:
   Heap start: __ MB
   Heap end: __ MB
   Activity Monitor INzone memory: __ MB

E. Cmd+F / tab switching:
   Pane renders on first switch: __
   Pane renders on second switch: __
```

Then after each optimisation lands, repeat the same protocol and
compare row-by-row.

## What to expect from the planned optimisations

Based on static analysis, ballpark predictions (numbers will firm
up once you share the actual baseline):

| Change | FPS during streaming | MessageView renders | Markdown renders |
|---|---|---|---|
| Baseline (today) | 30–45 fps in deep transcripts | ~n² per response | ~n² per response |
| `React.memo` on MessageView/Markdown/ToolBlock | 55–60 fps | ~n (one per item) | ~k where k = new items |
| + coalesce assistant_text chunks | 58–60 fps | ~n once | ~k where k ≈ new turns |
| + virtualize transcript | 60 fps regardless of transcript length | constant ~10 | constant ~10 |

n = transcript length, k = number of new items added in a turn.

## Sources

- [src/renderer/src/perf/perfStats.ts](../../src/renderer/src/perf/perfStats.ts) — mutable counters
- [src/renderer/src/perf/useRenderCount.ts](../../src/renderer/src/perf/useRenderCount.ts) — the hook
- [src/renderer/src/perf/PerfOverlay.tsx](../../src/renderer/src/perf/PerfOverlay.tsx) — visible widget
- Wiki: [[gotchas]] (auto-scroll falls behind streaming text — same root cause family)
