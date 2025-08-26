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
		const found = this.findSchemaForKey(key);
		const schema = found?.schema;
		const group = config.group || this.deriveGroupFromKey(key);
		const label = config.title || key.split('.').slice(-1)[0];

		// Start with schema-inferred properties
		let properties = this.inferFromSchema(schema, found, config.default);
		
		// Refine with current configuration values
		properties = this.refineFromConfiguration(key, properties);
		
		// Apply explicit config overrides
		properties = this.applyConfigOverrides(config, properties);

		return {
			key,
			title: label,
			description: config.description || label,
			group,
			recommended: config.recommended,
			...properties
		};
	}

	private inferFromSchema(schema: any, found: SchemaLookupResult | undefined, configDefault: any) {
		let type: SettingDefinition['type'] = 'string';
		let options: Array<{ value: string; label?: string }> | undefined = undefined;
		let min: number | undefined = undefined;
		let max: number | undefined = undefined;
		let step: number | undefined = undefined;
		let requires: string[] | undefined = undefined;
		let defaultVal: any = configDefault;

		if (!schema) {
			return { type, options, min, max, step, requires, default: defaultVal };
		}

		// Infer type
		const sType = Array.isArray(schema.type) ? schema.type[0] : schema.type;
		if (sType === 'boolean') {
			type = 'boolean';
		} else if (sType === 'number' || sType === 'integer') {
			type = 'number';
			step = sType === 'integer' ? 1 : undefined;
		} else if (sType === 'object' || sType === 'array') {
			type = 'json';
		}

		// Extract enum options
		options = this.extractEnumOptions(schema);

		// Extract numeric constraints
		if (typeof schema.minimum === 'number') {min = schema.minimum;}
		if (typeof schema.maximum === 'number') {max = schema.maximum;}

		// Set extension requirement
		if (found?.extensionId && found.extensionId !== this.context.extension.id) {
			requires = [found.extensionId];
		}

		// Use schema default
		if (defaultVal === undefined && schema.default !== undefined) {
			defaultVal = schema.default;
		}

		return { type, options, min, max, step, requires, default: defaultVal };
	}

	private extractEnumOptions(schema: any): Array<{ value: string; label?: string }> | undefined {
		if (schema.enum && Array.isArray(schema.enum)) {
			return schema.enum.map((v: any, i: number) => ({
				value: String(v),
				label: Array.isArray(schema.enumDescriptions) ? schema.enumDescriptions[i] : undefined
			}));
		}

		if (schema.oneOf || schema.anyOf) {
			const alts = (schema.oneOf || schema.anyOf) as any[];
			const enums = alts
				.filter(e => e && (e.const !== undefined || e.enum))
				.map(e => e.const ?? (Array.isArray(e.enum) ? e.enum[0] : undefined))
				.filter(v => v !== undefined);
			
			return enums.length ? enums.map(v => ({ value: String(v) })) : undefined;
		}

		return undefined;
	}

	private refineFromConfiguration(key: string, properties: any) {
		try {
			const info = vscode.workspace.getConfiguration().inspect<any>(key);
			const sample = info?.globalValue ?? info?.workspaceValue ?? 
				info?.workspaceFolderValue ?? info?.defaultValue;
			
			if (sample === undefined) {return properties;}

			const t = typeof sample;
			if (t === 'boolean') {
				properties.type = 'boolean';
			} else if (t === 'number') {
				properties.type = 'number';
				if (Number.isInteger(sample) && properties.step === undefined) {
					properties.step = 1;
				}
			} else if (t === 'object' && sample !== null) {
				properties.type = 'json';
			} else {
				properties.type = 'string';
			}

			// Use configuration default if no other default found
			if (properties.default === undefined && info?.defaultValue !== undefined) {
				properties.default = info.defaultValue;
			}
		} catch {
			// Ignore configuration inspection errors
		}

		return properties;
	}

	private applyConfigOverrides(config: any, properties: any) {
		if (config.type) {properties.type = config.type;}
		if (config.min !== undefined) {properties.min = config.min;}
		if (config.max !== undefined) {properties.max = config.max;}
		if (config.step !== undefined) {properties.step = config.step;}
		if (config.default !== undefined) {properties.default = config.default;}
		
		if (config.options && config.options.length) {
			properties.options = config.options.map((o: any) => ({
				value: String(o.value),
				label: o.label
			}));
		}
		
		if (config.requires && config.requires.length) {
			properties.requires = this.normalizeRequires(config.requires);
		}

		return properties;
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
			if (!this.shouldApplyDefault(def)) {continue;}
			
			const valueToSet = this.getDefaultValue(def);
			if (valueToSet === undefined) {continue;}

			try {
				await vscode.workspace.getConfiguration().update(
					def.key, 
					valueToSet, 
					vscode.ConfigurationTarget.Global
				);
			} catch {
				// Ignore errors applying defaults
			}
		}
	}

	private shouldApplyDefault(def: SettingDefinition): boolean {
		// Skip if required extensions are not installed
		if (def.requires?.some(r => !vscode.extensions.getExtension(r))) {
			return false;
		}

		try {
			const info = vscode.workspace.getConfiguration().inspect<any>(def.key);
			// Skip if user has explicitly set the value at any scope
			return !(info?.globalValue !== undefined || 
				info?.workspaceValue !== undefined || 
				info?.workspaceFolderValue !== undefined);
		} catch {
			return false;
		}
	}

	private getDefaultValue(def: SettingDefinition): any {
		if (def.default !== undefined) {return def.default;}
		
		if (def.type === 'boolean') {return true;} // Default to enabled for "always on" behavior
		if (def.type === 'number') {return def.min !== undefined ? def.min : 1;}
		if (def.type === 'string' && def.options?.length) {return def.options[0].value;}
		
		return undefined;
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