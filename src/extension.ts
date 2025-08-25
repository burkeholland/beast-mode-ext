import * as vscode from 'vscode';

// Services
import { HttpService } from './services/HttpService';
import { ConfigurationService } from './services/ConfigurationService';
import { SchemaInferenceService } from './services/SchemaInferenceService';

// Utilities
import { StateManager } from './utils/StateManager';
import { HtmlRenderer } from './utils/HtmlRenderer';

// Providers
import { OnByDefaultSettingsWebviewProvider } from './providers/OnByDefaultSettingsWebviewProvider';

/**
 * Service container for dependency injection
 */
class ServiceContainer {
	private readonly context: vscode.ExtensionContext;
	
	// Service instances
	private _httpService?: HttpService;
	private _schemaService?: SchemaInferenceService;
	private _configService?: ConfigurationService;
	private _stateManager?: StateManager;
	private _htmlRenderer?: HtmlRenderer;
	private _provider?: OnByDefaultSettingsWebviewProvider;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
	}

	/**
	 * Get HTTP service instance
	 */
	get httpService(): HttpService {
		if (!this._httpService) {
			this._httpService = new HttpService(this.context);
		}
		return this._httpService;
	}

	/**
	 * Get schema inference service instance
	 */
	get schemaService(): SchemaInferenceService {
		if (!this._schemaService) {
			this._schemaService = new SchemaInferenceService(this.context);
		}
		return this._schemaService;
	}

	/**
	 * Get configuration service instance
	 */
	get configService(): ConfigurationService {
		if (!this._configService) {
			this._configService = new ConfigurationService(
				this.context,
				this.httpService,
				this.schemaService
			);
		}
		return this._configService;
	}

	/**
	 * Get state manager instance
	 */
	get stateManager(): StateManager {
		if (!this._stateManager) {
			this._stateManager = new StateManager(this.context);
		}
		return this._stateManager;
	}

	/**
	 * Get HTML renderer instance
	 */
	get htmlRenderer(): HtmlRenderer {
		if (!this._htmlRenderer) {
			this._htmlRenderer = new HtmlRenderer(this.context);
		}
		return this._htmlRenderer;
	}

	/**
	 * Get webview provider instance
	 */
	get provider(): OnByDefaultSettingsWebviewProvider {
		if (!this._provider) {
			this._provider = new OnByDefaultSettingsWebviewProvider(
				this.context,
				this.configService,
				this.stateManager,
				this.htmlRenderer
			);
		}
		return this._provider;
	}

	/**
	 * Dispose all services
	 */
	dispose(): void {
		this._provider?.dispose();
		this._configService?.dispose();
		// Other services don't need explicit disposal
	}
}

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext) {
	// Create service container
	const services = new ServiceContainer(context);

	// Register webview provider
	const provider = services.provider;
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			OnByDefaultSettingsWebviewProvider.viewType, 
			provider
		)
	);

	// Start external watchers
	provider.startExternalWatchers();

	// Register refresh command
	context.subscriptions.push(
		vscode.commands.registerCommand('on-by-default.refreshSettings', () => {
			provider.updateWebviewState();
		})
	);

	// Register service container for cleanup
	context.subscriptions.push(new vscode.Disposable(() => {
		services.dispose();
	}));
}

/**
 * Extension deactivation
 */
export function deactivate() {
	// Cleanup is handled by extension context subscriptions
}