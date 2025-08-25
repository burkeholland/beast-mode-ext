import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { URL } from 'url';

/**
 * Lightweight shape describing how settings will be rendered in the webview.
 * This is intentionally minimal and self-explanatory.
 */
interface SettingDefinition {
	key: string;
	type: 'boolean' | 'number' | 'string' | 'json';
	title?: string;
	description?: string;
	group: string;
	min?: number;
	max?: number;
	step?: number;
	options?: Array<{ value: string; label?: string }>;
	requires?: string[];
	missingExtensions?: string[]; // computed at render time
	info?: string;
	default?: any; // optional default value suggested by remote config or inferred
}

interface SettingsState {
	settings: Record<string, any>;
	definitions: SettingDefinition[];
	groups: string[];
}

/**
 * Webview provider responsible for:
 * - loading settings metadata (remote or bundled)
 * - enriching settings using installed extension schemas + live values
 * - exposing those settings to the webview and applying user changes
 */
class OnByDefaultSettingsWebviewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'onByDefaultSettings';

	private view?: vscode.WebviewView;
	private disposables: vscode.Disposable[] = [];
	private settingDefinitions: SettingDefinition[] = [];
	private pollTimer?: NodeJS.Timeout;
	private readonly POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
	private readonly GLOBAL_PENDING_KEY = 'remoteConfig.hasPendingChanges';
	private readonly GLOBAL_LAST_RAW = 'remoteConfig.lastRawText';
	private readonly GLOBAL_LAST_CHECKED = 'remoteConfig.lastChecked';

	constructor(private readonly context: vscode.ExtensionContext) {}

	// -------------------------
	// Public lifecycle methods
	// -------------------------

	/** Register and initialize the webview when it's resolved by VS Code. */
	public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
		this.view = webviewView;
		this.view.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, 'media'))]
		};

		this.view.webview.onDidReceiveMessage(msg => this.handleMessage(msg));

		// Load definitions (remote or bundled) and render.
		await this.loadDefinitionsFromConfigSources();
		// Kick off polling for remote config changes
		this.startPollingRemoteConfig();
		this.postState();

		// Refresh when the view becomes visible again.
		this.view.onDidChangeVisibility(() => { if (this.view?.visible) { this.postState(); } });
	}

	/** Start file / extension / configuration watchers used to refresh the UI. */
	public startExternalWatchers() {
		// Refresh when user configuration changes for any of our known keys.
		this.disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
			const affected = this.settingDefinitions.some(def => e.affectsConfiguration(def.key));
			if (affected) {
				this.postState();
			}

			// If the remote-config URL changes, reload definitions.
			if (e.affectsConfiguration && e.affectsConfiguration('onByDefault.remoteConfigUrl')) {
				void (async () => {
					await this.loadDefinitionsFromConfigSources();
					this.postState();
				})();
			}
		}));

		// Refresh when extensions are installed/uninstalled (schema availability may change).
		this.disposables.push(vscode.extensions.onDidChange(() => this.postState()));

		// Watch bundled config.json so local edits show up instantly during development.
		const cfgPath = path.join(this.context.extensionPath, 'media', 'config.json');
		if (fs.existsSync(cfgPath)) {
			try {
				const watcher = fs.watch(cfgPath, { persistent: false }, async () => {
					await this.loadDefinitionsFromConfigSources();
					this.postState();
				});
				this.disposables.push(new vscode.Disposable(() => watcher.close()));
			} catch (e) {
				// Fallback to fs.watchFile if fs.watch fails on some environments.
				fs.watchFile(cfgPath, { interval: 1000 }, async () => {
					await this.loadDefinitionsFromConfigSources();
					this.postState();
				});
				this.disposables.push(new vscode.Disposable(() => fs.unwatchFile(cfgPath)));
			}
		}
		// Ensure polling also starts when external watchers are started
		this.startPollingRemoteConfig();
	}

	/** Dispose watchers and cleanup. */
	public dispose() {
		for (const d of this.disposables.splice(0)) {
			try { d.dispose(); } catch { /* ignore */ }
		}
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = undefined;
		}
	}

	// -------------------------
	// Messaging & state
	// -------------------------

	/** Handle messages from the webview (ready + setting updates). */
	private async handleMessage(message: any) {
		switch (message?.type) {
			case 'ready':
				this.postState();
				break;
			case 'refreshRemoteConfig':
				// User requested to refresh and accept remote changes
				await this.loadDefinitionsFromConfigSources();
				// Clear pending flag
				try { await this.context.globalState.update(this.GLOBAL_PENDING_KEY, false); } catch {}
				try { await this.context.globalState.update(this.GLOBAL_LAST_RAW, null); } catch {}
				this.postState();
				break;
			case 'checkRemoteNow':
				// User requested an immediate check for remote updates (do not accept/apply automatically)
				await this.checkRemoteNow();
				break;
			case 'updateSetting':
				if (typeof message.key === 'string') {
					await this.updateSetting(message.key, message.value);
				}
				break;
			case 'installExtensions':
				// Keep a minimal, resilient installer flow (UI may request a convenience install).
				if (Array.isArray(message.ids) && message.ids.length) {
					await this.installExtensions(message.ids);
				}
				break;
			default:
				// Unknown message types are ignored intentionally.
				break;
		}
	}

	/** Gather current values for all definitions from the user's configuration. */
	private collectCurrentSettings(): Record<string, any> {
		const config = vscode.workspace.getConfiguration();
		const out: Record<string, any> = {};
		for (const def of this.settingDefinitions) {
			out[def.key] = config.get(def.key);
		}
		return out;
	}

	/** Build the state object and send it to the webview by replacing the HTML template. */
	private postState() {
		if (!this.view) { return; }

		const defsWithAvailability = this.settingDefinitions.map(d => {
			const requires = Array.isArray(d.requires) ? d.requires : [];
			const missing = requires.filter(id => !vscode.extensions.getExtension(id));
			return { ...d, missingExtensions: missing } as SettingDefinition;
		});

		const pending = !!this.context.globalState.get<boolean>(this.GLOBAL_PENDING_KEY);
		const lastChecked = this.context.globalState.get<string | null>(this.GLOBAL_LAST_CHECKED) || null;
		// Inject a lightweight flag into the state so UI can show indicator
		const state: SettingsState & { remotePending?: boolean } = {
			settings: this.collectCurrentSettings(),
			definitions: defsWithAvailability,
			groups: Array.from(new Set(defsWithAvailability.map(d => d.group)))
		} as any;
		(state as any).remotePending = pending;
		// Provide lastChecked timestamp (ISO) for UI display
		if (lastChecked) { (state as any).remoteLastChecked = lastChecked; }

		this.view.webview.html = this.renderHtml(state);
	}

	// -------------------------
	// Remote config fetching
	// -------------------------

	/**
	 * Load definitions from: remote url (onByDefault.remoteConfigUrl) OR the bundled media/config.json
	 * The loader understands grouped and single-entry formats and will enrich definitions via schema inference.
	 */
	private async loadDefinitionsFromConfigSources(): Promise<void> {
		try {
			const remoteUrl = (vscode.workspace.getConfiguration().get<string>('onByDefault.remoteConfigUrl') || '').trim();
			let json: any = null;
			if (remoteUrl) {
				json = await this.fetchAndCacheRemoteConfig(remoteUrl);
			}

			if (!json) {
				// Fallback to bundled config
				const cfgPath = path.join(this.context.extensionPath, 'media', 'config.json');
				if (fs.existsSync(cfgPath)) {
					const raw = fs.readFileSync(cfgPath, 'utf8');
					try { json = JSON.parse(raw); } catch { json = null; }
				}
			}

			// Normalize incoming JSON into SettingDefinition[] using schema inference.
			const defs: SettingDefinition[] = [];
			if (json && Array.isArray(json.settings)) {
				for (const entry of json.settings) {
					if (!entry) { continue; }
					// Grouped form: { group, settings: [...] }
					if (typeof entry.group === 'string' && Array.isArray(entry.settings)) {
						const groupName = entry.group;
						const groupRequires = this.normalizeRequires(entry.requires || entry.requiresExtensions || entry.requiresExtension);
						for (const s of entry.settings) {
							if (!s || typeof s.key !== 'string') { continue; }
							const enriched = this.inferDefinitionFromSchema(
								s.key,
								s.title,
								s.description,
								groupName,
								s.type,
								s.options,
								s.min,
								s.max,
								s.step,
								this.mergeRequires(groupRequires, this.normalizeRequires(s.requires || s.requiresExtensions || s.requiresExtension))
							);
							if (typeof s.info === 'string') { enriched.info = s.info; }
							defs.push(enriched);
						}
						continue;
					}

					// Single entry form: { key, ... }
					if (typeof entry.key === 'string') {
						const enriched = this.inferDefinitionFromSchema(
							entry.key,
							entry.title,
							entry.description,
							entry.group,
							entry.type,
							entry.options,
							entry.min,
							entry.max,
							entry.step,
							this.normalizeRequires(entry.requires || entry.requiresExtensions || entry.requiresExtension)
						);
						if (typeof (entry as any).info === 'string') { enriched.info = (entry as any).info; }
						defs.push(enriched);
					}
				}
			}

			if (defs.length) { 
				this.settingDefinitions = defs;
				// Apply defaults for any newly discovered settings (without overwriting user-set values)
				try { await this.applyDefaultsToUserSettings(defs); } catch { /* ignore */ }
			}
		} catch {
			// Fail silently — degrade gracefully to existing definitions (if any).
		}
	}

	/** Start a periodic poller that checks the remote config raw text for changes. */
	private startPollingRemoteConfig() {
		if (this.pollTimer) { return; }

		const doCheck = async () => {
			try {
				const remoteUrl = (vscode.workspace.getConfiguration().get<string>('onByDefault.remoteConfigUrl') || '').trim();
				if (!remoteUrl) { return; }
				const effective = (await this.resolveToRawUrl(remoteUrl)) || remoteUrl;
				let rawText: string | null = null;
				if (effective.startsWith('gist:')) {
					const gistId = effective.substring(5);
					rawText = await this.fetchGistContent(gistId);
				} else if (/^https?:\/\//i.test(effective)) {
					try {
						const urlObj = new URL(effective);
						rawText = await new Promise<string>((resolve, reject) => {
							const req = https.request({ hostname: urlObj.hostname, path: urlObj.pathname + (urlObj.search || ''), method: 'GET', headers: { 'User-Agent': 'beast-mode-ext', 'Accept': 'application/json' }, port: urlObj.port ? Number(urlObj.port) : 443, timeout: 9000 }, res => {
								if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) { return reject(new Error(`HTTP ${res.statusCode}`)); }
								const chunks: Buffer[] = [];
								res.on('data', c => chunks.push(Buffer.from(c)));
								res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
							});
							req.on('error', reject);
							req.on('timeout', () => req.destroy(new Error('timeout')));
							req.end();
						});
					} catch {
						rawText = null;
					}
				}

				if (!rawText) { return; }

				const last = this.context.globalState.get<string>(this.GLOBAL_LAST_RAW);
				// Record when we performed this remote check
				try { await this.context.globalState.update(this.GLOBAL_LAST_CHECKED, new Date().toISOString()); } catch {}
				if (!last) {
					await this.context.globalState.update(this.GLOBAL_LAST_RAW, rawText);
					await this.context.globalState.update(this.GLOBAL_PENDING_KEY, false);
					return;
				}

				if (last !== rawText) {
					await this.context.globalState.update(this.GLOBAL_PENDING_KEY, true);
					this.postState();
				}
			} catch (e) {
				// ignore
			}
		};

		// Run immediately then schedule interval
		void doCheck();
		this.pollTimer = setInterval(() => void doCheck(), this.POLL_INTERVAL_MS);
		this.disposables.push(new vscode.Disposable(() => { if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = undefined; } }));
	}

	/** Perform an immediate remote config check and mark pending if different from last known raw. */
	private async checkRemoteNow(): Promise<void> {
		try {
			const remoteUrl = (vscode.workspace.getConfiguration().get<string>('onByDefault.remoteConfigUrl') || '').trim();
			if (!remoteUrl) {
				try { await this.context.globalState.update(this.GLOBAL_PENDING_KEY, false); } catch {}
				this.postState();
				return;
			}

			const effective = (await this.resolveToRawUrl(remoteUrl)) || remoteUrl;
			let rawText: string | null = null;
			if (effective.startsWith('gist:')) {
				const gistId = effective.substring(5);
				rawText = await this.fetchGistContent(gistId);
			} else if (/^https?:\/\//i.test(effective)) {
				try {
					const urlObj = new URL(effective);
					rawText = await new Promise<string>((resolve, reject) => {
						const req = https.request({ hostname: urlObj.hostname, path: urlObj.pathname + (urlObj.search || ''), method: 'GET', headers: { 'User-Agent': 'beast-mode-ext', 'Accept': 'application/json' }, port: urlObj.port ? Number(urlObj.port) : 443, timeout: 9000 }, res => {
							if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) { return reject(new Error(`HTTP ${res.statusCode}`)); }
							const chunks: Buffer[] = [];
							res.on('data', c => chunks.push(Buffer.from(c)));
							res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
						});
						req.on('error', reject);
						req.on('timeout', () => req.destroy(new Error('timeout')));
						req.end();
					});
				} catch {
					rawText = null;
				}
			}

			if (!rawText) { this.postState(); return; }

			// Record check timestamp
			try { await this.context.globalState.update(this.GLOBAL_LAST_CHECKED, new Date().toISOString()); } catch {}
			const last = this.context.globalState.get<string>(this.GLOBAL_LAST_RAW);
			if (!last) {
				await this.context.globalState.update(this.GLOBAL_LAST_RAW, rawText);
				await this.context.globalState.update(this.GLOBAL_PENDING_KEY, false);
				this.postState();
				return;
			}

			if (last !== rawText) {
				await this.context.globalState.update(this.GLOBAL_PENDING_KEY, true);
				this.postState();
				return;
			}

			await this.context.globalState.update(this.GLOBAL_PENDING_KEY, false);
			this.postState();
		} catch {
			this.postState();
		}
	}

	/** Resolve a URL string into a raw JSON URL or a special gist:ID marker. */
	private async resolveToRawUrl(remoteUrl: string): Promise<string | null> {
		if (!remoteUrl) { return null; }
		const gistMatch = remoteUrl.match(/gist.github(?:usercontent)?\.com\/(?:[^\/]+\/)?([0-9a-fA-F]{6,})/i);
		if (gistMatch && gistMatch[1]) { return `gist:${gistMatch[1]}`; }
		// Keep query but strip hash
		return remoteUrl.split('#')[0];
	}

	/** Fetch remote JSON and cache to global storage + local file. Supports gist.github.com via API. */
	private async fetchAndCacheRemoteConfig(remoteUrl: string): Promise<any | null> {
		try {
			if (!/^https?:\/\//i.test(remoteUrl)) { return null; }
			const effective = (await this.resolveToRawUrl(remoteUrl)) || remoteUrl;

			if (effective.startsWith('gist:')) {
				const gistId = effective.substring(5);
				const gistContent = await this.fetchGistContent(gistId);
				if (!gistContent) { return null; }
				try { return JSON.parse(gistContent); } catch { return null; }
			}

			// Standard URL fetching with caching via ETag
			const cacheDir = this.context.globalStorageUri?.fsPath || path.join(this.context.extensionPath, 'media');
			try { fs.mkdirSync(cacheDir, { recursive: true }); } catch {}
			const cacheFile = path.join(cacheDir, 'remote-config.json');
			const etagKey = `remoteConfig.etag:${effective}`;
			const headers: Record<string, string> = { 'User-Agent': 'beast-mode-ext', 'Accept': 'application/json' };
			const prevEtag = this.context.globalState.get<string>(etagKey);
			if (prevEtag) { headers['If-None-Match'] = prevEtag; }

			const urlObj = new URL(effective);
			const body = await new Promise<{ text: string; etag?: string }>((resolve, reject) => {
				const req = https.request({ hostname: urlObj.hostname, path: urlObj.pathname + (urlObj.search || ''), method: 'GET', headers, port: urlObj.port ? Number(urlObj.port) : 443, timeout: 9000 }, res => {
					if (res.statusCode === 304) {
						try {
							const cached = fs.readFileSync(cacheFile, 'utf8');
							return resolve({ text: cached, etag: res.headers['etag'] as string | undefined });
						} catch { return reject(new Error('cached-missing')); }
					}
					if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) { return reject(new Error(`HTTP ${res.statusCode}`)); }
					const chunks: Buffer[] = [];
					res.on('data', c => chunks.push(Buffer.from(c)));
					res.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8'), etag: res.headers['etag'] as string | undefined }));
				});
				req.on('timeout', () => req.destroy(new Error('timeout')));
				req.on('error', reject);
				req.end();
			});

			if (!body || !body.text) { return null; }
			try {
				const parsed = JSON.parse(body.text);
				try { fs.writeFileSync(cacheFile, JSON.stringify(parsed, null, 2), 'utf8'); } catch {}
				if (body.etag) { try { await this.context.globalState.update(etagKey, body.etag); } catch {} }
				return parsed;
			} catch {
				// If parsing remote response fails, try to fallback to local cached file
				try { const raw = fs.readFileSync(cacheFile, 'utf8'); return JSON.parse(raw); } catch { return null; }
			}
		} catch {
			return null;
		}
	}

	/** Fetch gist JSON by using GitHub's Gist API and return the first JSON file content if present. */
	private async fetchGistContent(gistId: string): Promise<string | null> {
		try {
			const apiUrl = `https://api.github.com/gists/${gistId}`;
			const cacheKey = `gist.etag:${gistId}`;
			const prevEtag = this.context.globalState.get<string>(cacheKey);
			const headers: Record<string, string> = { 'User-Agent': 'beast-mode-ext', 'Accept': 'application/vnd.github.v3+json' };
			if (prevEtag) { headers['If-None-Match'] = prevEtag; }

			const response = await new Promise<{ body: string; headers: any; status: number }>((resolve, reject) => {
				const req = https.request(apiUrl, { method: 'GET', headers, timeout: 9000 }, res => {
					const chunks: Buffer[] = [];
					res.on('data', c => chunks.push(Buffer.from(c)));
					res.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8'), headers: res.headers, status: res.statusCode || 500 }));
				});
				req.on('error', reject);
				req.on('timeout', () => req.destroy(new Error('timeout')));
				req.end();
			});

			if (response.status === 304) {
				// Use previously cached file if present
				const cacheDir = this.context.globalStorageUri?.fsPath || path.join(this.context.extensionPath, 'media');
				const cacheFile = path.join(cacheDir, `gist-${gistId}.json`);
				try { return fs.readFileSync(cacheFile, 'utf8'); } catch { return null; }
			}

			if (response.status < 200 || response.status >= 300) { return null; }
			const parsed = JSON.parse(response.body);
			const files = parsed?.files || {};
			let targetFile = files['config.json'];
			if (!targetFile) {
				const jsonFiles = Object.keys(files).filter(n => n.endsWith('.json'));
				if (jsonFiles.length) { targetFile = files[jsonFiles[0]]; }
			}
			if (!targetFile || !targetFile.content) { return null; }

			// Cache content + etag
			if (response.headers?.etag) {
				await this.context.globalState.update(cacheKey, response.headers.etag as string);
				const cacheDir = this.context.globalStorageUri?.fsPath || path.join(this.context.extensionPath, 'media');
				try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(path.join(cacheDir, `gist-${gistId}.json`), targetFile.content, 'utf8'); } catch {}
			}

			return targetFile.content;
		} catch {
			return null;
		}
	}

	// -------------------------
	// Schema enrichment helpers
	// -------------------------

	/** Normalize 'requires' value into string[] */
	private normalizeRequires(input: any): string[] {
		if (!input) { return []; }
		if (typeof input === 'string') { return [input]; }
		if (Array.isArray(input)) { return input.filter(i => typeof i === 'string'); }
		return [];
	}

	/** Merge two requires arrays into a unique array. */
	private mergeRequires(a: string[], b: string[]): string[] {
		return Array.from(new Set([...(a || []), ...(b || [])]));
	}

	/**
	 * Infer a SettingDefinition for a key by inspecting installed extension configurations and current user values.
	 */
	private inferDefinitionFromSchema(
		key: string,
		title?: string,
		description?: string,
		groupOverride?: string,
		typeOverride?: SettingDefinition['type'],
		optionsOverride?: Array<{ value: string; label?: string }>,
		minOverride?: number,
		maxOverride?: number,
		stepOverride?: number,
		requiresOverride?: string[],
		defaultOverride?: any
	): SettingDefinition {
		// Try to find a contributed JSON schema for this key across installed extensions.
		const found = this.findConfigSchemaForKey(key);
		const schema = found?.schema;
		const group = groupOverride || this.deriveGroupFromKey(key);
		const label = title || key.split('.').slice(-1)[0];

		let type: SettingDefinition['type'] = 'string';
		let options: Array<{ value: string; label?: string }> | undefined = undefined;
		let min: number | undefined = undefined;
		let max: number | undefined = undefined;
		let step: number | undefined = undefined;
		let requires: string[] | undefined = undefined;
		let defaultVal: any = defaultOverride;

		if (schema) {
			const sType = Array.isArray(schema.type) ? schema.type[0] : schema.type;
			if (sType === 'boolean') { type = 'boolean'; }
			else if (sType === 'number' || sType === 'integer') { type = 'number'; step = sType === 'integer' ? 1 : undefined; }
			else if (sType === 'object' || sType === 'array') { type = 'json'; }
			else { type = 'string'; }

			if (schema.enum && Array.isArray(schema.enum)) {
				options = schema.enum.map((v: any, i: number) => ({ value: String(v), label: Array.isArray(schema.enumDescriptions) ? schema.enumDescriptions[i] : undefined }));
			} else if (schema.oneOf || schema.anyOf) {
				const alts = (schema.oneOf || schema.anyOf) as any[];
				const enums = alts
					.filter(e => e && (e.const !== undefined || e.enum))
					.map(e => e.const ?? (Array.isArray(e.enum) ? e.enum[0] : undefined))
					.filter(v => v !== undefined);
				if (enums.length) { options = enums.map(v => ({ value: String(v) })); }
			}

			if (typeof schema.minimum === 'number') { min = schema.minimum; }
			if (typeof schema.maximum === 'number') { max = schema.maximum; }
			if (found && found.extensionId && found.extensionId !== this.context.extension.id) { requires = [found.extensionId]; }

			// If the schema provides a default, prefer that unless an explicit override was provided.
			if (defaultVal === undefined && schema.default !== undefined) { defaultVal = schema.default; }
		}

		// Inspect current configuration values to refine type information.
		try {
			const info = vscode.workspace.getConfiguration().inspect<any>(key);
			const sample = info?.globalValue ?? info?.workspaceValue ?? info?.workspaceFolderValue ?? info?.defaultValue;
			if (sample !== undefined) {
				const t = typeof sample;
				if (t === 'boolean') { type = 'boolean'; }
				else if (t === 'number') { type = 'number'; if (Number.isInteger(sample) && step === undefined) { step = 1; } }
				else if (t === 'object' && sample !== null) { type = 'json'; }
				else { type = 'string'; }
				// If a concrete default exists in the configuration defaultValue and we haven't picked one, use it as a fallback.
				if (defaultVal === undefined && info?.defaultValue !== undefined) { defaultVal = info.defaultValue; }
			}
		} catch {
			// Ignore failures inspecting configuration
		}

		// Apply overrides provided by the remote config metadata.
		if (typeOverride) { type = typeOverride; }
		if (optionsOverride && optionsOverride.length) { options = optionsOverride.map(o => ({ value: String(o.value), label: o.label })); }
		if (minOverride !== undefined) { min = minOverride; }
		if (maxOverride !== undefined) { max = maxOverride; }
		if (stepOverride !== undefined) { step = stepOverride; }
		if (requiresOverride && requiresOverride.length) { requires = this.normalizeRequires(requiresOverride); }
		if (defaultOverride !== undefined) { defaultVal = defaultOverride; }

		return { key, type, title: label, description: description || label, group, min, max, step, options, requires, default: defaultVal };
	}

	/** Search all installed extensions for a configuration schema that defines `key`. */
	private findConfigSchemaForKey(key: string): { schema: any; extensionId?: string } | undefined {
		for (const ext of vscode.extensions.all) {
			const contrib = (ext.packageJSON && (ext.packageJSON as any).contributes) || {};
			const config = (contrib as any).configuration;
			if (!config) { continue; }
			const buckets = Array.isArray(config) ? config : [config];
			for (const bucket of buckets) {
				const props = (bucket as any).properties;
				if (props && Object.prototype.hasOwnProperty.call(props, key)) {
					return { schema: props[key], extensionId: ext.id };
				}
			}
		}
		return undefined;
	}

	/** Derive a friendly group name from a dotted setting key. */
	private deriveGroupFromKey(key: string): string {
		const first = key.split('.')[0] || key;
		switch (first) {
			case 'github': return 'GitHub Copilot';
			case 'githubPullRequests': return 'GitHub PRs';
			case 'terminal': return 'Terminal';
			case 'workbench': return 'Workbench';
			case 'editor': return 'Editor';
			case 'chat': return 'Chat';
			case 'git': return 'Git';
			case 'window': return 'Window';
			default: return first.charAt(0).toUpperCase() + first.slice(1);
		}
	}

	// -------------------------
	// Apply changes / helpers
	// -------------------------

	/** Update a user's setting at the global (user) scope and refresh the view. */
	private async updateSetting(key: string, value: any) {
		await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Global);
		this.postState();
	}

	/**
	 * Apply suggested defaults for newly discovered settings but only when the user has not explicitly
	 * configured the setting at any scope. Do not overwrite any existing user values.
	 */
	private async applyDefaultsToUserSettings(defs: SettingDefinition[]): Promise<void> {
		for (const def of defs) {
			try {
				// If the setting requires extensions that are not installed, skip applying default.
				if (def.requires && def.requires.length) {
					const anyMissing = def.requires.some(r => !vscode.extensions.getExtension(r));
					if (anyMissing) { continue; }
				}

				const info = vscode.workspace.getConfiguration().inspect<any>(def.key);
				// If the user has explicitly set the value at any scope, respect that and do nothing.
				if (info?.globalValue !== undefined || info?.workspaceValue !== undefined || info?.workspaceFolderValue !== undefined) {
					continue;
				}

				let valueToSet: any = undefined;
				if (def.default !== undefined) {
					valueToSet = def.default;
				} else if (def.type === 'boolean') {
					// "Always on" behavior: default booleans are enabled unless the user has chosen otherwise.
					valueToSet = true;
				} else if (def.type === 'number') {
					valueToSet = def.min !== undefined ? def.min : 1;
				} else if (def.type === 'string' && def.options && def.options.length) {
					valueToSet = def.options[0].value;
				}

				if (valueToSet !== undefined) {
					await vscode.workspace.getConfiguration().update(def.key, valueToSet, vscode.ConfigurationTarget.Global);
				}
			} catch {
				// Swallow any errors to avoid disrupting refresh flow.
			}
		}
	}

	/** Attempt to install extensions by id. If automatic install fails we open the Extensions view search. */
	private async installExtensions(ids: string[]) {
		const installPromises: Thenable<unknown>[] = [];
		for (const id of ids) {
			try {
				const existing = vscode.extensions.getExtension(id);
				if (existing) {
					// Already installed
					continue;
				}

				// Attempt a direct install
				const promise = vscode.commands.executeCommand('workbench.extensions.installExtension', id);
				installPromises.push(promise);
			} catch {
				// Ignore install errors, we can prompt user to install manually if needed.
			}
		}

		// If we have any install promises, wait for them to complete.
		if (installPromises.length) {
			try { await Promise.all(installPromises as any); } catch { /* ignore */ }
		}
	}

	// -------------------------
	// HTML rendering / CSP
	// -------------------------

	/** Load the HTML template and inject the state JSON + CSP nonce. */
	private renderHtml(state: SettingsState): string {
		const nonce = this.generateNonce();
		const csp = [`default-src 'none'`, `style-src ${this.getCspSource()} 'unsafe-inline'`, `script-src 'nonce-${nonce}'`].join('; ');
		const templatePath = path.join(this.context.extensionPath, 'media', 'settingsWebview.html');
		let html = `<html><body><h3>Failed to load settings template.</h3></body></html>`;
		try { html = fs.readFileSync(templatePath, 'utf8'); } catch (e) { /* fall through with basic error */ }
		return html.replace(/%%CSP%%/g, csp).replace(/%%NONCE%%/g, nonce).replace(/%%STATE_JSON%%/g, () => JSON.stringify(state));
	}

	private getCspSource(): string { return this.view?.webview.cspSource || 'vscode-resource:'; }
	private generateNonce(): string { return Array.from({ length: 32 }).map(() => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 62))).join(''); }

}

// -------------------------
// Extension activation
// -------------------------

export function activate(context: vscode.ExtensionContext) {
	const provider = new OnByDefaultSettingsWebviewProvider(context);
	context.subscriptions.push(vscode.window.registerWebviewViewProvider(OnByDefaultSettingsWebviewProvider.viewType, provider));
	provider.startExternalWatchers();

	// Small convenience command to refresh the settings view from command palette.
	context.subscriptions.push(vscode.commands.registerCommand('on-by-default.refreshSettings', () => provider['postState']?.()));
}

export function deactivate() { /* nothing to do — provider disposes via subscriptions */ }
