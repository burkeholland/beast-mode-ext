import * as assert from 'assert';
import * as vscode from 'vscode';
import { NewSettingsTracker } from '../services/NewSettingsTracker';
import { SettingDefinition } from '../types';

suite('NewSettingsTracker Test Suite', () => {
	let mockContext: any;
	let tracker: NewSettingsTracker;

	setup(() => {
		// Create a fresh mock context for each test
		const globalState = new Map<string, any>();
		mockContext = {
			extensionPath: __dirname,
			globalState: {
				get: (key: string) => globalState.get(key),
				update: async (key: string, value: any) => {
					globalState.set(key, value);
				}
			},
			subscriptions: []
		};
		
		tracker = new NewSettingsTracker(mockContext);
	});

	test('Initialize with empty state on first run', async () => {
		const definitions: SettingDefinition[] = [
			{
				key: 'test.setting1',
				type: 'boolean',
				group: 'Test',
				description: 'Test setting 1'
			},
			{
				key: 'test.setting2',
				type: 'string',
				group: 'Test',
				description: 'Test setting 2'
			}
		];

		await tracker.initialize(definitions);

		// After initialization, all settings should be marked as seen (first run behavior)
		assert.strictEqual(tracker.isSettingNew('test.setting1'), false);
		assert.strictEqual(tracker.isSettingNew('test.setting2'), false);
		assert.strictEqual(tracker.getNewSettingsCount(definitions), 0);
	});

	test('Detect new settings after configuration change', async () => {
		const initialDefinitions: SettingDefinition[] = [
			{
				key: 'test.setting1',
				type: 'boolean',
				group: 'Test',
				description: 'Test setting 1'
			}
		];

		const expandedDefinitions: SettingDefinition[] = [
			{
				key: 'test.setting1',
				type: 'boolean',
				group: 'Test',
				description: 'Test setting 1'
			},
			{
				key: 'test.setting2',
				type: 'string',
				group: 'Test',
				description: 'Test setting 2'
			},
			{
				key: 'test.setting3',
				type: 'number',
				group: 'Test',
				description: 'Test setting 3'
			}
		];

		// Initialize with initial settings
		await tracker.initialize(initialDefinitions);

		// Simulate configuration change with new settings
		const newSettings = tracker.detectNewSettings(expandedDefinitions);

		assert.strictEqual(newSettings.length, 2);
		assert.strictEqual(newSettings[0].key, 'test.setting2');
		assert.strictEqual(newSettings[1].key, 'test.setting3');

		// Check individual setting status
		assert.strictEqual(tracker.isSettingNew('test.setting1'), false);
		assert.strictEqual(tracker.isSettingNew('test.setting2'), true);
		assert.strictEqual(tracker.isSettingNew('test.setting3'), true);
		assert.strictEqual(tracker.getNewSettingsCount(expandedDefinitions), 2);
	});

	test('Mark individual settings as seen', async () => {
		const definitions: SettingDefinition[] = [
			{
				key: 'test.setting1',
				type: 'boolean',
				group: 'Test',
				description: 'Test setting 1'
			},
			{
				key: 'test.setting2',
				type: 'string',
				group: 'Test',
				description: 'Test setting 2'
			}
		];

		// Initialize and simulate new settings
		await tracker.initialize([]);
		tracker.detectNewSettings(definitions);

		// Mark one setting as seen
		await tracker.markAsSeen(['test.setting1']);

		assert.strictEqual(tracker.isSettingNew('test.setting1'), false);
		assert.strictEqual(tracker.isSettingNew('test.setting2'), true);
		assert.strictEqual(tracker.getNewSettingsCount(definitions), 1);
	});

	test('Mark all settings as seen', async () => {
		const definitions: SettingDefinition[] = [
			{
				key: 'test.setting1',
				type: 'boolean',
				group: 'Test',
				description: 'Test setting 1'
			},
			{
				key: 'test.setting2',
				type: 'string',
				group: 'Test',
				description: 'Test setting 2'
			}
		];

		// Initialize and simulate new settings
		await tracker.initialize([]);
		tracker.detectNewSettings(definitions);

		// Mark all settings as seen
		await tracker.markAllAsSeen(definitions);

		assert.strictEqual(tracker.isSettingNew('test.setting1'), false);
		assert.strictEqual(tracker.isSettingNew('test.setting2'), false);
		assert.strictEqual(tracker.getNewSettingsCount(definitions), 0);
	});

	test('State persistence across tracker instances', async () => {
		const definitions: SettingDefinition[] = [
			{
				key: 'test.setting1',
				type: 'boolean',
				group: 'Test',
				description: 'Test setting 1'
			}
		];

		// Mark setting as seen with first tracker
		await tracker.initialize([]);
		tracker.detectNewSettings(definitions);
		await tracker.markAsSeen(['test.setting1']);

		// Create new tracker with same context
		const tracker2 = new NewSettingsTracker(mockContext);

		// State should be preserved
		assert.strictEqual(tracker2.isSettingNew('test.setting1'), false);
		assert.strictEqual(tracker2.getNewSettingsCount(definitions), 0);
	});

	test('Clear state functionality', async () => {
		const definitions: SettingDefinition[] = [
			{
				key: 'test.setting1',
				type: 'boolean',
				group: 'Test',
				description: 'Test setting 1'
			}
		];

		// Initialize and mark setting as seen
		await tracker.initialize(definitions);

		// Clear state
		await tracker.clearState();

		// All settings should be new again
		tracker.detectNewSettings(definitions);
		assert.strictEqual(tracker.isSettingNew('test.setting1'), true);
		assert.strictEqual(tracker.getNewSettingsCount(definitions), 1);
	});

	test('Hash calculation detects configuration changes', async () => {
		const definitions1: SettingDefinition[] = [
			{
				key: 'test.setting1',
				type: 'boolean',
				group: 'Test',
				description: 'Test setting 1'
			}
		];

		const definitions2: SettingDefinition[] = [
			{
				key: 'test.setting1',
				type: 'boolean',
				group: 'Test',
				description: 'Test setting 1'
			},
			{
				key: 'test.setting2',
				type: 'string',
				group: 'Test',
				description: 'Test setting 2'
			}
		];

		// Initialize with first configuration
		await tracker.initialize(definitions1);

		// First detection should find new setting
		const newSettings1 = tracker.detectNewSettings(definitions2);
		assert.strictEqual(newSettings1.length, 1);

		// Second detection with same configuration should find no new settings
		const newSettings2 = tracker.detectNewSettings(definitions2);
		assert.strictEqual(newSettings2.length, 0);
	});

	test('Error handling for corrupt state', async () => {
		// Manually corrupt the stored state
		await mockContext.globalState.update('newSettings.state', { invalidData: true });

		// Should gracefully handle corrupt state
		const tracker2 = new NewSettingsTracker(mockContext);
		const definitions: SettingDefinition[] = [
			{
				key: 'test.setting1',
				type: 'boolean',
				group: 'Test',
				description: 'Test setting 1'
			}
		];

		// Should not throw errors
		await tracker2.initialize(definitions);
		const newSettings = tracker2.detectNewSettings(definitions);
		
		// Should work normally despite corrupt initial state
		assert.strictEqual(typeof tracker2.isSettingNew('test.setting1'), 'boolean');
		assert.strictEqual(typeof tracker2.getNewSettingsCount(definitions), 'number');
	});
});