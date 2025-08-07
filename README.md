# Ultimate AI (MVP)

Opinionated AI-centric configuration surfaced via a simple Explorer view.

## Features

Dedicated Activity Bar icon ("Ultimate AI") with a settings view listing core AI settings with quick toggle / edit:

* Auto Approve (`chat.tools.autoApprove`) – boolean toggle.
* Max Requests (`chat.agent.maxRequests`) – numeric input (integer ≥ 1).

Keybinding:

* Open Chat In Editor: `Ctrl+Alt+U` → `workbench.action.chat.openInEditor`.

Commands (via Command Palette):

* `Ultimate AI: Toggle Auto Approve`
* `Ultimate AI: Set Max Requests`
* `Ultimate AI: Refresh Settings View`

## Using the View

1. Click the Ultimate AI activity bar icon.
2. Open the "Settings" view.
3. Click
	* Auto Approve item to toggle true/false.
	* Max Requests item to enter a new integer.

Changes apply to User settings (global) immediately and the view refreshes automatically.

## Contributed Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `chat.tools.autoApprove` | boolean | false | Automatically approve AI tool executions. |
| `chat.agent.maxRequests` | number | 5 | Maximum concurrent AI agent requests. |

## Roadmap Ideas

* Grouping & categories.
* Workspace overrides toggle.
* Additional AI workflow shortcuts.
* Status bar indicators.

## Release Notes

### 0.0.1
Initial MVP: settings view, two settings, keybinding.

---
Feedback & suggestions welcome.
