---
applyTo: '**'
---
UserPrefs: wants improved VS Code settings UI with toggles & inputs; accepts replacing tree view with webview; prefers theme-consistent styling.
History: Migrated settings from TreeDataProvider to WebviewView, added toggle + number input, refined CSS, removed duplicate config contributions, fixed view contribution type, committed changes.

History: Implemented two-way sync for sidebar settings—listen to configuration changes, watch user keybindings.json and media/config.json, refresh on view visibility; added dispose() for watchers; build/tests passed.

History: Overhauled settings webview UI to list-style with right-aligned controls, increased spacing, group dividers, and semi-transparent dependency overlay; added optional `info` field in config.json with hover tooltip in UI; narrowed numeric input width; compile/lint/tests passing.

History: Major refactoring of extension.ts (763→148 lines) following PRD/techspec/plan pattern. Extracted services: HttpService (259 lines), ConfigurationService (375 lines), SchemaInferenceService (274 lines); utilities: StateManager (176 lines), HtmlRenderer (107 lines); providers: BeastModeSettingsWebviewProvider (268 lines). Implemented dependency injection, maintained all functionality, tests passing. Clear separation of concerns achieved.

History: Implemented setting value recommendation indicators feature. Added visual yellow dot indicators when user settings differ from recommended values. Extended data models (SettingDefinition, SettingsState) with recommendation fields. Updated ConfigurationService to parse recommended values from config JSON (supports group-level and individual setting recommendations). Enhanced StateManager with recommendation evaluation logic for all setting types (boolean, number, string, json). Added CSS styling and JavaScript for indicators with tooltips showing recommended values. Includes accessibility support (ARIA labels, keyboard navigation) and uses VS Code theme colors. All existing functionality preserved, comprehensive tests added and passing. Feature documented in README.
