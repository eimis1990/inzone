# INZONE — Landing Page Specification

A spec for the marketing site at **inzone.app** (or wherever you host
on Vercel). The goal is one page that converts — visitors land,
understand the product in five seconds, see it in action, and
download. Everything else is supporting evidence.

---

## 1. Strategic goals

**Primary goal**: get the visitor to download the macOS DMG.
**Secondary**: communicate that INZONE is a *cockpit for piloting
multiple AI agents*, not yet-another-IDE-clone or a chatbot.
**Tertiary**: signal trust — local-first, MIT-licensed, signed by a
real Apple Developer ID.

**Success criteria**:
- Above-the-fold value prop is legible in <5 seconds
- Download button is visible without scrolling
- The visitor leaves knowing what makes INZONE *different* from
  Claude Code / Cursor / Cline (interactive multi-pane piloting)
- Page weight under 2MB on first paint, under 5MB total
- Lighthouse Performance ≥ 90 on mobile, ≥ 95 on desktop

---

## 2. Brand & visual language

### Palette (from the app)

| Token              | Hex       | Usage                              |
| ------------------ | --------- | ---------------------------------- |
| `--bg`             | `#0C0E12` | Page background                    |
| `--bg-elev`        | `#14171C` | Card / section backgrounds         |
| `--bg-elev-2`      | `#23252E` | Inset elements, code blocks        |
| `--text`           | `#E6E8EE` | Primary text                       |
| `--text-dim`       | `#99A1B3` | Secondary text                     |
| `--muted`          | `#5A6272` | Captions, footer text              |
| `--accent`         | `#E4D947` | The signature yellow — CTAs, glow  |
| `--accent-on`      | `#14110A` | Text on accent background          |
| `--accent-2`       | `#B78AFF` | Purple secondary (terminal panes)  |
| `--ok`             | `#3DDC97` | Success states                     |
| `--danger`         | `#F26D7A` | Errors, warnings                   |

### Typography

- Headlines: **Squada One** (already loaded in the app for the
  INZONE wordmark) — bold, condensed, 48–96px depending on level.
  Use for hero headline + section h2s. Never below 24px.
- Body: **Inter** or **SF Pro Text** — 16px base on desktop,
  17px line-height 1.55. Tight letter-spacing on headlines (-1%),
  default on body.
- Mono: **JetBrains Mono** or **SF Mono** — for code samples,
  command lines, and the terminal-pane mockup.

### Motion principles

- **Restraint**. One animation per viewport at a time. Nothing
  should pulse forever — entry animation plays once, then stops.
- **Easing**: `cubic-bezier(0.22, 0.61, 0.36, 1)` (the same easing
  the app uses on its drawer transitions). Duration 280–600ms.
- **Trigger style**: scroll-driven (IntersectionObserver) for
  reveals; CSS transitions for hovers; **prefers-reduced-motion**
  must disable everything except opacity fades.

### Voice & tone

- Direct, confident, slightly dry. Avoid AI hype words: "magical,"
  "revolutionary," "10x," "supercharge."
- No marketing fluff like "trusted by leading teams" until you
  actually have testimonials.
- Use sentence case for headlines, not Title Case Of Every Word.
- Em-dashes are okay; don't overdo them.

---

## 3. Page structure

Single scrolling page, six sections, ~3500–4500px tall on desktop.

### 3.1 Hero (above the fold)

**Layout**: split 50/50 on desktop, stacked on mobile.

**Left column (text)**:
- Tiny eyebrow label: `MacOS · v1.0` in `--accent`, 11px uppercase,
  letter-spacing 0.1em.
