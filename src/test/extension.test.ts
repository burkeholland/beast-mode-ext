import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { StateManager } from '../utils/StateManager';
import { SettingDefinition, INewSettingsTracker } from '../types';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('Can update autoApprove setting', async () => {
		const config = vscode.workspace.getConfiguration();
		await config.update('chat.tools.autoApprove', true, vscode.ConfigurationTarget.Global);
		const autoApprove = config.inspect<boolean>('chat.tools.autoApprove');
		assert.strictEqual(autoApprove?.globalValue, true);
		await config.update('chat.tools.autoApprove', false, vscode.ConfigurationTarget.Global);
		const autoApprove2 = config.inspect<boolean>('chat.tools.autoApprove');
		assert.strictEqual(autoApprove2?.globalValue, false);
	});

	test('Max requests numeric validation', async () => {
		const config = vscode.workspace.getConfiguration();
		await config.update('chat.agent.maxRequests', 7, vscode.ConfigurationTarget.Global);
		const mr = config.inspect<number>('chat.agent.maxRequests');
		assert.strictEqual(mr?.globalValue, 7);
		await config.update('chat.agent.maxRequests', 1, vscode.ConfigurationTarget.Global);
		const mr2 = config.inspect<number>('chat.agent.maxRequests');
		assert.strictEqual(mr2?.globalValue, 1);
	});

	test('Recommendation evaluation works correctly', async () => {
		const mockContext = {
			extensionPath: __dirname,
			globalState: new Map(),
			subscriptions: []
		} as any;

		// Mock the new settings tracker
		const mockNewSettingsTracker: INewSettingsTracker = {
			initialize: async () => {},
			detectNewSettings: () => [],
			markAsSeen: async () => {},
			markAllAsSeen: async () => {},
			isSettingNew: () => false,
			getNewSettingsCount: () => 0,
			clearState: async () => {}
		};

		const stateManager = new StateManager(mockContext, mockNewSettingsTracker);

		// Set up test configuration values
		const config = vscode.workspace.getConfiguration();
		await config.update('chat.tools.autoApprove', false, vscode.ConfigurationTarget.Global);
		await config.update('chat.agent.maxRequests', 50, vscode.ConfigurationTarget.Global);

		// Mock setting definitions with recommendations
		const definitions: SettingDefinition[] = [
			{
				key: 'chat.tools.autoApprove',
				type: 'boolean',
				group: 'Test',
				description: 'Test setting',
				recommended: true // Different from current value (false)
			},
			{
				key: 'chat.agent.maxRequests',
				type: 'number',
				group: 'Test',
				description: 'Test setting',
				recommended: 50 // Same as current value
			},
			{
				key: 'some.other.setting',
				type: 'string',
				group: 'Test',
				description: 'Test setting'
				// No recommended value
			}
		];

		// Use the public buildWebviewState method which internally calls evaluateRecommendations
		const state = stateManager.buildWebviewState(definitions);

		// Test hasRecommendation flags
		assert.strictEqual(state.definitions[0].hasRecommendation, true);
		assert.strictEqual(state.definitions[1].hasRecommendation, true);
		assert.strictEqual(state.definitions[2].hasRecommendation, false);

		// Test matchesRecommendation flags
		assert.strictEqual(state.definitions[0].matchesRecommendation, false); // false !== true
		assert.strictEqual(state.definitions[1].matchesRecommendation, true);  // 50 === 50
		assert.strictEqual(state.definitions[2].matchesRecommendation, false); // no recommendation

		// Test recommendation summary
		assert.strictEqual(state.recommendationSummary?.total, 2);
		assert.strictEqual(state.recommendationSummary?.matching, 1);
		assert.strictEqual(state.recommendationSummary?.differing, 1);
	});

	test('Recommendation comparison handles different types correctly', async () => {
		const mockContext = {
			extensionPath: __dirname,
			globalState: new Map(),
			subscriptions: []
		} as any;

		// Mock the new settings tracker
		const mockNewSettingsTracker: INewSettingsTracker = {
			initialize: async () => {},
			detectNewSettings: () => [],
			markAsSeen: async () => {},
			markAllAsSeen: async () => {},
			isSettingNew: () => false,
			getNewSettingsCount: () => 0,
			clearState: async () => {}
		};

		const stateManager = new StateManager(mockContext, mockNewSettingsTracker);

		// Set up test configuration values using existing registered settings
		const config = vscode.workspace.getConfiguration();
		await config.update('chat.tools.autoApprove', true, vscode.ConfigurationTarget.Global);
		await config.update('chat.agent.maxRequests', 42, vscode.ConfigurationTarget.Global);
		await config.update('chat.editor.wordWrap', 'on', vscode.ConfigurationTarget.Global);

		const definitions: SettingDefinition[] = [
			{
				key: 'chat.tools.autoApprove',
				type: 'boolean',
				group: 'Test',
				description: 'Boolean test',
				recommended: true
			},
			{
				key: 'chat.agent.maxRequests',
				type: 'number',
				group: 'Test',
				description: 'Number test',
				recommended: 42
			},
			{
				key: 'chat.editor.wordWrap',
				type: 'string',
				group: 'Test',
				description: 'String test',
				recommended: 'on'
			}
		];

		// Use the public buildWebviewState method which internally calls evaluateRecommendations
		const state = stateManager.buildWebviewState(definitions);

		// All should match their recommended values
		assert.strictEqual(state.definitions[0].matchesRecommendation, true);
		assert.strictEqual(state.definitions[1].matchesRecommendation, true);
		assert.strictEqual(state.definitions[2].matchesRecommendation, true);
	});

	test('New settings detection and marking integration', async () => {
		const mockContext = {
			extensionPath: __dirname,
			globalState: new Map(),
			subscriptions: []
		} as any;

		// Mock the new settings tracker
		const mockNewSettingsTracker: INewSettingsTracker = {
			initialize: async () => {},
			detectNewSettings: (definitions) => definitions.filter(def => def.key === 'new.setting'),
			markAsSeen: async () => {},
			markAllAsSeen: async () => {},
			isSettingNew: (key) => key === 'new.setting',
			getNewSettingsCount: (definitions) => definitions.filter(def => def.key === 'new.setting').length,
			clearState: async () => {}
		};

		const stateManager = new StateManager(mockContext, mockNewSettingsTracker);

		const definitions: SettingDefinition[] = [
			{
				key: 'existing.setting',
				type: 'boolean',
				group: 'Test',
				description: 'Existing setting'
			},
			{
				key: 'new.setting',
				type: 'string',
				group: 'Test',
				description: 'New setting'
			}
		];

		const state = stateManager.buildWebviewState(definitions);

		// Check that new settings information is included in state
		assert.strictEqual(state.hasNewSettings, true);
		assert.strictEqual(state.newSettingsCount, 1);
		assert.strictEqual(state.newSettingsByGroup?.['Test'], 1);

		// Check that settings are marked correctly
		const existingSetting = state.definitions.find(def => def.key === 'existing.setting');
		const newSetting = state.definitions.find(def => def.key === 'new.setting');

		assert.strictEqual(existingSetting?.isNew, false);
		assert.strictEqual(newSetting?.isNew, true);
	});
});
