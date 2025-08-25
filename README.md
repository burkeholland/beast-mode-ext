# On By Default (MVP)

Opinionated AI-centric configuration surfaced via a simple Explorer view.

## Features

Dedicated Activity Bar icon ("On By Default") with a settings view listing core AI settings with quick toggle / edit:

* Auto Approve (`chat.tools.autoApprove`) – boolean toggle.
* Max Requests (`chat.agent.maxRequests`) – numeric input (integer ≥ 1).

**Recommendation Indicators**: Settings that have recommended values will show a yellow dot indicator when your current value differs from the recommended best practice. Hover over the indicator to see the recommended value.

Keybinding:

* Open Chat In Editor: `Ctrl+Alt+U` → `workbench.action.chat.openInEditor`.

Commands (via Command Palette):

* `On By Default: Toggle Auto Approve`
* `On By Default: Set Max Requests`
* `On By Default: Refresh Settings View`

## Using the View

1. Click the On By Default activity bar icon.
2. Open the "Settings" view.
3. Click
	* Auto Approve item to toggle true/false.
	* Max Requests item to enter a new integer.

Changes apply to User settings (global) immediately and the view refreshes automatically.

## Contributed (Surfaced) Settings

These settings are surfaced by On By Default (they remain normal VS Code user settings):

| Setting | Type | Description |
|---------|------|-------------|
| `chat.tools.autoApprove` | boolean | Automatically approve AI tool executions. |
| `chat.agent.maxRequests` | number | Maximum concurrent AI agent requests. |
| `chat.commandCenter.enabled` | boolean | Enable the Chat Command Center UI. |
| `chat.todoListTool.enabled` | boolean | Enable experimental TODO list chat tool. |
| `chat.editor.wordWrap` | string | Controls word wrap in chat editors. |
| `github.copilot.chat.agent.enabled` | boolean | Enable the Copilot Chat agent. |
| `github.copilot.nextEditSuggestions.enabled` | boolean | Enable Copilot next edit suggestions. |
| `github.copilot.chat.commitMessageGeneration.instructions` | json | JSON instructions for commit message generation. |
| `githubPullRequests.codingAgent.enabled` | boolean | Enable the GitHub PR Coding Agent. |
| `githubPullRequests.experimental.chat` | boolean | Enable experimental chat in GitHub PRs. |
| `githubPullRequests.codingAgent.autoCommitAndPush` | boolean | Allow coding agent to auto commit & push. |
| `githubPullRequests.codingAgent.uiIntegration` | boolean | Show coding agent UI integration elements. |
| `githubPullRequests.pushBranch` | string | When to push the current branch (always / etc). |
| `workbench.sideBar.location` | string | Location of the primary sidebar. |
| `workbench.activityBar.location` | string | Location of the Activity Bar (default or top). |
| `workbench.secondarySideBar.defaultVisibility` | string | Default visibility of secondary side bar. |
| `workbench.colorTheme` | string | Current color theme. |
| `workbench.iconTheme` | string | File icon theme. |
| `workbench.productIconTheme` | string | Product icon theme. |
| `editor.minimap.enabled` | boolean | Show minimap. |
| `terminal.integrated.tabs.location` | string | Location of terminal tabs. |
| `terminal.integrated.fontFamily` | string | Terminal font family. |
| `terminal.integrated.suggest.quickSuggestions` | json | Terminal quick suggestions config. |
| `git.confirmSync` | boolean | Confirm sync before running. |
| `git.autofetch` | boolean | Auto-fetch remotes. |
| `window.commandCenter` | boolean | Enable command center in title bar. |

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
