import * as vscode from 'vscode';
import { IStateManager, INewSettingsTracker, SettingDefinition, SettingsState, RecommendationSummary } from '../types';
import { Constants } from '../constants';
import { compareValues } from './common';

/**
 * Service for managing application state and VS Code configuration
 */
export class StateManager implements IStateManager {
	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly newSettingsTracker: INewSettingsTracker
	) {}

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
	 * Build complete webview state including settings, definitions, and metadata
	 */
	buildWebviewState(definitions: SettingDefinition[]): SettingsState {
		// Evaluate recommendations
		const evaluatedDefinitions = this.evaluateRecommendations(definitions);

		// Enrich with extension and new setting information
		const enrichedDefinitions = evaluatedDefinitions.map(def => ({
			...def,
			missingExtensions: this.getMissingExtensions(def.requires || []),
			isNew: this.newSettingsTracker.isSettingNew(def.key)
		}));

		// Get current configuration values
		const settings = this.collectCurrentSettings(enrichedDefinitions);

		// Calculate metadata
		const groups = Array.from(new Set(enrichedDefinitions.map((def: SettingDefinition) => def.group)));
		const recommendationSummary = this.calculateRecommendationSummary(enrichedDefinitions);
		const newSettingsCount = enrichedDefinitions.filter((def: SettingDefinition) => def.isNew).length;
		const newSettingsByGroup = this.calculateNewSettingsByGroup(enrichedDefinitions);

		return {
			settings,
			definitions: enrichedDefinitions,
			groups,
			remotePending: this.hasPendingRemoteChanges(),
			remoteLastChecked: this.getLastRemoteCheck() || undefined,
			recommendationSummary,
			newSettingsCount,
			hasNewSettings: newSettingsCount > 0,
			newSettingsByGroup
		};
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
	 * Attempt to install VS Code extensions
	 */
	async installExtensions(extensionIds: string[]): Promise<void> {
		const installPromises = extensionIds
			.filter(id => !vscode.extensions.getExtension(id))
			.map(id => vscode.commands.executeCommand('workbench.extensions.installExtension', id));

		if (installPromises.length > 0) {
			try {
				await Promise.all(installPromises);
			} catch {
				// Ignore installation errors
			}
		}
	}

	private getMissingExtensions(requires: string[]): string[] {
		return requires.filter(id => !vscode.extensions.getExtension(id));
	}

	private calculateNewSettingsByGroup(definitions: SettingDefinition[]): Record<string, number> {
		const groupCounts: Record<string, number> = {};

		for (const def of definitions) {
			if (def.isNew) {
				groupCounts[def.group] = (groupCounts[def.group] || 0) + 1;
			}
		}

		return groupCounts;
	}

	private hasPendingRemoteChanges(): boolean {
		return !!this.context.globalState.get<boolean>(Constants.GLOBAL_KEYS.REMOTE_PENDING);
	}

	private getLastRemoteCheck(): string | null {
		return this.context.globalState.get<string>(Constants.GLOBAL_KEYS.REMOTE_LAST_CHECKED) || null;
	}

	/**
	 * Evaluate recommendations for all settings
	 */
	private evaluateRecommendations(definitions: SettingDefinition[]): SettingDefinition[] {
		const config = vscode.workspace.getConfiguration();
		
		return definitions.map(def => {
			const hasRecommendation = def.recommended !== undefined;
			let matchesRecommendation = false;

			if (hasRecommendation) {
				const currentValue = config.get(def.key);
				matchesRecommendation = compareValues(currentValue, def.recommended, def.type);
			}

			return {
				...def,
				hasRecommendation,
				matchesRecommendation
			};
		});
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
}