import type { PluginCreator } from 'postcss';
import type valuesParser from 'postcss-value-parser';

import getCustomPropertiesFromRoot from './lib/get-custom-properties-from-root';
import getCustomPropertiesFromImports from './lib/get-custom-properties-from-imports';
import transformProperties from './lib/transform-properties';
import writeCustomPropertiesToExports from './lib/write-custom-properties-to-exports';
import type { ImportOptions, ExportOptions } from './lib/options';

export interface PluginOptions {
	/** Determines whether Custom Properties and properties using custom properties should be preserved in their original form. */
	preserve?: boolean

	/** Specifies sources where Custom Properties can be imported from, which might be CSS, JS, and JSON files, functions, and directly passed objects. */
	importFrom?: ImportOptions | Array<ImportOptions>

	/** Specifies destinations where Custom Properties can be exported to, which might be CSS, JS, and JSON files, functions, and directly passed objects. */
	exportTo?: ExportOptions | Array<ExportOptions>

	/** Specifies if `importFrom` properties or `:root` properties have priority. */
	overrideImportFromWithRoot?: boolean
}

const creator: PluginCreator<PluginOptions> = (opts?: PluginOptions) => {
	// whether to preserve custom selectors and rules using them
	const preserve = 'preserve' in Object(opts) ? Boolean(opts.preserve) : true;
	const overrideImportFromWithRoot = 'overrideImportFromWithRoot' in Object(opts) ? Boolean(opts.overrideImportFromWithRoot) : false;

	// sources to import custom selectors from
	let importFrom: Array<ImportOptions> = [];
	if (Array.isArray(opts?.importFrom)) {
		importFrom = opts.importFrom;
	} else if (opts?.importFrom) {
		importFrom = [opts.importFrom];
	}

	// destinations to export custom selectors to
	let exportTo: Array<ExportOptions> = [];
	if (Array.isArray(opts?.exportTo)) {
		exportTo = opts.exportTo;
	} else if (opts?.exportTo) {
		exportTo = [opts.exportTo];
	}

	// promise any custom selectors are imported
	const customPropertiesPromise = getCustomPropertiesFromImports(importFrom);

	let customProperties: Map<string, valuesParser.ParsedValue> = new Map();

	// whether to return synchronous function if no asynchronous operations are requested
	const canReturnSyncFunction = importFrom.length === 0 && exportTo.length === 0;

	return {
		postcssPlugin: 'postcss-custom-properties',
		prepare () {
			if (canReturnSyncFunction) {
				return {
					Once: (root) => {
						customProperties = getCustomPropertiesFromRoot(root, { preserve });
					},
					Declaration: (decl) => {
						transformProperties(decl, customProperties, { preserve });
					},
					OnceExit: () => {
						customProperties.clear();
					},
				};
			} else {
				return {
					Once: async root => {
						const importedCustomerProperties = (await customPropertiesPromise).entries();
						const rootCustomProperties = getCustomPropertiesFromRoot(root, { preserve: preserve }).entries();

						if (overrideImportFromWithRoot) {
							for (const [name, value] of [...importedCustomerProperties, ...rootCustomProperties]) {
								customProperties.set(name, value);
							}
						} else {
							for (const [name, value] of [...rootCustomProperties, ...importedCustomerProperties]) {
								customProperties.set(name, value);
							}
						}

						await writeCustomPropertiesToExports(customProperties, exportTo);
					},
					Declaration: (decl) => {
						transformProperties(decl, customProperties, { preserve });
					},
					OnceExit: () => {
						customProperties.clear();
					},
				};
			}
		},
	};
};

creator.postcss = true;

export default creator;
