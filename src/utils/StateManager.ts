import * as vscode from 'vscode';
import { IStateManager, SettingDefinition, SettingsState, RecommendationSummary } from '../types';

/**
 * Service for managing application state and VS Code configuration
 */
export class StateManager implements IStateManager {
	private static readonly GLOBAL_PENDING_KEY = 'remoteConfig.hasPendingChanges';
	private static readonly GLOBAL_LAST_CHECKED = 'remoteConfig.lastChecked';

	constructor(private readonly context: vscode.ExtensionContext) {}

	/**
	 * Collect current setting values from VS Code configuration
	 */
	collectCurrentSettings(definitions: SettingDefinition[]): Record<string, any> {
		const config = vscode.workspace.getConfiguration();
		const settings: Record<string, any> = {};
		
		for (const def of definitions) {
			settings[def.key] = config.get(def.key);
		}
		
		return settings;
	}

	/**
	 * Evaluate recommendations for all settings and add recommendation status
	 */
	evaluateRecommendations(definitions: SettingDefinition[]): SettingDefinition[] {
		const config = vscode.workspace.getConfiguration();
		
		return definitions.map(def => {
			const hasRecommendation = def.recommended !== undefined;
			let matchesRecommendation = false;

			if (hasRecommendation) {
				const currentValue = config.get(def.key);
				matchesRecommendation = this.compareValues(currentValue, def.recommended, def.type);
			}

			return {
				...def,
				hasRecommendation,
				matchesRecommendation
			};
		});
	}

	/**
	 * Compare current value with recommended value, handling different types appropriately
	 */
	private compareValues(currentValue: any, recommendedValue: any, type: SettingDefinition['type']): boolean {
		// Handle undefined/null cases
		if (currentValue === undefined || currentValue === null) {
			return recommendedValue === undefined || recommendedValue === null;
		}

		// Type-specific comparisons
		switch (type) {
			case 'boolean':
				return Boolean(currentValue) === Boolean(recommendedValue);
			
			case 'number':
				return Number(currentValue) === Number(recommendedValue);
			
			case 'string':
				return String(currentValue) === String(recommendedValue);
			
			case 'json':
				try {
					return JSON.stringify(currentValue) === JSON.stringify(recommendedValue);
				} catch {
					return false;
				}
			
			default:
				// Fallback to strict equality
				return currentValue === recommendedValue;
		}
	}

	/**
	 * Calculate summary statistics for recommendations
	 */
	private calculateRecommendationSummary(definitions: SettingDefinition[]): RecommendationSummary {
		let total = 0;
		let matching = 0;
		let differing = 0;

		for (const def of definitions) {
			if (def.hasRecommendation) {
				total++;
				if (def.matchesRecommendation) {
					matching++;
				} else {
					differing++;
				}
			}
		}

		return { total, matching, differing };
	}

	/**
	 * Build complete webview state including settings, definitions, and metadata
	 */
	buildWebviewState(definitions: SettingDefinition[]): SettingsState {
		// Evaluate recommendations first
		const evaluatedDefinitions = this.evaluateRecommendations(definitions);

		// Enrich definitions with extension availability info
		const enrichedDefinitions = evaluatedDefinitions.map(def => {
			const requires = Array.isArray(def.requires) ? def.requires : [];
			const missingExtensions = requires.filter(id => !vscode.extensions.getExtension(id));
			
			return {
				...def,
				missingExtensions
			} as SettingDefinition;
		});

		// Get current configuration values
		const settings = this.collectCurrentSettings(enrichedDefinitions);

		// Get unique groups
		const groups = Array.from(new Set(enrichedDefinitions.map(def => def.group)));

		// Get remote configuration status
		const remotePending = this.hasPendingRemoteChanges();
		const remoteLastChecked = this.getLastRemoteCheck();

		// Calculate recommendation summary
		const recommendationSummary = this.calculateRecommendationSummary(enrichedDefinitions);

		const state: SettingsState = {
			settings,
			definitions: enrichedDefinitions,
			groups,
			remotePending,
			remoteLastChecked: remoteLastChecked || undefined,
			recommendationSummary
		};

		return state;
	}

	/**
	 * Update a setting value in VS Code configuration
	 */
	async updateSetting(key: string, value: any): Promise<void> {
		await vscode.workspace.getConfiguration().update(
			key, 
			value, 
			vscode.ConfigurationTarget.Global
		);
	}

	/**
	 * Check if an extension is installed
	 */
	isExtensionInstalled(extensionId: string): boolean {
		return !!vscode.extensions.getExtension(extensionId);
	}

	/**
	 * Get list of missing extensions for a setting
	 */
	getMissingExtensions(requires: string[]): string[] {
		return requires.filter(id => !this.isExtensionInstalled(id));
	}

	/**
	 * Check if there are pending remote configuration changes
	 */
	hasPendingRemoteChanges(): boolean {
		return !!this.context.globalState.get<boolean>(StateManager.GLOBAL_PENDING_KEY);
	}

	/**
	 * Get the timestamp of the last remote configuration check
	 */
	getLastRemoteCheck(): string | null {
		return this.context.globalState.get<string>(StateManager.GLOBAL_LAST_CHECKED) || null;
	}

	/**
	 * Set the pending remote changes flag
	 */
	async setPendingRemoteChanges(pending: boolean): Promise<void> {
		try {
			await this.context.globalState.update(StateManager.GLOBAL_PENDING_KEY, pending);
		} catch {
			// Ignore storage errors
		}
	}

	/**
	 * Set the last remote check timestamp
	 */
	async setLastRemoteCheck(timestamp?: string): Promise<void> {
		try {
			const time = timestamp || new Date().toISOString();
			await this.context.globalState.update(StateManager.GLOBAL_LAST_CHECKED, time);
		} catch {
			// Ignore storage errors
		}
	}

	/**
	 * Attempt to install VS Code extensions
	 */
	async installExtensions(extensionIds: string[]): Promise<void> {
		const installPromises: Thenable<unknown>[] = [];
		
		for (const id of extensionIds) {
			try {
				const existing = vscode.extensions.getExtension(id);
				if (existing) {
					// Already installed
					continue;
				}

				// Attempt direct installation
				const promise = vscode.commands.executeCommand('workbench.extensions.installExtension', id);
				installPromises.push(promise);
			} catch {
				// Ignore installation errors
			}
		}

		// Wait for all installations to complete
		if (installPromises.length > 0) {
			try {
				await Promise.all(installPromises);
			} catch {
				// Ignore installation errors
			}
		}
	}

	/**
	 * Get configuration inspection info for a key
	 */
	inspectConfiguration(key: string): any {
		try {
			return vscode.workspace.getConfiguration().inspect(key);
		} catch {
			return undefined;
		}
	}

	/**
	 * Check if a configuration key is explicitly set by the user
	 */
	isConfigurationExplicitlySet(key: string): boolean {
		const info = this.inspectConfiguration(key);
		return !!(info?.globalValue !== undefined || 
			info?.workspaceValue !== undefined || 
			info?.workspaceFolderValue !== undefined);
	}
}