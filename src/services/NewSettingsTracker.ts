import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { INewSettingsTracker, SettingDefinition, NewSettingsState } from '../types';

/**
 * Service for tracking which settings users have seen and detecting new settings
 */
export class NewSettingsTracker implements INewSettingsTracker {
	private static readonly STORAGE_KEY = 'newSettings.state';
	private static readonly STORAGE_VERSION = 1;

	private state: NewSettingsState;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.state = this.loadState();
	}

	/**
	 * Initialize the tracker with current configuration
	 */
	async initialize(definitions: SettingDefinition[]): Promise<void> {
		// If this is the first run, mark all current settings as seen
		// to avoid overwhelming new users
		if (this.state.firstRun) {
			await this.markAllAsSeen(definitions);
			this.state.firstRun = false;
			await this.saveState();
		}

		// Update the configuration hash
		const configHash = this.calculateConfigHash(definitions);
		this.state.lastConfigHash = configHash;
		await this.saveState();
	}

	/**
	 * Detect new settings by comparing with previously seen settings
	 */
	detectNewSettings(definitions: SettingDefinition[]): SettingDefinition[] {
		const currentConfigHash = this.calculateConfigHash(definitions);
		
		// If configuration hasn't changed, no new settings
		if (this.state.lastConfigHash === currentConfigHash) {
			return [];
		}

		// Find settings that haven't been seen before
		const newSettings = definitions.filter(def => !this.state.seenSettings[def.key]);
		
		// Update the configuration hash
		this.state.lastConfigHash = currentConfigHash;
		this.saveState().catch(() => {
			// Ignore save errors - functionality will still work
		});

		return newSettings;
	}

	/**
	 * Mark specific settings as seen
	 */
	async markAsSeen(settingKeys: string[]): Promise<void> {
		const timestamp = new Date().toISOString();
		
		for (const key of settingKeys) {
			this.state.seenSettings[key] = timestamp;
		}

		await this.saveState();
	}

	/**
	 * Mark all current settings as seen
	 */
	async markAllAsSeen(definitions: SettingDefinition[]): Promise<void> {
		const timestamp = new Date().toISOString();
		
		for (const def of definitions) {
			this.state.seenSettings[def.key] = timestamp;
		}

		await this.saveState();
	}

	/**
	 * Check if a setting is new/unseen
	 */
	isSettingNew(settingKey: string): boolean {
		return !this.state.seenSettings[settingKey];
	}

	/**
	 * Get count of new settings
	 */
	getNewSettingsCount(definitions: SettingDefinition[]): number {
		return definitions.filter(def => this.isSettingNew(def.key)).length;
	}

	/**
	 * Clear all tracking state (for testing/reset)
	 */
	async clearState(): Promise<void> {
		this.state = this.createDefaultState();
		await this.saveState();
	}

	/**
	 * Calculate a hash of the configuration to detect changes
	 */
	private calculateConfigHash(definitions: SettingDefinition[]): string {
		try {
			// Create a sorted array of setting keys for consistent hashing
			const keys = definitions.map(def => def.key).sort();
			const configString = JSON.stringify(keys);
			return crypto.createHash('sha256').update(configString).digest('hex');
		} catch {
			// Fallback to a simple string concatenation if crypto fails
			return definitions.map(def => def.key).sort().join('|');
		}
	}

	/**
	 * Load state from VS Code global storage
	 */
	private loadState(): NewSettingsState {
		try {
			const stored = this.context.globalState.get<any>(NewSettingsTracker.STORAGE_KEY);
			
			if (!stored || stored.version !== NewSettingsTracker.STORAGE_VERSION) {
				return this.createDefaultState();
			}

			// Validate stored state
			if (typeof stored.seenSettings !== 'object' || 
				typeof stored.firstRun !== 'boolean') {
				return this.createDefaultState();
			}

			return {
				seenSettings: stored.seenSettings || {},
				lastConfigHash: stored.lastConfigHash || undefined,
				firstRun: stored.firstRun
			};
		} catch {
			return this.createDefaultState();
		}
	}

	/**
	 * Save state to VS Code global storage
	 */
	private async saveState(): Promise<void> {
		try {
			const stateToStore = {
				version: NewSettingsTracker.STORAGE_VERSION,
				seenSettings: this.state.seenSettings,
				lastConfigHash: this.state.lastConfigHash,
				firstRun: this.state.firstRun,
				lastUpdated: new Date().toISOString()
			};

			await this.context.globalState.update(NewSettingsTracker.STORAGE_KEY, stateToStore);
		} catch {
			// Ignore storage errors - the feature will continue to work
			// but won't persist state across sessions
		}
	}

	/**
	 * Create default state for new installations
	 */
	private createDefaultState(): NewSettingsState {
		return {
			seenSettings: {},
			lastConfigHash: undefined,
			firstRun: true
		};
	}
}