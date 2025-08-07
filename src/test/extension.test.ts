import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
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
		const val = config.get<boolean>('chat.tools.autoApprove');
		assert.strictEqual(val, true);
		await config.update('chat.tools.autoApprove', false, vscode.ConfigurationTarget.Global);
		assert.strictEqual(config.get<boolean>('chat.tools.autoApprove'), false);
	});

	test('Max requests numeric validation', async () => {
		const config = vscode.workspace.getConfiguration();
		await config.update('chat.agent.maxRequests', 7, vscode.ConfigurationTarget.Global);
		assert.strictEqual(config.get<number>('chat.agent.maxRequests'), 7);
		await config.update('chat.agent.maxRequests', 1, vscode.ConfigurationTarget.Global);
		assert.strictEqual(config.get<number>('chat.agent.maxRequests'), 1);
	});
});
