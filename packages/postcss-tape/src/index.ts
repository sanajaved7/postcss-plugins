/* eslint-disable @typescript-eslint/no-var-requires */

import postcss from 'postcss';
import postcssOldestSupported, { AcceptedPlugin } from 'postcss-8.2';
import path from 'path';
import fs, { promises as fsp } from 'fs';
import { strict as assert } from 'assert';

import type { PluginCreator, Plugin, Result } from 'postcss';
import { formatGitHubActionAnnotation } from './github-annotations';
import { dashesSeparator, formatCSSAssertError, formatWarningsAssertError } from './format-asserts';
import noopPlugin from './noop-plugin';

const emitGitHubAnnotations = process.env.GITHUB_ACTIONS && process.env.ENABLE_ANNOTATIONS_FOR_NODE === 'true' && process.env.ENABLE_ANNOTATIONS_FOR_OS === 'true';

type TestCaseOptions = {
	// Debug message
	message?: string,
	// Plugin options. Only used if `plugins` is not specified.
	options?: unknown,
	// Plugins to use. When specified the original plugin is not used.
	plugins?: Array<Plugin>,
	// The expected number of warnings.
	warnings?: number,
	// Expected exception
	// NOTE: plugins should not throw exceptions, this goes against best practices. Use `errors` instead.
	exception?: RegExp,

	// Override the file name of the "expect" file.
	expect?: string,
	// Override the file name of the "result" file.
	result?: string,

	// Do something before the test is run.
	before?: () => void,
	// Do something after the test is run.
	after?: () => void|Promise<void>,
}

