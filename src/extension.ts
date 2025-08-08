import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface SettingDefinition {
	key: string;
	type: 'boolean' | 'number' | 'string' | 'json';
	title?: string;
	description: string;
	group: string;
	min?: number;
	max?: number;
	step?: number;
	// For string enums, provide available options
	options?: Array<{ value: string; label?: string }>;
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

class BeastModeSettingsWebviewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'ultimateAiSettings';
	private view?: vscode.WebviewView;
	private disposables: vscode.Disposable[] = [];

	constructor(private readonly context: vscode.ExtensionContext) {}

	private settingDefinitions: SettingDefinition[] = [];

	private configKeybindings: { command: string; title?: string; default?: string; when?: string }[] = [];

	private ensureLoadedFromConfig() {
		try {
			const cfgPath = path.join(this.context.extensionPath, 'media', 'config.json');
			if (fs.existsSync(cfgPath)) {
				const raw = fs.readFileSync(cfgPath, 'utf8');
				const json = JSON.parse(raw);
				if (Array.isArray(json?.settings)) {
					// json.settings can be minimal entries: { key, title?, description?, group? }
					const defs: SettingDefinition[] = [];
					for (const entry of json.settings) {
						if (!entry?.key || typeof entry.key !== 'string') {
							continue;
						}
						const enriched = this.inferDefinitionFromSchema(
							entry.key,
							entry.title,
							entry.description,
							entry.group,
							entry.type,
							entry.options,
							entry.min,
							entry.max,
							entry.step
						);
						defs.push(enriched);
					}
					if (defs.length) {
						this.settingDefinitions = defs;
					}
				}
				if (Array.isArray(json?.keybindings)) {
					this.configKeybindings = json.keybindings as any[];
				}
			}
		} catch {
			// ignore and keep defaults
		}
	}

	private inferDefinitionFromSchema(
		key: string,
		title?: string,
		description?: string,
		groupOverride?: string,
		typeOverride?: SettingDefinition['type'],
		optionsOverride?: Array<{ value: string; label?: string }>,
		minOverride?: number,
		maxOverride?: number,
		stepOverride?: number
	): SettingDefinition {
		const schema = this.findConfigSchemaForKey(key);
		const group = groupOverride || this.deriveGroupFromKey(key);
	const label = title || key.split('.').slice(-1)[0];
		let type: SettingDefinition['type'] = 'string';
		let options: Array<{ value: string; label?: string }> | undefined;
		let min: number | undefined;
		let max: number | undefined;
		let step: number | undefined;
		if (schema) {
			const sType = Array.isArray(schema.type) ? schema.type[0] : schema.type;
			if (sType === 'boolean') {
				type = 'boolean';
			} else if (sType === 'number' || sType === 'integer') {
				type = 'number';
				step = sType === 'integer' ? 1 : undefined;
			} else if (sType === 'object' || sType === 'array') {
				type = 'json';
			} else {
				type = 'string';
			}
			if (schema.enum && Array.isArray(schema.enum)) {
				options = schema.enum.map((v: any, i: number) => ({ value: String(v), label: Array.isArray(schema.enumDescriptions) ? schema.enumDescriptions[i] : undefined }));
			} else if (schema.oneOf || schema.anyOf) {
				const alts = (schema.oneOf || schema.anyOf) as any[];
				const enums = alts
					.filter(e => e?.const !== undefined || e?.enum)
					.map(e => e.const ?? (Array.isArray(e.enum) ? e.enum[0] : undefined))
					.filter((v: any) => v !== undefined);
				if (enums && enums.length) {
					options = enums.map((v: any) => ({ value: String(v) }));
				}
			}
			if (typeof schema.minimum === 'number') {
				min = schema.minimum;
			}
			if (typeof schema.maximum === 'number') {
				max = schema.maximum;
			}
		}
		// Fallback: infer type from current/default value via configuration.inspect()
		if (!schema || !type || type === 'string') {
			try {
				const info = this.getConfiguration().inspect<any>(key);
				const sample = info?.globalValue ?? info?.workspaceValue ?? info?.workspaceFolderValue ?? info?.defaultValue;
				if (sample !== undefined) {
					const t = typeof sample;
					if (t === 'boolean') {
						type = 'boolean';
					} else if (t === 'number') {
						type = 'number';
						if (Number.isInteger(sample) && step === undefined) {
							step = 1;
						}
					} else if (t === 'object' && sample !== null) {
						type = 'json';
					} else {
						type = 'string';
					}
				}
			} catch { /* ignore */ }
		}

		// Apply explicit overrides from config.json (highest precedence)
		if (typeOverride) {
			type = typeOverride;
		}
		if (optionsOverride && optionsOverride.length) {
			options = optionsOverride.map(o => ({ value: String(o.value), label: o.label }));
		}
		if (minOverride !== undefined) { min = minOverride; }
		if (maxOverride !== undefined) { max = maxOverride; }
		if (stepOverride !== undefined) { step = stepOverride; }
		// No internal fallbacks: enums/options should come from config.json or schema only
		return {
			key,
			type,
			title: label,
			description: description || label,
			group,
			min, max, step,
			options
		};
	}

	private findConfigSchemaForKey(key: string): any | undefined {
		for (const ext of vscode.extensions.all) {
			const contrib = (ext.packageJSON?.contributes as any) || {};
			const config = contrib.configuration;
			if (!config) {
				continue;
			}
			const buckets = Array.isArray(config) ? config : [config];
			for (const bucket of buckets) {
				const props = bucket?.properties;
				if (props && Object.prototype.hasOwnProperty.call(props, key)) {
					return props[key];
				}
			}
		}
		return undefined;
	}

	private deriveGroupFromKey(key: string): string {
		const first = key.split('.')[0];
	if (first === 'github') { return 'GitHub Copilot'; }
	if (first === 'githubPullRequests') { return 'GitHub PRs'; }
	if (first === 'terminal') { return 'Terminal'; }
	if (first === 'workbench') { return 'Workbench'; }
	if (first === 'editor') { return 'Editor'; }
	if (first === 'chat') { return 'Chat'; }
	if (first === 'git') { return 'Git'; }
	if (first === 'window') { return 'Window'; }
		return first.charAt(0).toUpperCase() + first.slice(1);
	}

	resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, 'media'))]
		};
		webviewView.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
	this.ensureLoadedFromConfig();
		// Re-render when the view becomes visible again (keeps in sync with outside changes)
		this.disposables.push(
			webviewView.onDidChangeVisibility(() => {
				if (webviewView.visible) {
					this.postState();
				}
			})
		);
		this.postState();
	}

	/** Expose a safe refresh to re-render the webview */
	public refresh() {
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
		const mergedList: any[] = [];
		// Start with config-provided entries (if any)
		for (const kb of this.configKeybindings) {
			mergedList.push({ command: kb.command, key: kb.default, when: kb.when });
		}
		// Then add any declared keybindings not already present
		for (const kb of declared) {
			if (!mergedList.find(m => m.command === kb.command)) {
				mergedList.push(kb);
			}
		}
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
		return mergedList.map(kb => {
			const cmdMeta = commands.find(c => c.command === kb.command);
			const cfgMeta = this.configKeybindings.find(c => c.command === kb.command);
			return {
				command: kb.command,
				title: cfgMeta?.title || cmdMeta?.title || kb.command,
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

	/** Begin watching external sources that can affect our state (config, keybindings, config.json) */
	public startExternalWatchers() {
		// 1) Configuration changes: only refresh if relevant settings changed
		this.disposables.push(
			vscode.workspace.onDidChangeConfiguration(e => {
				// If any tracked setting key is affected, refresh
				const affected = this.settingDefinitions.some(def => e.affectsConfiguration(def.key));
				if (affected) {
					this.postState();
				}
			})
		);

		// 2) User keybindings.json changes
		const kbPath = this.getUserKeybindingsPath();
		if (kbPath && fs.existsSync(kbPath)) {
			try {
				const watcher = fs.watch(kbPath, { persistent: false }, () => {
					// Debounce minimal: schedule postState on microtask to collapse bursts
					setTimeout(() => this.postState(), 50);
				});
				this.disposables.push(new vscode.Disposable(() => watcher.close()));
			} catch {
				// Fallback to watchFile if fs.watch fails
				fs.watchFile(kbPath, { interval: 1000 }, () => this.postState());
				this.disposables.push(new vscode.Disposable(() => fs.unwatchFile(kbPath)));
			}
		}

		// 3) Our own media/config.json (setting definitions / kb list) changes
		const cfgPath = path.join(this.context.extensionPath, 'media', 'config.json');
		if (fs.existsSync(cfgPath)) {
			try {
				const watcher = fs.watch(cfgPath, { persistent: false }, () => {
					// Reload definitions and re-render
					this.ensureLoadedFromConfig();
					this.postState();
				});
				this.disposables.push(new vscode.Disposable(() => watcher.close()));
			} catch {
				fs.watchFile(cfgPath, { interval: 1000 }, () => {
					this.ensureLoadedFromConfig();
					this.postState();
				});
				this.disposables.push(new vscode.Disposable(() => fs.unwatchFile(cfgPath)));
			}
		}
	}

	public dispose() {
		for (const d of this.disposables.splice(0)) {
			try { d.dispose(); } catch { /* ignore */ }
		}
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
	const provider = new BeastModeSettingsWebviewProvider(context);
	// Ensure provider disposes resources on deactivate
	context.subscriptions.push(provider);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(BeastModeSettingsWebviewProvider.viewType, provider)
	);

	// Keep webview synchronized with external changes
	provider.startExternalWatchers();

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
