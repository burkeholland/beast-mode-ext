import * as vscode from 'vscode';
import { ISchemaInferenceService, SettingDefinition, SchemaLookupResult } from '../types';

/**
 * Service for inferring setting definitions from VS Code extension schemas
 */
export class SchemaInferenceService implements ISchemaInferenceService {
	constructor(private readonly context: vscode.ExtensionContext) {}

	/**
	 * Enrich a setting definition by inferring details from VS Code extension schemas
	 */
	enrichSettingDefinition(key: string, config: any): SettingDefinition {
		// Find schema for this key
		const found = this.findSchemaForKey(key);
		const schema = found?.schema;
		const group = config.group || this.deriveGroupFromKey(key);
		const label = config.title || key.split('.').slice(-1)[0];

		let type: SettingDefinition['type'] = 'string';
		let options: Array<{ value: string; label?: string }> | undefined = undefined;
		let min: number | undefined = undefined;
		let max: number | undefined = undefined;
		let step: number | undefined = undefined;
		let requires: string[] | undefined = undefined;
		let defaultVal: any = config.default;

		// Infer from schema if available
		if (schema) {
			const sType = Array.isArray(schema.type) ? schema.type[0] : schema.type;
			
			if (sType === 'boolean') {
				type = 'boolean';
			} else if (sType === 'number' || sType === 'integer') {
				type = 'number';
				step = sType === 'integer' ? 1 : undefined;
			} else if (sType === 'object' || sType === 'array') {
				type = 'json';
			} else {
				type = 'string';
			}

			// Handle enum values
			if (schema.enum && Array.isArray(schema.enum)) {
				options = schema.enum.map((v: any, i: number) => ({
					value: String(v),
					label: Array.isArray(schema.enumDescriptions) ? schema.enumDescriptions[i] : undefined
				}));
			} else if (schema.oneOf || schema.anyOf) {
				const alts = (schema.oneOf || schema.anyOf) as any[];
				const enums = alts
					.filter(e => e && (e.const !== undefined || e.enum))
					.map(e => e.const ?? (Array.isArray(e.enum) ? e.enum[0] : undefined))
					.filter(v => v !== undefined);
				if (enums.length) {
					options = enums.map(v => ({ value: String(v) }));
				}
			}

			// Handle numeric constraints
			if (typeof schema.minimum === 'number') {
				min = schema.minimum;
			}
			if (typeof schema.maximum === 'number') {
				max = schema.maximum;
			}

			// Set extension requirement if from different extension
			if (found && found.extensionId && found.extensionId !== this.context.extension.id) {
				requires = [found.extensionId];
			}

			// Use schema default if no explicit default provided
			if (defaultVal === undefined && schema.default !== undefined) {
				defaultVal = schema.default;
			}
		}

		// Inspect current configuration values to refine type information
		try {
			const info = vscode.workspace.getConfiguration().inspect<any>(key);
			const sample = info?.globalValue ?? info?.workspaceValue ?? 
				info?.workspaceFolderValue ?? info?.defaultValue;
			
			if (sample !== undefined) {
				const t = typeof sample;
				if (t === 'boolean') {
					type = 'boolean';
				} else if (t === 'number') {
					type = 'number';
					if (Number.isInteger(sample) && step === undefined) {
						step = 1;
					}
				} else if (t === 'object' && sample !== null) {
					type = 'json';
				} else {
					type = 'string';
				}

				// Use configuration default if no other default found
				if (defaultVal === undefined && info?.defaultValue !== undefined) {
					defaultVal = info.defaultValue;
				}
			}
		} catch {
			// Ignore configuration inspection errors
		}

		// Apply overrides from config
		if (config.type) {
			type = config.type;
		}
		if (config.options && config.options.length) {
			options = config.options.map((o: any) => ({
				value: String(o.value),
				label: o.label
			}));
		}
		if (config.min !== undefined) {
			min = config.min;
		}
		if (config.max !== undefined) {
			max = config.max;
		}
		if (config.step !== undefined) {
			step = config.step;
		}
		if (config.requires && config.requires.length) {
			requires = this.normalizeRequires(config.requires);
		}
		if (config.default !== undefined) {
			defaultVal = config.default;
		}

		return {
			key,
			type,
			title: label,
			description: config.description || label,
			group,
			min,
			max,
			step,
			options,
			requires,
			default: defaultVal,
			recommended: config.recommended
		};
	}

	/**
	 * Find configuration schema for a given key across all installed extensions
	 */
	findSchemaForKey(key: string): SchemaLookupResult | undefined {
		for (const ext of vscode.extensions.all) {
			const contrib = (ext.packageJSON && (ext.packageJSON as any).contributes) || {};
			const config = (contrib as any).configuration;
			
			if (!config) {
				continue;
			}

			const buckets = Array.isArray(config) ? config : [config];
			for (const bucket of buckets) {
				const props = (bucket as any).properties;
				if (props && Object.prototype.hasOwnProperty.call(props, key)) {
					return {
						schema: props[key],
						extensionId: ext.id
					};
				}
			}
		}
		return undefined;
	}

	/**
	 * Derive a friendly group name from a dotted setting key
	 */
	deriveGroupFromKey(key: string): string {
		const first = key.split('.')[0] || key;
		switch (first) {
			case 'github':
				return 'GitHub Copilot';
			case 'githubPullRequests':
				return 'GitHub PRs';
			case 'terminal':
				return 'Terminal';
			case 'workbench':
				return 'Workbench';
			case 'editor':
				return 'Editor';
			case 'chat':
				return 'Chat';
			case 'git':
				return 'Git';
			case 'window':
				return 'Window';
			default:
				return first.charAt(0).toUpperCase() + first.slice(1);
		}
	}

	/**
	 * Apply suggested defaults for newly discovered settings
	 */
	async applyDefaultsToUserSettings(definitions: SettingDefinition[]): Promise<void> {
		for (const def of definitions) {
			try {
				// Skip if required extensions are not installed
				if (def.requires && def.requires.length) {
					const anyMissing = def.requires.some(r => !vscode.extensions.getExtension(r));
					if (anyMissing) {
						continue;
					}
				}

				const info = vscode.workspace.getConfiguration().inspect<any>(def.key);
				
				// Skip if user has explicitly set the value at any scope
				if (info?.globalValue !== undefined || 
					info?.workspaceValue !== undefined || 
					info?.workspaceFolderValue !== undefined) {
					continue;
				}

				let valueToSet: any = undefined;

				if (def.default !== undefined) {
					valueToSet = def.default;
				} else if (def.type === 'boolean') {
					// Default boolean settings to enabled for "always on" behavior
					valueToSet = true;
				} else if (def.type === 'number') {
					valueToSet = def.min !== undefined ? def.min : 1;
				} else if (def.type === 'string' && def.options && def.options.length) {
					valueToSet = def.options[0].value;
				}

				if (valueToSet !== undefined) {
					await vscode.workspace.getConfiguration().update(
						def.key, 
						valueToSet, 
						vscode.ConfigurationTarget.Global
					);
				}

			} catch {
				// Ignore errors applying defaults
			}
		}
	}

	/**
	 * Normalize 'requires' value into string array
	 */
	normalizeRequires(input: any): string[] {
		if (!input) {
			return [];
		}
		if (typeof input === 'string') {
			return [input];
		}
		if (Array.isArray(input)) {
			return input.filter(i => typeof i === 'string');
		}
		return [];
	}

	/**
	 * Merge two requires arrays into a unique array
	 */
	mergeRequires(a: string[], b: string[]): string[] {
		return Array.from(new Set([...(a || []), ...(b || [])]));
	}
}