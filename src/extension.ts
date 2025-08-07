// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

class UltimateAiSettingItem extends vscode.TreeItem {
	constructor(
		public readonly key: string,
		public readonly label: string,
		public readonly contextValue: string,
		public readonly value: any,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
	) {
		super(label, collapsibleState);
		this.description = String(value);
		if (typeof value === 'boolean') {
			this.iconPath = new vscode.ThemeIcon(value ? 'check' : 'circle-slash');
			this.command = {
				command: 'ultimate-ai.toggleAutoApprove',
				title: 'Toggle Auto Approve',
				arguments: [this]
			};
		} else if (typeof value === 'number') {
			this.iconPath = new vscode.ThemeIcon('symbol-number');
			this.command = {
				command: 'ultimate-ai.setMaxRequests',
				title: 'Set Max Requests',
				arguments: [this]
			};
		}
	}
}

class UltimateAiSettingsProvider implements vscode.TreeDataProvider<UltimateAiSettingItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<UltimateAiSettingItem | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	refresh(): void { this._onDidChangeTreeData.fire(); }

	getTreeItem(element: UltimateAiSettingItem): vscode.TreeItem { return element; }

	getChildren(): Thenable<UltimateAiSettingItem[]> {
		const config = vscode.workspace.getConfiguration();
		const autoApprove = config.get<boolean>('chat.tools.autoApprove', false);
		const maxRequests = config.get<number>('chat.agent.maxRequests', 5);
		return Promise.resolve([
			new UltimateAiSettingItem('chat.tools.autoApprove', 'Auto Approve', 'ultimateAi.boolean', autoApprove),
			new UltimateAiSettingItem('chat.agent.maxRequests', 'Max Requests', 'ultimateAi.number', maxRequests)
		]);
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "ultimate-ai" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const settingsProvider = new UltimateAiSettingsProvider();
	vscode.window.registerTreeDataProvider('ultimateAiSettings', settingsProvider);

	context.subscriptions.push(
		vscode.commands.registerCommand('ultimate-ai.helloWorld', () => {
			vscode.window.showInformationMessage('Hello World from Ultimate AI!');
		}),
		vscode.commands.registerCommand('ultimate-ai.refreshSettings', () => settingsProvider.refresh()),
		vscode.commands.registerCommand('ultimate-ai.toggleAutoApprove', async () => {
			const config = vscode.workspace.getConfiguration();
			const current = config.get<boolean>('chat.tools.autoApprove', false);
			await config.update('chat.tools.autoApprove', !current, vscode.ConfigurationTarget.Global);
			settingsProvider.refresh();
		}),
		vscode.commands.registerCommand('ultimate-ai.setMaxRequests', async () => {
			const config = vscode.workspace.getConfiguration();
			const current = config.get<number>('chat.agent.maxRequests', 5);
			const value = await vscode.window.showInputBox({
				prompt: 'Set Max Requests',
				value: String(current),
						validateInput: (val) => {
							const num = Number(val);
							if (!Number.isInteger(num) || num < 1) {
								return 'Enter an integer >= 1';
							}
							return null;
						}
			});
			if (value) {
				await config.update('chat.agent.maxRequests', Number(value), vscode.ConfigurationTarget.Global);
				settingsProvider.refresh();
			}
		})
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('chat.tools.autoApprove') || e.affectsConfiguration('chat.agent.maxRequests')) {
				settingsProvider.refresh();
			}
		})
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}
