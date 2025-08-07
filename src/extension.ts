import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface SettingDefinition {
	key: string;
	type: 'boolean' | 'number' | 'string';
	description: string;
	group: string;
	min?: number;
	max?: number;
	step?: number;
}

interface KeybindingEntry {
	command: string;
	title: string;
	default?: string;
	when?: string;
	current?: string;
}

interface SettingsState {
	settings: Record<string, any>;
	definitions: SettingDefinition[];
	groups: string[];
	keybindings: KeybindingEntry[];
}

class UltimateAiSettingsWebviewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'ultimateAiSettings';
	private view?: vscode.WebviewView;

	constructor(private readonly context: vscode.ExtensionContext) {}

	private readonly settingDefinitions: SettingDefinition[] = [
		{ key: 'chat.tools.autoApprove', type: 'boolean', description: 'Automatically approve tool results without prompting.', group: 'Chat Agent' },
		{ key: 'chat.agent.maxRequests', type: 'number', description: 'Maximum concurrent agent requests.', group: 'Chat Agent', min: 1, step: 1 },
		{ key: 'workbench.sideBar.location', type: 'string', description: 'Location of the primary sidebar (left or right).', group: 'Workbench' },
		{ key: 'workbench.colorTheme', type: 'string', description: 'Current color theme.', group: 'Appearance' },
		{ key: 'editor.minimap.enabled', type: 'boolean', description: 'Controls whether the minimap is shown.', group: 'Editor' },
		{ key: 'terminal.integrated.tabs.location', type: 'string', description: 'Location of the terminal tabs (left|right).', group: 'Terminal' },
	];

	resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, 'media'))]
		};
		webviewView.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
		this.postState();
	}

	private handleMessage(message: any) {
		switch (message.type) {
			case 'ready':
				this.postState();
				break;
			case 'updateSetting':
				this.updateSetting(message.key, message.value);
				break;
			case 'updateKeybinding':
				this.updateKeybinding(message.command, message.key);
				break;
		}
	}

	private getConfiguration() {
		return vscode.workspace.getConfiguration();
	}

	private postState() {
			if (!this.view) {
				return;
			}
		const state: SettingsState = {
			settings: this.collectCurrentSettings(),
			definitions: this.settingDefinitions,
			groups: Array.from(new Set(this.settingDefinitions.map(d => d.group))),
			keybindings: this.collectKeybindings()
		};
		this.view.webview.html = this.getHtml(state);
	}

	private collectCurrentSettings(): Record<string, any> {
		const config = this.getConfiguration();
		const out: Record<string, any> = {};
		for (const def of this.settingDefinitions) {
			out[def.key] = config.get(def.key);
		}
		return out;
	}

	private collectKeybindings(): KeybindingEntry[] {
		const contrib = vscode.extensions.getExtension(this.context.extension.id)?.packageJSON?.contributes;
		const declared: any[] = contrib?.keybindings || [];
		const commands: any[] = contrib?.commands || [];
		// Attempt to read user keybindings.json to get overrides
		let overrides: Record<string, string> = {};
		const userKbPath = this.getUserKeybindingsPath();
		if (userKbPath && fs.existsSync(userKbPath)) {
			try {
				const raw = fs.readFileSync(userKbPath, 'utf8');
				const sanitized = raw.replace(/\/\*[\s\S]*?\*\/|(^|\n)\s*\/\/.*$/g, '$1');
				const arr = JSON.parse(sanitized);
				if (Array.isArray(arr)) {
					for (const e of arr) {
									if (e && e.command && e.key) {
										overrides[e.command] = e.key;
									}
					}
				}
			} catch { /* ignore */ }
		}
		return declared.map(kb => {
			const cmdMeta = commands.find(c => c.command === kb.command);
			return {
				command: kb.command,
				title: cmdMeta?.title || kb.command,
				default: kb.key,
				when: kb.when,
				current: overrides[kb.command] || kb.key
			} as KeybindingEntry;
		});
	}

	private getUserKeybindingsPath(): string | undefined {
		const appName = process.platform === 'darwin' ? 'Code' : (process.env.VSCODE_CWD?.includes('oss') ? 'Code - OSS' : 'Code');
		const home = process.env.HOME || process.env.USERPROFILE;
			if (!home) {
				return undefined;
			}
			if (process.platform === 'win32') {
				return path.join(home, 'AppData', 'Roaming', appName, 'User', 'keybindings.json');
			}
			if (process.platform === 'darwin') {
				return path.join(home, 'Library', 'Application Support', appName, 'User', 'keybindings.json');
			}
		return path.join(home, '.config', appName, 'User', 'keybindings.json');
	}

	private async updateSetting(key: string, value: any) {
		await this.getConfiguration().update(key, value, vscode.ConfigurationTarget.Global);
		this.postState();
	}

	private async updateKeybinding(command: string, key: string) {
		const filePath = this.getUserKeybindingsPath();
		if (!filePath) {
			vscode.window.showErrorMessage('Unable to resolve user keybindings path');
			return;
		}
		let content = '[]';
		try { if (fs.existsSync(filePath)) { content = fs.readFileSync(filePath, 'utf8'); } } catch { /* ignore */ }
		const sanitized = content.replace(/\/\*[\s\S]*?\*\/|(^|\n)\s*\/\/.*$/g, '$1');
		let arr: any[] = [];
		try { const parsed = JSON.parse(sanitized); if (Array.isArray(parsed)) { arr = parsed; } } catch { /* ignore */ }
		// Remove prior entries for command so new one is last (highest priority)
		arr = arr.filter(e => e && e.command !== command);
		arr.push({ key, command });
		const newText = JSON.stringify(arr, null, 2);
		try {
			fs.writeFileSync(filePath, newText, 'utf8');
			vscode.window.showInformationMessage(`Keybinding updated: ${key} → ${command}`);
		} catch (e:any) {
			vscode.window.showErrorMessage('Failed to write keybindings.json: ' + (e?.message || e));
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
		const templatePath = path.join(this.context.extensionPath, 'media', 'settingsWebview.html');
		let html: string;
		try {
			html = fs.readFileSync(templatePath, 'utf8');
		} catch (e) {
			return `<html><body><h3>Failed to load settings template.</h3><pre>${(e as any)?.message || e}</pre></body></html>`;
		}
		return html
			.replace(/%%CSP%%/g, csp)
			.replace(/%%NONCE%%/g, nonce)
			.replace(/%%STATE_JSON%%/g, () => JSON.stringify(state));
	}

	private getWebviewCspSource() {
		return this.view?.webview.cspSource || 'vscode-resource:';
	}

	private getNonce() {
		let text = '';
		const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		for (let i = 0; i < 32; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}
}

export function activate(context: vscode.ExtensionContext) {
	const provider = new UltimateAiSettingsWebviewProvider(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(UltimateAiSettingsWebviewProvider.viewType, provider)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('beast-mode.refreshSettings', () => provider['postState']?.())
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('beast-mode.toggleAutoApprove', async () => {
			const config = vscode.workspace.getConfiguration();
			const cur = config.get<boolean>('chat.tools.autoApprove');
			await config.update('chat.tools.autoApprove', !cur, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`Auto Approve is now ${!cur ? 'Enabled' : 'Disabled'}`);
			provider['postState']?.();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('beast-mode.setMaxRequests', async () => {
			const config = vscode.workspace.getConfiguration();
			const cur = config.get<number>('chat.agent.maxRequests') || 1;
			const val = await vscode.window.showInputBox({
				title: 'Set Max Agent Requests',
				value: String(cur),
				validateInput: v => /^(\d+)$/.test(v) ? undefined : 'Enter a positive integer'
			});
			if (val) {
				await config.update('chat.agent.maxRequests', parseInt(val, 10), vscode.ConfigurationTarget.Global);
				provider['postState']?.();
			}
		})
	);
}

export function deactivate() {}