- Headline (Squada One, 80–96px desktop, 48px mobile):

  > **Run a fleet of AI agents. From one window.**

  (Alternatives if you want softer: "The cockpit for AI-assisted
  coding." or "Pilot multiple Claude agents side-by-side.")

- Subheadline (Inter 18px, `--text-dim`, max-width 540px):

  > INZONE is a macOS app for orchestrating multiple Claude Agent
  > SDK sessions in a single window. Split panes, sequential
  > pipelines, voice control, in-app diff review and PR — designed
  > for people who want to delegate to several agents at once.

- Two buttons in a row:
  - Primary: `Download for macOS` — accent yellow, dark text. On
    Apple Silicon detection, label says `Download for Apple Silicon`,
    on Intel says `Download for Intel`. Detect via
    `navigator.userAgent`. Icon: macOS Apple logo (SVG).
  - Ghost: `View on GitHub →` — text-dim, links to
    `github.com/eimis1990/inzone`.

- Tiny line under buttons:
  > Free. MIT-licensed. Signed and notarized.

**Right column (visual)**:
- A *clickable, animated mock* of the INZONE window. Recommended:
  an interactive React component that mimics three or four panes
  with the chrome of INZONE — sidebar, workspace bar, panes with
  agent emoji headers, one pane "streaming" simulated text.
- Subtle parallax: as the user moves the mouse over the mock, the
  panes shift ~5px in the opposite direction (transform translate3d).
- The "active" pane has the brand-yellow stripe. Cycle which pane
  is active every 4 seconds with a smooth transition so visitors
  see the multi-pane experience.

**Backdrop**: dark `--bg` with a soft yellow radial gradient
behind the visual at ~6% opacity, blurred. Subtle dotted grid
overlay (matches the app's flow board background).

**Anchor scroll cue** at the bottom: a small "↓ Scroll" pill that
disappears on first scroll.

---

### 3.2 "What is INZONE" — value prop strip

**Layout**: full width, single row of three or four stat tiles.

Each tile: large stat (Squada One 64px, accent yellow), label
below in dim text. Examples — pick whatever's true for v1:

| Stat                     | Label                        |
| ------------------------ | ---------------------------- |
| `5+`                     | starter agents bundled       |
| `8`                      | starter skills bundled       |
| `4`                      | CLI tools as workers         |
| `0`                      | telemetry, accounts, lock-in |

The fourth tile in particular doubles as a trust signal. Yellow
"0" with the wry "telemetry, accounts, lock-in" label lands.

Below the stats, a single paragraph (28px Inter, max-width 720px,
centered):

> Built for developers who use Claude as a teammate, not a tab.
> Run several agents in parallel, chain them into pipelines,
> review their diffs in-app, ship with one click. Your folder,
> your subscription, your machine.

---

### 3.3 Features section — the big one

**Layout**: vertical column of "feature blocks." Each block
alternates left/right on desktop (image on one side, copy on the
other). Stacks vertically on mobile.

**Block template** for each feature:

- Section eyebrow: `01 / Multi-pane workspace` (number + slash +
  feature name) in mono, accent color.
- Headline (Squada One, 56px): the feature's one-line promise.
- Two-paragraph body in Inter 17px / `--text-dim`.
- Visual: animated screenshot or video, ~640×400 desktop. Use a
  thin border in `--border` (#2a2d36), 12px border-radius, subtle
  inset shadow for depth.

**Eight blocks, in this order:**

#### Block 01 — Multi-pane workspace
- **Headline**: *Several agents. One window. Zero context-switching.*
- **Body**: Split your project view into independent panes, each
  with its own agent and conversation. Agents run in parallel, see
  the same project folder, and can hand off work to each other
  through lightweight file conventions. No more juggling six
  Claude tabs.
- **Visual**: 4-pane mock, each with a different agent emoji
  (frontend 🎨, backend ⚙️, browser 🌐, lead 👑). Cycle which
  pane is "streaming" every few seconds.

#### Block 02 — Workers tab
- **Headline**: *Agents and CLI tools share one shelf.*
- **Body**: Drop a Claude agent on a pane to chat with it; drop
  Claude Code, Codex CLI, Aider, Gemini CLI, or a plain shell on
  a pane to embed that tool right in the layout. Same drag, same
  surface — choose the right tool for each task.
- **Visual**: Sidebar Workers tab with the Agents section + Other
  section. Hover on a CLI card animates a spawned terminal pane.

#### Block 03 — Flow
- **Headline**: *Chain your agents into pipelines.*
- **Body**: Build a sequential workflow on a free-form canvas.
  Each card is a pane with its own prompt; outputs flow forward
  via `{previous}`. Hit Run Flow and walk away. Live logs surface
  in a side panel. n8n for AI agents, but the agents are real
  Claude SDK sessions doing real work.
- **Visual**: Flow board with three connected cards, bezier lines
  animating, "Running…" pill on the active card.

#### Block 04 — Worktrees + Diff Review + PR
- **Headline**: *Branch, build, review, ship — without leaving the
  app.*
- **Body**: Spin up a git worktree off any branch from the
  sidebar. Several agents can work in parallel branches without
  stepping on each other. When the work is ready, the Review tab
  shows a side-by-side diff with per-hunk approve/reject. One
  click opens a PR via the gh CLI (or merges locally), and INZONE
  cleans up the worktree afterwards.
- **Visual**: Diff view with per-hunk green/red controls, then
  fade into the PR success state with a real GitHub PR URL.

#### Block 05 — Lead mode
- **Headline**: *One orchestrator. Many subagents.*
- **Body**: Switch a project into Lead mode and a top pane
  becomes the orchestrator agent. It can spawn subagents, message
  them by name, watch their progress, and hand off tasks. The
  same lightweight pattern Anthropic uses internally — without
  any of the plumbing.
- **Visual**: A Lead pane on top with three subagent panes below,
  arrows showing message flow.

#### Block 06 — Voice
- **Headline**: *Talk to your fleet.*
- **Body**: Connect an ElevenLabs Conversational AI agent and
  drive INZONE by voice. "Spin up a frontend agent on this
  folder." "Tell the backend agent to add the auth endpoint."
  Bring your own ElevenLabs account; INZONE doesn't take a cut.
- **Visual**: Animated Siri-style orb pulsing while voice
  commands appear as text and INZONE responds.

#### Block 07 — Mission Control
- **Headline**: *Every agent. Every project. One glance.*
- **Body**: ⌘⇧M opens a full-screen overview of every project
  across your active workspace — agents, status, current tool,
  cost, last activity. Click a pane to jump to it. The closest
  thing to a process monitor for AI agents.
- **Visual**: Mission Control overlay with multiple project cards
  and pane rows.

#### Block 08 — Local-first
- **Headline**: *Your code never leaves your laptop.*
- **Body**: All transcripts, agent definitions, MCP configs,
  OAuth tokens (encrypted via macOS keychain), and pipeline state
  live on your machine. The only data that leaves: the prompts
  you send to Anthropic (your subscription), Voice prompts to
  ElevenLabs (if you enable it), and the MCP server endpoints
  you explicitly add.
- **Visual**: A simple architecture diagram — MacBook in the
  center, three arrows pointing out to "Anthropic," "ElevenLabs
  (optional)," "Your MCPs."

---

### 3.4 "How it works" — three steps

**Layout**: horizontal three-step row on desktop, vertical on
mobile. Each step in a card with a big number, a heading, and
two-line description.

1. **Download** — DMG for Apple Silicon or Intel. Drag to
   Applications.
2. **Sign in to Claude** — paste your API key or run `claude
   login`. Either works.
3. **Open a project** — pick a folder, split into panes, drop
   agents in, start working.

Below the steps, an inline GIF or short video (15–30s) showing
the actual flow: download dialog → first launch welcome modal →
folder pick → assigning a frontend agent → first turn streaming.

---

### 3.5 Honest comparison strip

**Layout**: a single-row table, three columns. Light, not heavy.

Compare INZONE to two adjacent tools the visitor likely already
knows. Be honest — pick what each tool does *better*, not just
why INZONE wins.

| Use case                            | INZONE | Claude Code | Cursor |
| ----------------------------------- | ------ | ----------- | ------ |
| Single agent, fast feedback loop    | ✓      | ✓✓          | ✓✓     |
| Multiple agents in parallel         | ✓✓     | —           | —      |
| Sequential pipelines (Flow)         | ✓✓     | —           | —      |
| Voice control                       | ✓✓     | —           | —      |
| Built-in IDE features (lints, etc.) | —      | —           | ✓✓     |

(`—` means "not really," `✓` means "supported," `✓✓` means
"shines here.") This signals confidence without bashing
competitors.

---

### 3.6 Final CTA + footer

Wide centered block:

- Repeat headline (smaller — Squada One 48px):
  > **Ready to ship faster?**
- Subhead: *Free for personal and commercial use. No account
  required.*
- Primary download button (same as hero) + GitHub link.

**Footer** (4-column grid, slim):

| Product       | Resources       | Community  | Legal      |
| ------------- | --------------- | ---------- | ---------- |
| Download      | Documentation   | GitHub     | Privacy    |
| Changelog     | Getting started | Issues     | License    |
| Roadmap       | Voice setup     | Discord?   | Imprint    |

Bottom row: `INZONE · MIT License · Built with Claude · 2026`

---

## 4. Interactive elements

Three places that warrant real interaction (don't add more):

1. **Hero animated mock** — the multi-pane window with rotating
   active pane. Subtle mouse parallax. This is the page's anchor
   visual.

2. **Flow card demo (Block 03)** — when the section enters the
   viewport, the bezier lines draw from card 1 to card 2 to card
   3 over 1.5 seconds. The "Run Flow" button highlights, then
   each card's "running" pill activates in sequence.

3. **Mission Control demo (Block 07)** — on hover over the
   mockup, click-areas reveal: hovering a pane row shows a
   tooltip "click to jump", clicking actually animates a switch
   to that project's pane.

Everything else: subtle hover lifts (translateY(-2px) on cards),
underline animations on links, button micro-interactions (slight
scale on press). No marquees, no infinite carousels, no hero
typing effects.

---

## 5. Tech stack recommendation

- **Framework**: Next.js 15 (App Router) on Vercel — free hosting,
  edge functions, Image optimization, perfect Lighthouse defaults.
- **Styling**: Tailwind CSS with custom design tokens mapping to
  the colors above. shadcn/ui for any form components needed.
- **Animations**: Framer Motion for scroll-triggered reveals and
  hero parallax. CSS for hover micro-interactions.
- **Video**: Self-hosted MP4 (no YouTube embed for the demo).
  Cloudflare R2 or Vercel Blob for video hosting.
- **Analytics** (optional): Plausible or Umami — privacy-first,
  matches the local-first ethos. Skip if you want zero tracking.
- **Architecture**: Single page (/), separate /privacy, /license,
  /changelog. No auth, no DB, no backend.

---

## 6. Performance + SEO

- **Title**: `INZONE — Multiple Claude agents. One window.`
- **Description** (155 chars): A macOS cockpit for orchestrating
  multiple Claude Agent SDK sessions side-by-side. Multi-pane
  workspace, Flow pipelines, in-app PR.
- **OG image**: 1200×630, generated from the hero visual with a
  dark backdrop and the headline overlaid.
- **Favicon**: same icon as the .icns app icon, SVG primary, ICO
  fallback.
- **Schema.org SoftwareApplication** JSON-LD in head — helps
  search engines surface the download button directly.
- **Lazy-load** all videos and animated mockups below the fold.
  Eager-load only the hero visual.
- **Preload** the hero font (Squada One) and the hero image.
- **Cache headers**: marketing-static; never serve stale build
  artifacts.

---

## 7. Asset checklist

Before the page goes live, you need:

**Visuals**:
- [ ] Hero animated mock (interactive React component)
- [ ] Workers tab screenshot/animation
- [ ] Flow board screenshot/animation
- [ ] Diff Review + PR screenshot
- [ ] Lead mode screenshot
- [ ] Voice orb animation (CSS or Lottie)
- [ ] Mission Control screenshot
- [ ] "How it works" 15–30s demo video
- [ ] OG image (1200×630)
- [ ] Favicon (multi-resolution)

**Copy**:
- [ ] All section headlines + body copy (above is the draft —
      revise as you see it on the page)
- [ ] Privacy policy
- [ ] License page (just MIT text)
- [ ] Changelog (link to GitHub releases)

**Detection**:
- [ ] Apple Silicon vs Intel detection script (sets the right
      DMG link)
- [ ] User-agent fallback: if non-macOS, button reads "macOS
      only — view source on GitHub"

**Technical**:
- [ ] Vercel project linked to landing-page repo
- [ ] Custom domain configured (`inzone.app` or wherever)
- [ ] DNS pointing at Vercel
- [ ] HTTPS auto-cert (Vercel handles this)

---

## 8. Notes on what NOT to do

Things that would feel off-brand for a tool like INZONE:

- **No testimonials** until you have real ones. Fake or
  vague-attribution quotes hurt more than they help.
- **No "trusted by" logos** of companies you don't have
  relationships with.
- **No newsletter signup** — you're shipping an MIT desktop
  app, not running a SaaS.
- **No live chat widget** — overkill for an MIT tool.
- **No "Book a demo"** — it's a free download.
- **No comparison table that puts INZONE at ✓✓ across the board.**
  Be honest about where competitors are stronger.
- **No animated parallax stars / particle backgrounds.** Looks
  like 2018 startup template.
- **No autoplaying audio** ever, anywhere, even on the Voice
  section.

---

## 9. Stretch goals (post-v1 of the landing page)

If the v1 page lands well and you want to extend:

- **Documentation site** at `docs.inzone.app` — VitePress or
  Astro, embedded in the same Vercel project. Cover Voice setup,
  MCP server connection, agent authoring, Flow patterns.
- **Recipe gallery** — a `/recipes` page showing curated Flow +
  agent setups for common workflows ("ship a frontend feature,"
  "review a PR end-to-end").
- **Embedded changelog** — pull from GitHub Releases, render as
  a clean timeline. Matches Linear's changelog feel.
- **Roadmap board** — public Trello / Linear-style board showing
  what's coming. Matches the Roadmap section in FEATURES.md.

---

## Final notes

The single most important thing on this page is the hero
visual. Spend 60% of the design budget on the multi-pane
animated mock. Everything else can be 80/20 — the hero has to
sing.

If the visitor reaches the bottom and downloads, the page worked.
If they bounce after the hero, the hero failed. Optimize ruthlessly
for that one transition.
