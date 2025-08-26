import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { 
	IConfigurationService, 
	IStateManager, 
	IHtmlRenderer, 
	INewSettingsTracker,
	SettingDefinition 
} from '../types';
import { Constants } from '../constants';
import { ignoreErrorsSync } from '../utils/common';

/**
 * Webview provider for On By Default settings management
 */
export class OnByDefaultSettingsWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	private view?: vscode.WebviewView;
	private settingDefinitions: SettingDefinition[] = [];
	private disposables: vscode.Disposable[] = [];

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly configService: IConfigurationService,
		private readonly stateManager: IStateManager,
		private readonly htmlRenderer: IHtmlRenderer,
		private readonly newSettingsTracker: INewSettingsTracker
	) {}

	/**
	 * Register and initialize the webview when resolved by VS Code
	 */
	async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
		this.view = webviewView;
		
		// Configure webview options
		this.view.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.file(path.join(this.context.extensionPath, 'media'))
			]
		};

		// Set up message handling
		this.view.webview.onDidReceiveMessage(msg => this.handleMessage(msg));

		// Set webview reference for HTML renderer
		this.htmlRenderer.setWebviewView(webviewView);

		// Load initial configuration and start services
		await this.initializeConfiguration();
		this.configService.startPolling();
		this.updateWebviewState();

		// Refresh when view becomes visible
		this.view.onDidChangeVisibility(() => {
			if (this.view?.visible) {
				this.updateWebviewState();
			}
		});
	}

	/**
	 * Start external watchers for configuration and extension changes
	 */
	startExternalWatchers(): void {
		const settingKeys = this.settingDefinitions.map(def => def.key);
		this.startWatching(settingKeys);

		// Watch for configuration service changes
		this.configService.onConfigurationChanged(result => {
			this.settingDefinitions = result.definitions;
			this.updateWebviewState();
		});
	}

	/**
	 * Update the webview with current state (public for command access)
	 */
	updateWebviewState(): void {
		if (!this.view) {return;}

		const state = this.stateManager.buildWebviewState(this.settingDefinitions);
		this.view.webview.html = this.htmlRenderer.renderHtml(state);
	}

	/**
	 * Dispose of resources and cleanup
	 */
	dispose(): void {
		this.disposables.forEach(d => ignoreErrorsSync(() => d.dispose()));
		this.disposables.length = 0;
		this.configService.stopPolling();
	}

	private async handleMessage(message: any): Promise<void> {
		switch (message?.type) {
			case 'ready':
				this.updateWebviewState();
				break;

			case 'refreshRemoteConfig':
				await this.refreshRemoteConfig();
				break;

			case 'checkRemoteNow':
				await this.checkRemoteNow();
				break;

			case 'updateSetting':
				await this.handleUpdateSetting(message);
				break;

			case 'installExtensions':
				await this.handleInstallExtensions(message);
				break;

			case 'markAsSeen':
				await this.handleMarkAsSeen(message);
				break;

			case 'markAllAsSeen':
				await this.handleMarkAllAsSeen();
				break;
		}
	}

	private async handleUpdateSetting(message: any): Promise<void> {
		if (typeof message.key !== 'string') {return;}

		await this.stateManager.updateSetting(message.key, message.value);
		
		// Auto-mark as seen when user modifies
		if (this.newSettingsTracker.isSettingNew(message.key)) {
			await this.newSettingsTracker.markAsSeen([message.key]);
		}
		
		this.updateWebviewState();
	}

	private async handleInstallExtensions(message: any): Promise<void> {
		if (!Array.isArray(message.ids) || message.ids.length === 0) {return;}
		
		await this.stateManager.installExtensions(message.ids);
	}

	private async handleMarkAsSeen(message: any): Promise<void> {
		if (!Array.isArray(message.settingKeys) || message.settingKeys.length === 0) {return;}
		
		await this.newSettingsTracker.markAsSeen(message.settingKeys);
		this.updateWebviewState();
	}

	private async handleMarkAllAsSeen(): Promise<void> {
		await this.newSettingsTracker.markAllAsSeen(this.settingDefinitions);
		this.updateWebviewState();
	}

	/**
	 * Start all watchers
	 */
	private startWatching(settingKeys: string[]): void {
		this.watchConfiguration(settingKeys);
		this.watchExtensions();
		this.watchBundledConfig();
	}

	private watchConfiguration(settingKeys: string[]): void {
		this.disposables.push(
			vscode.workspace.onDidChangeConfiguration(e => {
				const affected = settingKeys.some(key => e.affectsConfiguration(key));
				
				if (affected) {
					this.updateWebviewState();
				}

				if (e.affectsConfiguration('onByDefault.remoteConfigUrl')) {
					void this.handleRemoteConfigUrlChange();
				}
			})
		);
	}

	private watchExtensions(): void {
		this.disposables.push(
			vscode.extensions.onDidChange(() => this.updateWebviewState())
		);
	}

	private watchBundledConfig(): void {
		const configPath = path.join(this.context.extensionPath, 'media', 'config.json');
		
		if (!fs.existsSync(configPath)) {return;}

		const handleChange = () => void this.handleRemoteConfigUrlChange();

		// Try fs.watch first, fallback to fs.watchFile
		const watcher = ignoreErrorsSync(() => {
			const w = fs.watch(configPath, { persistent: false }, handleChange);
			return new vscode.Disposable(() => w.close());
		});

		if (watcher) {
			this.disposables.push(watcher);
		} else {
			// Fallback to polling
			ignoreErrorsSync(() => fs.watchFile(configPath, { interval: 1000 }, handleChange));
			this.disposables.push(new vscode.Disposable(() => 
				ignoreErrorsSync(() => fs.unwatchFile(configPath))
			));
		}
	}

	private async initializeConfiguration(): Promise<void> {
		try {
			const result = await this.configService.loadConfiguration();
			this.settingDefinitions = result.definitions;
			
			await this.newSettingsTracker.initialize(this.settingDefinitions);
		} catch {
			this.settingDefinitions = [];
		}
	}

	private async refreshRemoteConfig(): Promise<void> {
		try {
			await this.configService.refreshConfiguration();
			this.updateWebviewState();
		} catch {
			// Refresh errors are handled gracefully
		}
	}

	private async checkRemoteNow(): Promise<void> {
		try {
			await this.configService.checkForRemoteUpdates();
			this.updateWebviewState();
		} catch {
			// Check errors are handled gracefully
		}
	}

	private async handleRemoteConfigUrlChange(): Promise<void> {
		try {
			await this.configService.loadConfiguration();
			this.updateWebviewState();
		} catch {
			// Configuration reload errors are handled gracefully
		}
	}
}