export default function runner(currentPlugin: PluginCreator<unknown>) {
	let hasErrors = false;

	// Plugin conforms to https://github.com/postcss/postcss/blob/main/docs/guidelines/plugin.md
	{
		if (currentPlugin.postcss !== true) {
			hasErrors = true;

			if (emitGitHubAnnotations) {
				console.log(formatGitHubActionAnnotation(
					'postcss flag not set to "true" on exported plugin object',
					'error',
					{ file: './package.json', line: 1, col: 1 }, /* attributed to package.json because we don't know the source file of "currentPlugin" */
				));
			} else {
				console.error(`\npostcss flag not set to "true"\n\n${dashesSeparator}`);
			}
		}

		// https://github.com/postcss/postcss/blob/main/docs/guidelines/plugin.md#15-set-pluginpostcssplugin-with-plugin-name
		// Set plugin.postcssPlugin with plugin name
		const plugin = currentPlugin() as Plugin;
		if (!plugin.postcssPlugin || typeof plugin.postcssPlugin !== 'string') {
			hasErrors = true;

			if (emitGitHubAnnotations) {
				console.log(formatGitHubActionAnnotation(
					'plugin name not set via "postcssPlugin"',
					'error',
					{ file: './package.json', line: 1, col: 1 }, /* attributed to package.json because we don't know the source file of "currentPlugin" */
				));
			} else {
				console.error(`\nplugin name not set via "postcssPlugin"\n\n${dashesSeparator}`);
			}
		}

		// https://github.com/postcss/postcss/blob/main/docs/guidelines/plugin.md#54-include-postcss-plugin-keyword-in-packagejson
		// Include postcss-plugin keyword in package.json
		const packageInfo = JSON.parse(fs.readFileSync('./package.json').toString());
		if (!packageInfo.keywords.includes('postcss-plugin')) {
			hasErrors = true;

			if (emitGitHubAnnotations) {
				console.log(formatGitHubActionAnnotation(
					'package.json does not include "postcss-plugin" keyword',
					'error',
					{ file: './package.json', line: 1, col: 1 }, /* attributed to package.json because we don't know the source file of "currentPlugin" */
				));
			} else {
				console.error(`\npackage.json does not include "postcss-plugin" keyword\n\n${dashesSeparator}`);
			}
		}

		// https://github.com/postcss/postcss/blob/main/docs/guidelines/plugin.md#11-clear-name-with-postcss--prefix
		// Clear name with postcss- prefix
		const isOlderPackageName = [
			'css-has-pseudo',
			'css-blank-pseudo',
			'css-prefers-color-scheme',
		].includes(packageInfo.name);

		if (!packageInfo.name.startsWith('postcss-') && !packageInfo.name.startsWith('@csstools/postcss-') && !isOlderPackageName) {
			hasErrors = true;

			if (emitGitHubAnnotations) {
				console.log(formatGitHubActionAnnotation(
					'plugin name in package.json does not start with "postcss-"',
					'error',
					{ file: './package.json', line: 1, col: 1 },
				));
			} else {
				console.error(`\nplugin name in package.json does not start with "postcss-"\n\n${dashesSeparator}`);
			}
		}

		// https://github.com/postcss/postcss/blob/main/docs/guidelines/plugin.md#14-keep-postcss-to-peerdependencies
		// Keep postcss to peerDependencies
		if (Object.keys(Object(packageInfo.dependencies)).includes('postcss') && !('postcssTapeSelfTest' in currentPlugin)) {
			hasErrors = true;

			if (emitGitHubAnnotations) {
				console.log(formatGitHubActionAnnotation(
					'postcss should only be a peer and/or dev dependency',
					'error',
					{ file: './package.json', line: 1, col: 1 },
				));
			} else {
				console.error(`\npostcss should only be a peer and/or dev dependency\n\n${dashesSeparator}`);
			}
		}
	}

	// Test cases
	return async (options: Record<string, TestCaseOptions>) => {
		for (const testCaseLabel in options) {
			const testCaseOptions = options[testCaseLabel];

			// Run "before" immediately.
			if (testCaseOptions.before) {
				await testCaseOptions.before();
			}

			const testSourceFilePathWithoutExtension = path.join('.', 'test', testCaseLabel.split(':')[0]);
			const testFilePathWithoutExtension = path.join('.', 'test', testCaseLabel.replace(/:/g, '.'));

			const testFilePath = `${testSourceFilePathWithoutExtension}.css`;
			let expectFilePath = `${testFilePathWithoutExtension}.expect.css`;
			let resultFilePath = `${testFilePathWithoutExtension}.result.css`;

			if (testCaseOptions.expect) {
				expectFilePath = expectFilePath.replace(testCaseLabel.replace(/:/g, '.') + '.expect.css', testCaseOptions.expect);
			}
			if (testCaseOptions.result) {
				resultFilePath = resultFilePath.replace(testCaseLabel.replace(/:/g, '.') + '.result.css', testCaseOptions.result);
			}

			const plugins = testCaseOptions.plugins ?? [currentPlugin(testCaseOptions.options)];

			const input = await fsp.readFile(testFilePath, 'utf8');

			// Check errors on expect file being missing
			let expected: string|false = '';
			try {
				expected = await fsp.readFile(expectFilePath, 'utf8');
			} catch (_) {
				hasErrors = true;
				expected = false;

				if (emitGitHubAnnotations) {
					console.log(formatGitHubActionAnnotation(
						`${testCaseLabel}\n\nmissing or broken "expect" file: "${path.parse(expectFilePath).base}"`,
						'error',
						{ file: testFilePath, line: 1, col: 1 },
					));
				} else {
					console.error(`\n${testCaseLabel}\n\nmissing or broken "expect" file: "${path.parse(expectFilePath).base}"\n\n${dashesSeparator}`);
				}
			}

			let result: Result;

			try {
				result = await postcss(plugins).process(input, {
					from: testFilePath,
					to: resultFilePath,
					map: {
						inline: false,
						annotation: false,
					},
				});
			} catch (err) {
				if (testCaseOptions.exception && testCaseOptions.exception.test(err.message)) {
					// expected an exception and got one.
					continue;
				}

				// rethrow
				throw err;
			}

			// Try to write the result file, even if further checks fails.
			// This helps writing new tests for plugins.
			// Taking the result file as a starting point for the expect file.
			const resultString = result.css.toString();
			await fsp.writeFile(resultFilePath, resultString, 'utf8');

			// Can't do further checks if "expect" is missing.
			if (expected === false) {
				continue;
			}

			// Assert result with recent PostCSS.
			//
			// NOTE:
			// The version we declare as a peer dependency in plugins.
			{
				try {
					assert.strictEqual(resultString, expected);
				} catch (err) {
					hasErrors = true;

					if (emitGitHubAnnotations) {
						console.log(formatGitHubActionAnnotation(
							formatCSSAssertError(testCaseLabel, testCaseOptions, err, true),
							'error',
							{ file: normalizeFilePathForGithubAnnotation(expectFilePath), line: 1, col: 1 },
						));
					} else {
						console.error(formatCSSAssertError(testCaseLabel, testCaseOptions, err));
					}
				}
			}

			// Assert result sourcemaps with recent PostCSS.
			{
				try {
					if (result.map.toJSON().sources.includes('<no source>')) {
						throw new Error('Sourcemap is broken');
					}
				} catch (err) {
					hasErrors = true;

					if (emitGitHubAnnotations) {
						console.log(formatGitHubActionAnnotation(
							`${testCaseLabel}\n\nbroken source map: ${JSON.stringify(result.map.toJSON().sources)}`,
							'error',
							{ file: testFilePath, line: 1, col: 1 },
						));
					} else {
						console.error(`\n${testCaseLabel}\n\nbroken source map: ${JSON.stringify(result.map.toJSON().sources)}\n\n${dashesSeparator}`);
					}
				}
			}

			// Run "after" when initial postcss run has completely.
			if (testCaseOptions.after) {
				await testCaseOptions.after();
			}

			// Assert that the result can be passed back to PostCSS and still parses.
			{
				try {
					const resultContents = await fsp.readFile(resultFilePath, 'utf8');
					const secondPassResult = await postcss([noopPlugin()]).process(resultContents, {
						from: resultFilePath,
						to: resultFilePath,
						map: {
							inline: false,
							annotation: false,
						},
					});

					if (secondPassResult.warnings().length) {
						throw new Error('Unexpected warnings on second pass');
					}
				} catch (_) {
					hasErrors = true;

					if (emitGitHubAnnotations) {
						console.log(formatGitHubActionAnnotation(
							`${testCaseLabel}\n\nresult was not parsable with PostCSS.`,
							'error',
							{ file: expectFilePath, line: 1, col: 1 },
						));
					} else {
						console.error(`\n${testCaseLabel}\n\nresult was not parsable with PostCSS.\n\n${dashesSeparator}`);
					}
				}
			}

			// Assert result with oldest supported PostCSS.
			// Check against the actual result to avoid duplicate warnings.
			//
			// NOTE:
			// The oldest version of PostCSS we support at this time.
			// This does not need to be a different version than the latest version of PostCSS.
			// There is no system behind setting this.
			// It is here to allow testing a specific older version, if parts of the community can't update yet.
			if (postcss([noopPlugin()]).version !== postcssOldestSupported([noopPlugin()]).version) { // https://postcss.org/api/#processor-version
				const resultFromOldestPostCSS = await postcssOldestSupported(plugins as Array<AcceptedPlugin>).process(input, {
					from: testFilePath,
					to: resultFilePath,
					map: {
						inline: false,
						annotation: false,
					},
				});

				try {
					assert.strictEqual(resultFromOldestPostCSS.css.toString(), resultString);
				} catch (err) {
					hasErrors = true;

					if (emitGitHubAnnotations) {
						console.log(formatGitHubActionAnnotation(
							'testing older PostCSS:\n' + formatCSSAssertError(testCaseLabel, testCaseOptions, err, true),
							'error',
							{ file: normalizeFilePathForGithubAnnotation(expectFilePath), line: 1, col: 1 },
						));
					} else {
						console.error('testing older PostCSS:\n' + formatCSSAssertError(testCaseLabel, testCaseOptions, err));
					}
				}
			}

			// Assert that warnings have the expected amount.
			{
				try {
					if (result.warnings().length || testCaseOptions.warnings) {
						assert.strictEqual(result.warnings().length, testCaseOptions.warnings);
					}
				} catch (err) {
					hasErrors = true;

					if (emitGitHubAnnotations) {
						console.log(formatGitHubActionAnnotation(
							formatWarningsAssertError(testCaseLabel, testCaseOptions, result.warnings().length, testCaseOptions.warnings, true),
							'error',
							{ file: normalizeFilePathForGithubAnnotation(expectFilePath), line: 1, col: 1 },
						));
					} else {
						console.error(formatWarningsAssertError(testCaseLabel, testCaseOptions, result.warnings().length, testCaseOptions.warnings));
					}
				}
			}
		}

		if (hasErrors) {
			process.exit(1);
		}
	};
}

function normalizeFilePathForGithubAnnotation(filePath: string) {
	// Any plugin or packages is located in `<workspace>/<package>`;
	const parts = process.cwd().split('/').slice(-2);

	const workspaces = [
		'packages',
		'plugins',
		'plugin-packs',
		'cli',
		'experimental',
	];

	if (!workspaces.includes(parts[0])) {
		throw new Error('PostCSS Tape was intended to be run from <workspace>/<package>');
	}

	return path.join(parts.join('/'), filePath);
}