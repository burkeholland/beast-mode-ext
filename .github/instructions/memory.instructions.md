---
applyTo: '**'
---
UserPrefs: wants improved VS Code settings UI with toggles & inputs; accepts replacing tree view with webview; prefers theme-consistent styling.
History: Migrated settings from TreeDataProvider to WebviewView, added toggle + number input, refined CSS, removed duplicate config contributions, fixed view contribution type, committed changes.

History: Implemented two-way sync for sidebar settings—listen to configuration changes, watch user keybindings.json and media/config.json, refresh on view visibility; added dispose() for watchers; build/tests passed.

History: Overhauled settings webview UI to list-style with right-aligned controls, increased spacing, group dividers, and semi-transparent dependency overlay; added optional `info` field in config.json with hover tooltip in UI; narrowed numeric input width; compile/lint/tests passing.
