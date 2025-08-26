import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { IConfigurationService, IHttpService, ISchemaInferenceService, ConfigurationLoadResult, SettingDefinition } from '../types';
import { Constants } from '../constants';
import { ignoreErrors, safeJsonParse } from '../utils/common';

/**
 * Service for loading and managing configuration from remote and local sources
 */
export class ConfigurationService implements IConfigurationService {
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

			// Try remote first
			if (remoteUrl) {
				json = await this.loadRemoteConfig(remoteUrl);
				if (json) {source = 'remote';}
			}

			// Fallback to bundled config
			if (!json) {
				json = await this.loadBundledConfig();
			}

			// Parse configuration
			const definitions = this.parseConfiguration(json);
			
			const result: ConfigurationLoadResult = {
				definitions,
				source,
				timestamp: new Date().toISOString()
			};

			// Apply defaults for newly discovered settings
			await ignoreErrors(() => this.schemaService.applyDefaultsToUserSettings(definitions));

			// Notify listeners
			this._onConfigurationChanged.fire(result);
			return result;

		} catch {
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
		if (this.pollTimer) {return;}

		const checkForUpdates = () => ignoreErrors(() => this.checkForRemoteUpdates());

		void checkForUpdates();
		this.pollTimer = setInterval(checkForUpdates, Constants.POLLING_INTERVAL_MS);
		
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
		const remoteUrl = this.getRemoteConfigUrl();
		if (!remoteUrl) {
			await this.clearPendingFlag();
			return false;
		}

		const rawText = await this.fetchRawRemoteConfig(remoteUrl);
		if (!rawText) {return false;}

		await this.setLastChecked();

		const lastKnownRaw = this.context.globalState.get<string>(Constants.GLOBAL_KEYS.REMOTE_LAST_RAW);
		
		if (!lastKnownRaw) {
			await this.context.globalState.update(Constants.GLOBAL_KEYS.REMOTE_LAST_RAW, rawText);
			await this.clearPendingFlag();
			return false;
		}

		if (lastKnownRaw !== rawText) {
			await this.setPendingFlag();
			return true;
		}

		await this.clearPendingFlag();
		return false;
	}

	/**
	 * Refresh configuration by loading from remote and applying changes
	 */
	async refreshConfiguration(): Promise<void> {
		await this.loadConfiguration();
		await this.clearPendingFlag();
		await this.context.globalState.update(Constants.GLOBAL_KEYS.REMOTE_LAST_RAW, null);
	}

	/**
	 * Check if there are pending remote configuration changes
	 */
	hasPendingChanges(): boolean {
		return !!this.context.globalState.get<boolean>(Constants.GLOBAL_KEYS.REMOTE_PENDING);
	}

	/**
	 * Get the last time remote configuration was checked
	 */
	getLastChecked(): string | null {
		return this.context.globalState.get<string>(Constants.GLOBAL_KEYS.REMOTE_LAST_CHECKED) || null;
	}

	/**
	 * Dispose of resources
	 */
	dispose(): void {
		this.stopPolling();
		this.disposables.forEach(d => ignoreErrors(() => d.dispose()));
		this.disposables.length = 0;
		this._onConfigurationChanged.dispose();
	}

	private getRemoteConfigUrl(): string {
		return (vscode.workspace.getConfiguration().get<string>('onByDefault.remoteConfigUrl') || '').trim();
	}

	private async loadRemoteConfig(remoteUrl: string): Promise<any | null> {
		try {
			const effective = await this.httpService.resolveToRawUrl(remoteUrl);
			if (!effective) {return null;}

			let content: string | null = null;

			if (effective.startsWith('gist:')) {
				const gistId = effective.substring(5);
				content = await this.httpService.fetchGistContent(gistId);
			} else {
				const response = await this.httpService.get({ url: effective, useCache: true });
				content = response.data;
			}

			return content ? safeJsonParse(content, null) : null;
		} catch {
			return null;
		}
	}

	private async fetchRawRemoteConfig(remoteUrl: string): Promise<string | null> {
		try {
			const effective = await this.httpService.resolveToRawUrl(remoteUrl);
			if (!effective) {return null;}

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

	private async loadBundledConfig(): Promise<any | null> {
		try {
			const configPath = path.join(this.context.extensionPath, 'media', Constants.FILES.CONFIG);
			if (!fs.existsSync(configPath)) {return null;}

			const raw = fs.readFileSync(configPath, 'utf8');
			return safeJsonParse(raw, null);
		} catch {
			return null;
		}
	}

	private async setPendingFlag(): Promise<void> {
		await ignoreErrors(async () => 
			await this.context.globalState.update(Constants.GLOBAL_KEYS.REMOTE_PENDING, true)
		);
	}

	private async clearPendingFlag(): Promise<void> {
		await ignoreErrors(async () => 
			await this.context.globalState.update(Constants.GLOBAL_KEYS.REMOTE_PENDING, false)
		);
	}

	private async setLastChecked(): Promise<void> {
		await ignoreErrors(async () => 
			await this.context.globalState.update(
				Constants.GLOBAL_KEYS.REMOTE_LAST_CHECKED, 
				new Date().toISOString()
			)
		);
	}

	/**
	 * Parse configuration JSON into setting definitions
	 */
	private parseConfiguration(json: any): SettingDefinition[] {
		const definitions: SettingDefinition[] = [];

		if (!json?.settings || !Array.isArray(json.settings)) {
			return definitions;
		}

		for (const entry of json.settings) {
			if (!entry) {continue;}

			// Grouped format: { group, settings: [...] }
			if (this.isGroupedEntry(entry)) {
				definitions.push(...this.parseGroupedEntry(entry));
				continue;
			}

			// Single entry format: { key, ... }
			if (this.isSingleEntry(entry)) {
				definitions.push(this.parseSingleEntry(entry));
			}
		}

		return definitions;
	}

	private isGroupedEntry(entry: any): boolean {
		return typeof entry.group === 'string' && Array.isArray(entry.settings);
	}

	private isSingleEntry(entry: any): boolean {
		return typeof entry.key === 'string';
	}

	private parseGroupedEntry(entry: any): SettingDefinition[] {
		const groupName = entry.group;
		const groupRequires = this.schemaService.normalizeRequires(
			entry.requires || entry.requiresExtensions || entry.requiresExtension
		);
		const groupRecommended = entry.recommended;

		return entry.settings
			.filter((setting: any) => setting && typeof setting.key === 'string')
			.map((setting: any) => this.enrichSetting(setting, {
				group: groupName,
				recommended: setting.recommended ?? groupRecommended,
				requires: this.schemaService.mergeRequires(
					groupRequires,
					this.schemaService.normalizeRequires(
						setting.requires || setting.requiresExtensions || setting.requiresExtension
					)
				)
			}));
	}

	private parseSingleEntry(entry: any): SettingDefinition {
		return this.enrichSetting(entry);
	}

	private enrichSetting(setting: any, overrides: Partial<SettingDefinition> = {}): SettingDefinition {
		const enriched = this.schemaService.enrichSettingDefinition(setting.key, {
			...setting,
			...overrides
		});

		if (typeof setting.info === 'string') {
			enriched.info = setting.info;
		}

		return enriched;
	}
}