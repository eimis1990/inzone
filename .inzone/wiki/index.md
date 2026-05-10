# Index

The wiki's curated table of contents. Update whenever pages are
added or topics shift — group by **topic**, not by filename. New
entries get filed under the most relevant heading; add new headings
here when an organising theme emerges.

## Foundations

- [[architecture]] — system layout: main / preload / renderer, where state
  lives, how panes spawn, how sessions stay warm across project switches
- [[glossary]] — pane / leaf / tree / lead orchestrator / session pool
  and other domain terms as they're used in this codebase
- [[gotchas]] — landmines we've actually hit (CSS variable scoping,
  sticky thead, cross-project session kills, etc.)

## Decisions

- [[decisions/electron-over-tauri]] — why we stay on Electron
- [[decisions/safestorage-over-keytar]] — why we use Electron's
  built-in encryption rather than the deprecated keytar module
- [[decisions/anthropic-only]] — why INZONE doesn't multi-provider
- [[decisions/elevenlabs-over-whisper]] — voice agent stack choice

## Conventions

- [[conventions/memoisation]] — `React.memo` / `useShallow` patterns

## Performance

- [[perf-measurement]] — protocol for capturing renderer perf
  baselines + the in-app PerfOverlay (⌘⇧P)

## Activity

- [[log]] — chronological journal of wiki activity

## Sources

This is a curated index, so it has no specific source files.
Updated whenever the wiki shape changes.
