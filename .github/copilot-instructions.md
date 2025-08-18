# AI Contributor Instructions (updated)

Purpose: Get an AI coding agent productive quickly in the Beast Mode VS Code extension.

1) Quick architecture snapshot
- TypeScript VS Code extension. Entry: `src/extension.ts` → compiled output `out/extension.js` (built with `tsc`).
- UI surface: single Activity Bar container + webview view (`beastModeSettings`). Contributed in `package.json` under `viewsContainers`/`views`.
- Webview template: `media/settingsWebview.html`. The extension generates a JSON state and inlines it into the template by replacing `%%STATE_JSON%%` (also injects `%%CSP%%` and `%%NONCE%%`).
- Settings metadata is loaded at runtime from either a remote URL configured in `beastMode.remoteConfigUrl` or the bundled `media/config.json`. The loader supports grouped entries and individual setting entries.
- The provider class: `BeastModeSettingsWebviewProvider` (in `src/extension.ts`). It owns state generation, HTML rendering, and message handlers.

2) Runtime patterns & important behaviors
- Activation: `activationEvents` is empty; extension registers the `WebviewViewProvider` immediately on activation (see `activate()` in `src/extension.ts`).
- State injection: `postState()` builds a `SettingsState` and sets `webview.html` to the templated HTML with the state JSON inlined. The view receives messages via `webview.onDidReceiveMessage(...)`.
- Message surface: handled message types are `ready`, `updateSetting`, and `installExtensions`. Implement or extend handlers in `handleMessage()`.
- Remote config fetching: `fetchAndCacheRemoteConfig()` resolves raw URLs (supports gist.github.com), fetches JSON, caches it to global storage (etag-aware), and falls back to `media/config.json` on error.
- Schema inference: `inferDefinitionFromSchema()` looks up configuration schema from installed extensions (via `vscode.extensions.all` and `packageJSON.contributes.configuration`) to infer types, enums, ranges, and required extension IDs.
- Security: each render builds a CSP that uses a generated nonce. Only the inline script with that nonce is allowed. When touching HTML injection or loading external resources, update CSP in `getHtml()` accordingly.
- Persistence: setting updates call `vscode.workspace.getConfiguration().update(key, value, ConfigurationTarget.Global)` — always user scope.
- Watchers: `startExternalWatchers()` listens to configuration changes, extension changes, and filesystem changes to `media/config.json` and triggers refreshes.
- Resilience: FS/network/JSON ops are wrapped in try/catch and intentionally degrade silently (cached fallback); keep similar behavior unless adding explicit diagnostics.

3) Project-specific conventions
- Runtime config format: supports two shapes when loading config JSON:
  - Grouped form: { "group": "Group Name", "settings": [ { "key": "x.y", "description": "..." }, ... ] }
  - Single entry form: { "key": "x.y", "description": "...", "group": "Group Name" }
  The loader will enrich entries via schema inference and optional `requires` fields. If adding settings, prefer updating `media/config.json` (or the remote source).
- Do NOT expect a static `settingDefinitions` array in source—definitions are constructed at runtime from config + schema inference.
- Keybindings: this codebase currently does NOT write user keybindings. Do not add keybinding-write logic unless you update README and tests and preserve current synchronous-write patterns elsewhere.
- Numeric validation: when prompting users (e.g. `beast-mode.setMaxRequests`) the extension uses simple regex validation. If adding UI numeric inputs, mirror the same validation pattern.

4) Build / test / debug workflows
- Install deps: `npm install`.
- Dev: `npm run watch` (runs `tsc -w`) — there is a workspace task `npm: watch` available in the workspace tasks list.
- One-off compile: `npm run compile` (also run prepublish).
- Lint: `npm run lint` (eslint over `src`). Fix lint issues before committing.
- Tests: `npm test` runs the VS Code test harness (`vscode-test`). Unit tests live under `test/` (example: `test/extension.test.ts`).
- Debugging: run extension in Extension Development Host via VS Code launch configuration (default for VS Code extension projects). When iterating on webview HTML, reload the extension host or call the `beast-mode.refreshSettings` command.

5) Files & code locations to inspect when changing behavior
- `src/extension.ts` — provider, message handling, config loading, watchers, activation hooks.
- `media/settingsWebview.html` — webview UI template and script that consumes `%%STATE_JSON%%`.
- `media/config.json` — bundled settings metadata (fallback/primary source when remote is unavailable).
- `package.json` — contributions (commands, views), scripts, and `beastMode.remoteConfigUrl` default.
- `README.md` — contains the "Contributed Settings" table and extension usage details.

(End)
