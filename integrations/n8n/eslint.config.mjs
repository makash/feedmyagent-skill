import { n8nCommunityNodesPlugin } from '@n8n/eslint-plugin-community-nodes';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		files: ['nodes/**/*.ts', 'credentials/**/*.ts'],
		extends: [tseslint.configs.recommended],
	},
	{
		// package.json is linted by the community-nodes rules below (author,
		// peerDependencies, the "n8n" block, etc). TypeScript natively parses
		// .json files as a single JSON expression (resolveJsonModule), which is
		// what those rules' ObjectExpression/ExpressionStatement visitors expect.
		files: ['package.json'],
		languageOptions: {
			parser: tseslint.parser,
		},
	},
	n8nCommunityNodesPlugin.configs.recommended,
);
