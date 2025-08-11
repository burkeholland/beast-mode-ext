# AI Contributor Instructions

Purpose: Help an AI agent rapidly extend and maintain this VS Code extension ("Beast Mode") that surfaces opinionated AI-centric settings in a dedicated Activity Bar webview.

## 1. Architecture Snapshot
- TypeScript VS Code extension. Entry: `src/extension.ts`; compiled JS emitted to `out/` via `tsc` (see `tsconfig.json`).
- No `activationEvents` declared → extension loads immediately and registers a single `WebviewViewProvider` (`beastModeSettings`).
- UI: Static HTML template at `media/settingsWebview.html` loaded, then placeholders replaced: `%%CSP%%`, `%%NONCE%%`, `%%STATE_JSON%%`.
- State object shape (`SettingsState`) = `{ settings, definitions, groups, keybindings }` regenerated on every change and inlined as JSON (no message passing after initial full render besides user->extension messages).
- Settings metadata lives in code (`settingDefinitions` array) – this is the single source of truth for what appears in the view (not contributed via `package.json`).
- Keybindings list is derived dynamically from `package.json.contributes.commands` + `package.json.contributes.keybindings` plus user overrides parsed from the user-level `keybindings.json`.

## 2. Core Patterns & Conventions
- Adding a new toggle/input: append to `settingDefinitions`; pick an existing `group` or create a new one (groups are auto-collected from definitions). Then update README table manually (no generation script).
- All setting updates use `vscode.workspace.getConfiguration().update(key, value, Global)` → always user scope (no workspace overrides UI).
- Numeric inputs: enforce integer via `validateInput` regex before updating.
- Keybinding updates: extension writes directly to the user `keybindings.json`; previous entries for the command are removed, new one appended (higher priority). Keep write operations minimal & synchronous (`fs.writeFileSync`).
- HTML security: CSP assembled each render; only inline script with nonce allowed. When adding external resources, adjust CSP in `getHtml` carefully.
- Resilience: File system + JSON parse operations wrapped in try/catch and intentionally ignore failures (silent fallback). Maintain that style unless adding explicit diagnostics.

## 3. Build, Lint, Test Workflow
- Install deps: `npm install`.
- Dev compile (watch): `npm run watch` (Task: `npm: watch`).
- One-off build: `npm run compile` (automatically run before publish via `vscode:prepublish`).
- Lint: `npm run lint` (eslint over `src`). Fix issues before commit; keep stylistic changes scoped.
- Tests: minimal Mocha suite (`src/test/extension.test.ts`) executed with VS Code test harness via `npm test`. Add new tests mirroring existing style (simple `assert` checks) when changing settings logic or keybinding handling.

## 4. Extending Functionality (Examples)
- New Setting Example: Add `{ key: 'editor.minimap.enabled', type: 'boolean', description: 'Controls whether the minimap is shown.', group: 'Editor' }` to `settingDefinitions` (pattern already present). State propagation happens automatically.
- New Command + Keybinding: Add to `contributes.commands` and `contributes.keybindings` in `package.json`; the webview will list it without further code changes because `collectKeybindings()` reads both.
- Additional State Data: Extend `SettingsState` interface and include new field in `postState()`; inject into template via the existing `%%STATE_JSON%%` replacement.

## 5. Testing & Validation Focus Areas
- After changing definitions or command contributions: rebuild (`compile` or watch) and verify the settings webview loads without errors and displays the new entries.
- When touching keybinding logic, test both default (declared) and overridden (modify user `keybindings.json`) scenarios; ensure most recent override appears as `current`.
- Confirm CSP still blocks unintended inline scripts when altering HTML injection logic.

## 6. Release Hygiene
- Bump `version` in `package.json` (semver) for any user-visible change.
- Run `npm run compile` + `npm test` + `npm run lint` before tagging.
- Update README "Contributed Settings" table if settings list changed.

## 7. Guardrails / Do Not
- Do NOT add settings only to README; they must exist in `settingDefinitions` or they won’t render.
- Avoid asynchronous file writes for keybindings – ordering matters; keep current synchronous pattern unless refactoring comprehensively.
- Don’t introduce workspace-scoped updates unless also updating UI/README to clarify scope differences.

## 8. Quick Reference
- Entry point: `src/extension.ts`
- Webview provider class: `BeastModeSettingsWebviewProvider`
- Template: `media/settingsWebview.html`
- Settings list source: `settingDefinitions` (same file)
- Tests: `src/test/extension.test.ts`

(End)
