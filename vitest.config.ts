import { defineConfig } from 'vitest/config'
export default defineConfig({
	test: {
		include: ['packages/**/test/**/*.test.ts', 'apps/api/test/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
		exclude: ['**/*.integration.test.ts'],
		testTimeout: 15_000,
	},
})
