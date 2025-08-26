import * as vscode from 'vscode';
import { HttpService } from './services/HttpService';
import { ConfigurationService } from './services/ConfigurationService';
import { SchemaInferenceService } from './services/SchemaInferenceService';
import { NewSettingsTracker } from './services/NewSettingsTracker';
import { StateManager } from './utils/StateManager';
import { HtmlRenderer } from './utils/HtmlRenderer';
import { OnByDefaultSettingsWebviewProvider } from './providers/OnByDefaultSettingsWebviewProvider';
import { Constants } from './constants';

/**
 * Create webview provider with all dependencies
 */
function createWebviewProvider(context: vscode.ExtensionContext): OnByDefaultSettingsWebviewProvider {
	// Create core services
	const httpService = new HttpService(context);
	const schemaService = new SchemaInferenceService(context);
	const newSettingsTracker = new NewSettingsTracker(context);
	
	// Create configuration service with dependencies
	const configService = new ConfigurationService(context, httpService, schemaService);
	
	// Create utility services
	const stateManager = new StateManager(context, newSettingsTracker);
	const htmlRenderer = new HtmlRenderer(context);
	
	// Create provider with all dependencies
	return new OnByDefaultSettingsWebviewProvider(
		context,
		configService,
		stateManager,
		htmlRenderer,
		newSettingsTracker
	);
}

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext) {
	const provider = createWebviewProvider(context);

	// Register webview provider
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			Constants.WEBVIEW_VIEW_TYPE, 
			provider
		)
	);

	// Start external watchers
	provider.startExternalWatchers();

	// Register refresh command
	context.subscriptions.push(
		vscode.commands.registerCommand(Constants.COMMANDS.REFRESH_SETTINGS, () => {
			provider.updateWebviewState();
		})
	);

	// Register provider for cleanup
	context.subscriptions.push(provider);
}

/**
 * Extension deactivation
 */
export function deactivate() {
	// Cleanup is handled by extension context subscriptions
}