import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { IConfigurationService, IHttpService, ISchemaInferenceService, ConfigurationLoadResult, SettingDefinition } from '../types';

/**
 * Service for loading and managing configuration from remote and local sources
 */
export class ConfigurationService implements IConfigurationService {
	private static readonly POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
	private static readonly GLOBAL_PENDING_KEY = 'remoteConfig.hasPendingChanges';
	private static readonly GLOBAL_LAST_RAW = 'remoteConfig.lastRawText';
	private static readonly GLOBAL_LAST_CHECKED = 'remoteConfig.lastChecked';

	private pollTimer?: NodeJS.Timeout;
	private disposables: vscode.Disposable[] = [];
	private _onConfigurationChanged = new vscode.EventEmitter<ConfigurationLoadResult>();

	public readonly onConfigurationChanged = this._onConfigurationChanged.event;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly httpService: IHttpService,
		private readonly schemaService: ISchemaInferenceService
	) {}

	/**
	 * Load configuration from remote URL or bundled config.json
	 */
	async loadConfiguration(): Promise<ConfigurationLoadResult> {
		try {
			const remoteUrl = this.getRemoteConfigUrl();
			let json: any = null;
			let source: 'remote' | 'local' = 'local';

			// Try to load from remote first
			if (remoteUrl) {
				json = await this.fetchRemoteConfig(remoteUrl);
				if (json) {
					source = 'remote';
				}
			}

			// Fallback to bundled config
			if (!json) {
				json = await this.loadBundledConfig();
			}

			// Parse and enrich the configuration
			const definitions = await this.parseConfiguration(json);
			
			const result: ConfigurationLoadResult = {
				definitions,
				source,
				timestamp: new Date().toISOString()
			};

			// Apply defaults for newly discovered settings
			try {
				await this.schemaService.applyDefaultsToUserSettings(definitions);
			} catch {
				// Ignore errors applying defaults
			}

			// Notify listeners
			this._onConfigurationChanged.fire(result);

			return result;

		} catch (error) {
			// Return empty configuration on error
			const result: ConfigurationLoadResult = {
				definitions: [],
				source: 'local',
				timestamp: new Date().toISOString()
			};
			
			this._onConfigurationChanged.fire(result);
			return result;
		}
	}

	/**
	 * Start polling for remote configuration changes
	 */
	startPolling(): void {
		if (this.pollTimer) {
			return;
		}

		const doCheck = async () => {
			try {
				await this.checkForRemoteUpdates();
			} catch {
				// Ignore polling errors
			}
		};

		// Run immediately then schedule interval
		void doCheck();
		this.pollTimer = setInterval(() => void doCheck(), ConfigurationService.POLL_INTERVAL_MS);
		
		this.disposables.push(new vscode.Disposable(() => {
			if (this.pollTimer) {
				clearInterval(this.pollTimer);
				this.pollTimer = undefined;
			}
		}));
	}

	/**
	 * Stop polling for remote configuration changes
	 */
	stopPolling(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = undefined;
		}
	}

	/**
	 * Check for remote configuration updates without applying them
	 */
	async checkForRemoteUpdates(): Promise<boolean> {
		try {
			const remoteUrl = this.getRemoteConfigUrl();
			if (!remoteUrl) {
				await this.clearPendingFlag();
				return false;
			}

			const rawText = await this.fetchRawRemoteConfig(remoteUrl);
			if (!rawText) {
				return false;
			}

			// Record check timestamp
			await this.setLastChecked();

			const lastKnownRaw = this.context.globalState.get<string>(ConfigurationService.GLOBAL_LAST_RAW);
			
			// If this is the first check, store the raw text
			if (!lastKnownRaw) {
				await this.context.globalState.update(ConfigurationService.GLOBAL_LAST_RAW, rawText);
				await this.clearPendingFlag();
				return false;
			}

			// Check if content has changed
			if (lastKnownRaw !== rawText) {
				await this.setPendingFlag();
				return true;
			}

			await this.clearPendingFlag();
			return false;

		} catch {
			return false;
		}
	}

	/**
	 * Refresh configuration by loading from remote and applying changes
	 */
	async refreshConfiguration(): Promise<void> {
		await this.loadConfiguration();
		await this.clearPendingFlag();
		await this.context.globalState.update(ConfigurationService.GLOBAL_LAST_RAW, null);
	}

	/**
	 * Check if there are pending remote configuration changes
	 */
	hasPendingChanges(): boolean {
		return !!this.context.globalState.get<boolean>(ConfigurationService.GLOBAL_PENDING_KEY);
	}

	/**
	 * Get the last time remote configuration was checked
	 */
	getLastChecked(): string | null {
		return this.context.globalState.get<string>(ConfigurationService.GLOBAL_LAST_CHECKED) || null;
	}

	/**
	 * Dispose of resources
	 */
	dispose(): void {
		this.stopPolling();
		for (const disposable of this.disposables) {
			try {
				disposable.dispose();
			} catch {
				// Ignore disposal errors
			}
		}
		this.disposables.length = 0;
		this._onConfigurationChanged.dispose();
	}

	/**
	 * Get the remote configuration URL from settings
	 */
	private getRemoteConfigUrl(): string {
		return (vscode.workspace.getConfiguration().get<string>('onByDefault.remoteConfigUrl') || '').trim();
	}

	/**
	 * Fetch and parse remote configuration
	 */
	private async fetchRemoteConfig(remoteUrl: string): Promise<any | null> {
		try {
			const effective = await this.httpService.resolveToRawUrl(remoteUrl);
			if (!effective) {
				return null;
			}

			let content: string | null = null;

			if (effective.startsWith('gist:')) {
				const gistId = effective.substring(5);
				content = await this.httpService.fetchGistContent(gistId);
			} else {
				const response = await this.httpService.get({ url: effective, useCache: true });
				content = response.data;
			}

			if (!content) {
				return null;
			}

			return JSON.parse(content);

		} catch {
			return null;
		}
	}

	/**
	 * Fetch raw remote configuration content for change detection
	 */
	private async fetchRawRemoteConfig(remoteUrl: string): Promise<string | null> {
		try {
			const effective = await this.httpService.resolveToRawUrl(remoteUrl);
			if (!effective) {
				return null;
			}

			if (effective.startsWith('gist:')) {
				const gistId = effective.substring(5);
				return await this.httpService.fetchGistContent(gistId);
			} else {
				const response = await this.httpService.get({ url: effective, useCache: false });
				return response.data;
			}

		} catch {
			return null;
		}
	}

	/**
	 * Load bundled configuration from media/config.json
	 */
	private async loadBundledConfig(): Promise<any | null> {
		try {
			const configPath = path.join(this.context.extensionPath, 'media', 'config.json');
			if (!fs.existsSync(configPath)) {
				return null;
			}

			const raw = fs.readFileSync(configPath, 'utf8');
			return JSON.parse(raw);

		} catch {
			return null;
		}
	}

	/**
	 * Parse configuration JSON into SettingDefinition array
	 */
	private async parseConfiguration(json: any): Promise<SettingDefinition[]> {
		const definitions: SettingDefinition[] = [];

		if (!json || !Array.isArray(json.settings)) {
			return definitions;
		}

		for (const entry of json.settings) {
			if (!entry) {
				continue;
			}

			// Handle grouped format: { group, settings: [...] }
			if (typeof entry.group === 'string' && Array.isArray(entry.settings)) {
				const groupName = entry.group;
				const groupRequires = this.schemaService.normalizeRequires(
					entry.requires || entry.requiresExtensions || entry.requiresExtension
				);
				const groupRecommended = entry.recommended; // Group-level recommended value

				for (const setting of entry.settings) {
					if (!setting || typeof setting.key !== 'string') {
						continue;
					}

					const enriched = this.schemaService.enrichSettingDefinition(setting.key, {
						...setting,
						group: groupName,
						// Individual setting recommended value overrides group-level
						recommended: setting.recommended !== undefined ? setting.recommended : groupRecommended,
						requires: this.schemaService.mergeRequires(
							groupRequires,
							this.schemaService.normalizeRequires(
								setting.requires || setting.requiresExtensions || setting.requiresExtension
							)
						)
					});

					if (typeof setting.info === 'string') {
						enriched.info = setting.info;
					}

					definitions.push(enriched);
				}
				continue;
			}

			// Handle single entry format: { key, ... }
			if (typeof entry.key === 'string') {
				const enriched = this.schemaService.enrichSettingDefinition(entry.key, entry);
				if (typeof entry.info === 'string') {
					enriched.info = entry.info;
				}
				definitions.push(enriched);
			}
		}

		return definitions;
	}

	/**
	 * Set the pending changes flag
	 */
	private async setPendingFlag(): Promise<void> {
		try {
			await this.context.globalState.update(ConfigurationService.GLOBAL_PENDING_KEY, true);
		} catch {
			// Ignore storage errors
		}
	}

	/**
	 * Clear the pending changes flag
	 */
	private async clearPendingFlag(): Promise<void> {
		try {
			await this.context.globalState.update(ConfigurationService.GLOBAL_PENDING_KEY, false);
		} catch {
			// Ignore storage errors
		}
	}

	/**
	 * Set the last checked timestamp
	 */
	private async setLastChecked(): Promise<void> {
		try {
			await this.context.globalState.update(
				ConfigurationService.GLOBAL_LAST_CHECKED, 
				new Date().toISOString()
			);
		} catch {
			// Ignore storage errors
		}
	}
}