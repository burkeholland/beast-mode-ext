import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { 
	IConfigurationService, 
	IStateManager, 
	IHtmlRenderer, 
	INewSettingsTracker,
	SettingDefinition 
} from '../types';

/**
 * Webview provider for On By Default settings management
 */
export class OnByDefaultSettingsWebviewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'onByDefaultSettings';

	private view?: vscode.WebviewView;
	private disposables: vscode.Disposable[] = [];
	private settingDefinitions: SettingDefinition[] = [];

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
		// Watch for configuration changes
		this.disposables.push(
			vscode.workspace.onDidChangeConfiguration(e => {
				const affected = this.settingDefinitions.some(def => 
					e.affectsConfiguration(def.key)
				);
				
				if (affected) {
					this.updateWebviewState();
				}

				// Reload configuration if remote URL changes
				if (e.affectsConfiguration('onByDefault.remoteConfigUrl')) {
					this.handleRemoteConfigUrlChange();
				}
			})
		);

		// Watch for extension changes (affects schema availability)
		this.disposables.push(
			vscode.extensions.onDidChange(() => {
				this.updateWebviewState();
			})
		);

		// Watch for configuration service changes
		this.disposables.push(
			this.configService.onConfigurationChanged(result => {
				this.settingDefinitions = result.definitions;
				this.updateWebviewState();
			})
		);

		// Watch bundled config file for development
		this.watchBundledConfigFile();
	}

	/**
	 * Dispose of resources and cleanup
	 */
	dispose(): void {
		// Dispose all subscriptions
		for (const disposable of this.disposables.splice(0)) {
			try {
				disposable.dispose();
			} catch {
				// Ignore disposal errors
			}
		}

		// Stop configuration service
		this.configService.stopPolling();
	}

	/**
	 * Handle messages from the webview
	 */
	private async handleMessage(message: any): Promise<void> {
		switch (message?.type) {
			case 'ready':
				this.updateWebviewState();
				break;

			case 'refreshRemoteConfig':
				await this.handleRefreshRemoteConfig();
				break;

			case 'checkRemoteNow':
				await this.handleCheckRemoteNow();
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

			default:
				// Unknown message types are ignored
				break;
		}
	}

	/**
	 * Initialize configuration on startup
	 */
	private async initializeConfiguration(): Promise<void> {
		try {
			const result = await this.configService.loadConfiguration();
			this.settingDefinitions = result.definitions;
			
			// Initialize new settings tracker with current configuration
			await this.newSettingsTracker.initialize(this.settingDefinitions);
		} catch {
			// Configuration loading errors are handled gracefully
			this.settingDefinitions = [];
		}
	}

	/**
	 * Update the webview with current state (public for command access)
	 */
	updateWebviewState(): void {
		if (!this.view) {
			return;
		}

		const state = this.stateManager.buildWebviewState(this.settingDefinitions);
		this.view.webview.html = this.htmlRenderer.renderHtml(state);
	}

	/**
	 * Handle refresh remote configuration request
	 */
	private async handleRefreshRemoteConfig(): Promise<void> {
		try {
			await this.configService.refreshConfiguration();
			this.updateWebviewState();
		} catch {
			// Refresh errors are handled gracefully
		}
	}

	/**
	 * Handle check remote now request
	 */
	private async handleCheckRemoteNow(): Promise<void> {
		try {
			await this.configService.checkForRemoteUpdates();
			this.updateWebviewState();
		} catch {
			// Check errors are handled gracefully
		}
	}

	/**
	 * Handle setting update request
	 */
	private async handleUpdateSetting(message: any): Promise<void> {
		if (typeof message.key === 'string') {
			try {
				await this.stateManager.updateSetting(message.key, message.value);
				
				// Automatically mark the setting as seen when user modifies it
				if (this.newSettingsTracker.isSettingNew(message.key)) {
					await this.newSettingsTracker.markAsSeen([message.key]);
				}
				
				this.updateWebviewState();
			} catch {
				// Setting update errors are handled gracefully
			}
		}
	}

	/**
	 * Handle extension installation request
	 */
	private async handleInstallExtensions(message: any): Promise<void> {
		if (Array.isArray(message.ids) && message.ids.length > 0) {
			try {
				await this.stateManager.installExtensions(message.ids);
			} catch {
				// Installation errors are handled gracefully
			}
		}
	}

	/**
	 * Handle mark as seen request for specific settings
	 */
	private async handleMarkAsSeen(message: any): Promise<void> {
		if (Array.isArray(message.settingKeys) && message.settingKeys.length > 0) {
			try {
				await this.newSettingsTracker.markAsSeen(message.settingKeys);
				this.updateWebviewState();
			} catch {
				// Mark as seen errors are handled gracefully
			}
		}
	}

	/**
	 * Handle mark all as seen request
	 */
	private async handleMarkAllAsSeen(): Promise<void> {
		try {
			await this.newSettingsTracker.markAllAsSeen(this.settingDefinitions);
			this.updateWebviewState();
		} catch {
			// Mark all as seen errors are handled gracefully
		}
	}

	/**
	 * Handle remote config URL changes
	 */
	private async handleRemoteConfigUrlChange(): Promise<void> {
		try {
			await this.configService.loadConfiguration();
			this.updateWebviewState();
		} catch {
			// Configuration reload errors are handled gracefully
		}
	}

	/**
	 * Watch bundled config file for development purposes
	 */
	private watchBundledConfigFile(): void {
		const configPath = path.join(this.context.extensionPath, 'media', 'config.json');
		
		if (!fs.existsSync(configPath)) {
			return;
		}

		try {
			const watcher = fs.watch(configPath, { persistent: false }, async () => {
				await this.handleRemoteConfigUrlChange();
			});
			
			this.disposables.push(new vscode.Disposable(() => watcher.close()));
		} catch {
			// Fallback to fs.watchFile if fs.watch fails
			try {
				fs.watchFile(configPath, { interval: 1000 }, async () => {
					await this.handleRemoteConfigUrlChange();
				});
				
				this.disposables.push(new vscode.Disposable(() => 
					fs.unwatchFile(configPath)
				));
			} catch {
				// Ignore file watching errors
			}
		}
	}
}