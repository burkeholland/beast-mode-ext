// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

interface SettingsState {
	autoApprove: boolean;
	maxRequests: number;
}

class UltimateAiSettingsWebviewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'ultimateAiSettings';
	private view?: vscode.WebviewView;

	constructor(private readonly context: vscode.ExtensionContext) {}

	resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.context.extensionUri]
		};
		webviewView.webview.html = this.getHtml(this.getState());

		webviewView.webview.onDidReceiveMessage(async (msg) => {
			switch (msg.type) {
				case 'updateSetting':
					await this.updateSetting(msg.key, msg.value);
					break;
				case 'requestState':
					this.postState();
					break;
			}
		});
	}

	refresh() { this.postState(); }

	private getState(): SettingsState {
		const config = vscode.workspace.getConfiguration();
		return {
			autoApprove: config.get<boolean>('chat.tools.autoApprove', false) ?? false,
			maxRequests: config.get<number>('chat.agent.maxRequests', 5) ?? 5
		};
	}

	private postState() {
		if (this.view) {
			this.view.webview.postMessage({ type: 'state', state: this.getState() });
		}
	}

	private async updateSetting(key: string, value: any) {
		const config = vscode.workspace.getConfiguration();
		if (key === 'chat.agent.maxRequests') {
			const num = Number(value);
			if (!Number.isInteger(num) || num < 1) {
				vscode.window.showErrorMessage('Max Requests must be an integer >= 1');
				this.postState();
				return;
			}
			await config.update(key, num, vscode.ConfigurationTarget.Global);
		} else if (key === 'chat.tools.autoApprove') {
			await config.update(key, !!value, vscode.ConfigurationTarget.Global);
		}
		this.postState();
	}

	private getHtml(state: SettingsState): string {
		const nonce = this.getNonce();
		const csp = [
			`default-src 'none'`,
			`style-src ${this.getWebviewCspSource()} 'unsafe-inline'`,
			`script-src 'nonce-${nonce}'`
		].join('; ');
		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 4px 8px 12px; }
	h2 { font-size: 13px; font-weight: 600; margin: 4px 0 8px; }
	.settings-list { border: 1px solid var(--vscode-tree-indentGuidesStroke, var(--vscode-widget-border, transparent)); border-radius: 6px; overflow: hidden; }
	.setting { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-bottom: 1px solid var(--vscode-tree-indentGuidesStroke, var(--vscode-widget-border, transparent)); }
	.setting:last-child { border-bottom: none; }
	.setting-main { flex: 1; min-width: 0; }
	.setting-main label { font-weight: 500; display: inline-block; margin-bottom: 2px; }
	.desc { font-size: 11px; opacity: .75; line-height: 1.3; }
	input[type=number] { width: 90px; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-widget-border)); border-radius: 4px; padding: 2px 6px; height: 24px; outline: none; }
	input[type=number]:focus { border-color: var(--vscode-focusBorder); box-shadow: 0 0 0 1px var(--vscode-focusBorder); }
	input[type=number].number-invalid { border-color: var(--vscode-inputValidation-errorBorder); box-shadow: 0 0 0 1px var(--vscode-inputValidation-errorBorder); }
	/* Toggle switch */
	.switch { position: relative; display: inline-block; width: 36px; height: 20px; flex-shrink: 0; }
	.switch input { opacity:0; width:0; height:0; }
	.slider { position:absolute; inset:0; cursor:pointer; background: var(--vscode-input-background); transition:.18s ease; border:1px solid var(--vscode-input-border, var(--vscode-widget-border)); border-radius: 20px; box-sizing: border-box; }
	.slider:before { content:""; position:absolute; height:14px; width:14px; left:2px; top:2px; background: var(--vscode-editor-background, #fff); transition:.18s ease; border-radius:50%; box-shadow: 0 1px 2px rgba(0,0,0,.25); }
	.switch input:focus + .slider { outline: 1px solid var(--vscode-focusBorder); }
	.switch input:checked + .slider { background: var(--vscode-button-background, var(--vscode-statusBarItem-prominentBackground)); border-color: var(--vscode-button-border, var(--vscode-button-background)); }
	.switch input:checked + .slider:before { transform: translateX(16px); }
	.switch input:active + .slider:before { width:15px; }
	.setting:hover { background: var(--vscode-list-hoverBackground); }
	@media (prefers-reduced-motion: reduce) { .slider, .slider:before { transition:none; } }
</style>
</head>
<body>
	<h2>Ultimate AI Settings</h2>
	<div class="settings-list">
		<div class="setting">
			<div class="setting-main">
				<label for="autoApprove">Auto Approve</label>
				<div class="desc">Automatically approve tool results without prompting.</div>
			</div>
			<label class="switch" title="Toggle auto approve">
				<input id="autoApprove" type="checkbox" ${state.autoApprove ? 'checked' : ''} />
				<span class="slider"></span>
			</label>
		</div>
		<div class="setting">
			<div class="setting-main">
				<label for="maxRequests">Max Requests</label>
				<div class="desc">Maximum concurrent agent requests.</div>
			</div>
			<input id="maxRequests" type="number" min="1" step="1" value="${state.maxRequests}" />
		</div>
	</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const autoApproveEl = document.getElementById('autoApprove');
const maxReqEl = document.getElementById('maxRequests');

autoApproveEl.addEventListener('change', () => {
	vscode.postMessage({ type: 'updateSetting', key: 'chat.tools.autoApprove', value: autoApproveEl.checked });
});

let maxReqDebounce;
maxReqEl.addEventListener('input', () => {
	clearTimeout(maxReqDebounce);
	const val = maxReqEl.value.trim();
	const num = Number(val);
	if (!Number.isInteger(num) || num < 1) {
		maxReqEl.classList.add('number-invalid');
		return;
	}
	maxReqEl.classList.remove('number-invalid');
	maxReqDebounce = setTimeout(() => {
		vscode.postMessage({ type: 'updateSetting', key: 'chat.agent.maxRequests', value: num });
	}, 300);
});

window.addEventListener('message', e => {
   const message = e.data;
   if (message.type === 'state') {
	   autoApproveEl.checked = message.state.autoApprove;
	   maxReqEl.value = message.state.maxRequests;
   }
});

// In case extension wants updated state
vscode.postMessage({ type: 'requestState' });
</script>
</body>
</html>`;
	}

	private getNonce() {
		const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		let v = '';
		for (let i = 0; i < 16; i++) { v += chars.charAt(Math.floor(Math.random() * chars.length)); }
		return v;
	}

	private getWebviewCspSource() {
		// Convenience wrapper for future adjustments
		return this.view?.webview.cspSource ?? 'vscode-resource:';
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "ultimate-ai" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const settingsWebviewProvider = new UltimateAiSettingsWebviewProvider(context);
	vscode.window.registerWebviewViewProvider(UltimateAiSettingsWebviewProvider.viewType, settingsWebviewProvider);

	context.subscriptions.push(
		vscode.commands.registerCommand('ultimate-ai.helloWorld', () => {
			vscode.window.showInformationMessage('Hello World from Ultimate AI!');
		}),
		vscode.commands.registerCommand('ultimate-ai.refreshSettings', () => settingsWebviewProvider.refresh()),
		vscode.commands.registerCommand('ultimate-ai.toggleAutoApprove', async () => {
			// Retained for backwards compatibility; delegates to webview logic
			const config = vscode.workspace.getConfiguration();
			const current = config.get<boolean>('chat.tools.autoApprove', false);
			await config.update('chat.tools.autoApprove', !current, vscode.ConfigurationTarget.Global);
			settingsWebviewProvider.refresh();
		}),
		vscode.commands.registerCommand('ultimate-ai.setMaxRequests', async () => {
			const config = vscode.workspace.getConfiguration();
			const current = config.get<number>('chat.agent.maxRequests', 5);
			const value = await vscode.window.showInputBox({
				prompt: 'Set Max Requests',
				value: String(current),
				validateInput: (val) => {
					const num = Number(val);
					if (!Number.isInteger(num) || num < 1) {
						return 'Enter an integer >= 1';
					}
					return null;
				}
			});
			if (value) {
				await config.update('chat.agent.maxRequests', Number(value), vscode.ConfigurationTarget.Global);
				settingsWebviewProvider.refresh();
			}
		})
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('chat.tools.autoApprove') || e.affectsConfiguration('chat.agent.maxRequests')) {
				settingsWebviewProvider.refresh();
			}
		})
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}
