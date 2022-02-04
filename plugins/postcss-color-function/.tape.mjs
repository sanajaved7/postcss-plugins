import postcssTape from '../../packages/postcss-tape/dist/index.mjs';
import plugin from '@csstools/postcss-color-function';
import lab from 'postcss-lab-function';

postcssTape(plugin)({
	'basic': {
		message: 'supports basic usage',
	},
	'basic:preserve-true': {
		message: 'supports { preserve: true } usage',
		options: {
			preserve: true
		}
	},
	'lab-function-interop': {
		message: 'supports usage along side postcss-lab-function',
		plugins: [
			plugin({ preserve: true }),
			lab({ preserve: true, displayP3: true }),
		]
	},
	'lab-function-interop:preserve:false': {
		message: 'supports usage along side postcss-lab-function with { preserve: false }',
		plugins: [
			plugin({ preserve: false}),
			lab({ preserve: false, displayP3: true }),
		]
	},
	'variables': {
		message: 'supports variables',
	},
	'variables:preserve-true': {
		message: 'supports variables with { preserve: true } usage',
		options: {
			preserve: true
		}
	},
});