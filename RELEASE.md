# Releasing INZONE

INZONE ships as a notarized **direct-download DMG** (and zip for
auto-update) hosted on `updates.inzone.app` — not the Mac App Store.
This avoids App Sandbox restrictions that would break `node-pty`,
project-folder file access, and child-process spawning.

This doc captures everything you need to cut a release. None of it
involves Apple's MAS submission flow.

---

## One-time setup

### Apple Developer account + signing certificate

1. Enroll in the Apple Developer Program (required for notarization).
2. In Xcode → Settings → Accounts → Manage Certificates, create a
   **Developer ID Application** certificate. Download both the
   public cert and the private key into your login Keychain.
3. Verify with `security find-identity -v -p codesigning` — you
   should see a `Developer ID Application: Your Name (TEAMID)` line.

### Notarization credentials

We use Apple's `notarytool` (the modern path; `altool` is
deprecated). You need three values:

- **Apple ID** — your developer account email
- **App-specific password** — generate at appleid.apple.com → Sign-In and Security → App-Specific Passwords
- **Team ID** — visible in your developer account, 10-char alphanumeric

Store these as environment variables for `electron-builder` to
pick up at release time:

```sh
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="ABCD123456"
export CSC_LINK="/path/to/Developer-ID-Application.p12"   # exported cert
export CSC_KEY_PASSWORD="your-p12-password"
```

### Update feed host

Auto-updates are served from a generic static host. Pick one
(Cloudflare R2, S3, plain Nginx, GitHub Releases via a custom
domain) and host these files at `https://updates.inzone.app/mac/<arch>/`:

- `latest-mac.yml` — manifest (electron-builder generates this)
- `INzone-<version>-mac.zip` — the auto-update payload
- `INzone-<version>-arm64.dmg` — for direct download by users

For development you can use `--publish never` and verify locally;
for real releases use `--publish always` to push to your
configured `publish.url`.

If you'd rather use GitHub Releases, swap the `publish` block in
`package.json` to:

```json
"publish": [
  { "provider": "github", "owner": "<gh-user-or-org>", "repo": "<repo>" }
]
```

…and set `GH_TOKEN` instead of standing up your own host.

---

## Release flow

### 1. Bump version

```sh
# Edit package.json's "version" field. Examples:
#   1.0.0 → 1.0.1   patch
#   1.0.0 → 1.1.0   feature
#   1.0.0 → 2.0.0   breaking
git add package.json
git commit -m "chore: release 1.0.1"
git tag v1.0.1
```

### 2. Type-check + lint

```sh
npm run typecheck
```

Fix anything red before continuing.

### 3. Build + package + sign + notarize + publish

```sh
npm run release
```

This runs `electron-vite build` then `electron-builder --mac
--arm64 --x64 --publish always`. Behind the scenes:

- Builds the renderer + preload + main bundles into `out/`
- Packages the app under `dist/`
- Signs with the cert in `CSC_LINK` (hardened-runtime enforced
  via `mac.hardenedRuntime: true` in `package.json`)
- Submits the signed `.app` to Apple via `notarytool`, polls
  until accepted, then staples the ticket to the DMG/zip
- Uploads the DMG + zip + `latest-mac.yml` to the feed URL

Expect ~5–15 minutes. Notarization is the slow step; it's
out-of-our-control queue time on Apple's side.

### 4. Verify the artifacts

After publish, double-check:

```sh
# Stapled?
xcrun stapler validate dist/INzone-1.0.1-arm64.dmg

# Notarization log (shows any embedded warnings):
xcrun notarytool log <submission-id> --keychain-profile <profile>
```

Test the DMG on a clean macOS install — drag to Applications, open
once. If Gatekeeper complains, the staple didn't apply properly.

### 5. Test the update path

The cleanest way: install the previous release, leave it running,
push the new release to the feed, and watch the in-app
"Update ready" dialog appear within 30 seconds. The auto-updater
checks once on launch (after a 5s grace) then every 30 minutes.

---

## Dry-run release (no upload)

To build a signed + notarized package locally without uploading
anything:

```sh
npm run release:dryrun
```

The DMG/zip land in `dist/` for manual testing.

---

## Build without notarization (dev experiments)

If you just want to see if the app still packages without
publishing or going through Apple's queue:

```sh
npm run package
```

This produces a DMG that's signed (if `CSC_LINK` is set) but not
notarized. Won't pass Gatekeeper on a clean machine — only useful
for local smoke tests.

---

## Bundled starter library

`bundled-resources/` is shipped via `extraResources` in the
electron-builder config. The folder lives at
`<INzone.app>/Contents/Resources/bundled-resources` in the packaged
app.

On first launch, `installStarterLibraryIfNeeded()` (in
`src/main/bundled-resources.ts`) copies the contents into
`~/.claude/agents` and `~/.claude/skills`, skipping any files /
folders that already exist. A sentinel file at
`~/.claude/agents/.inzone-starters-installed` records completion so
we never re-copy.

To regenerate the starter library:

1. Edit the source files in `bundled-resources/agents/*.md` or
   `bundled-resources/skills/*/SKILL.md`
2. Bump the app version (so users know they have a newer build)
3. Optional: bump a "starter library version" sentinel format if
   you want existing users to receive new starters — currently we
   never re-copy after the first install

---

## Privacy + permissions

INZONE prompts the user for one OS permission: **microphone**,
when the Voice agent feature is first activated. The string shown
in the system prompt comes from
`build.mac.extendInfo.NSMicrophoneUsageDescription` in
`package.json`.

We don't collect telemetry or send any data to our own servers.
The only network calls INZONE makes are:

- `api.anthropic.com` — Claude Agent SDK / API key validation
- `api.elevenlabs.io` — Voice agent (only if the user enables it)
- The MCP servers the user explicitly adds (Settings → MCP)
- `updates.inzone.app` — auto-update check (every 30 min)
- The `gh` and `claude` CLIs the user has installed locally

If you add anything else, document it here — that list ends up in
the privacy disclosure on the marketing site.

---

## Troubleshooting

**"Module not found: electron-updater"** — run `npm install`.

**Notarization fails with "package not signed"** — check that
`CSC_LINK` points at the right p12 and `CSC_KEY_PASSWORD` matches.
electron-builder logs the exact codesign command in verbose mode
(`DEBUG=electron-builder npm run release`).

**`node-pty` fails to load on a fresh install** — the prebuilt
binary needs to match the Electron version. If you bump Electron
in `package.json`, run `npx electron-rebuild` and republish.

**Auto-update prompts loop on every launch** — `latest-mac.yml`
versions don't match the installed `app.asar`. Re-run `npm run
release` to regenerate manifest + binaries together.
