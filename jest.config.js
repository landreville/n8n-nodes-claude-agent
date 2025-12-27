module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	roots: ['<rootDir>/__tests__', '<rootDir>/nodes', '<rootDir>/credentials'],
	testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
	transform: {
		'^.+\\.ts$': ['ts-jest', {
			tsconfig: {
				esModuleInterop: true,
				noUnusedLocals: false,
				noUnusedParameters: false,
			},
		}],
	},
	collectCoverageFrom: [
		'nodes/**/*.ts',
		'credentials/**/*.ts',
		'!**/*.d.ts',
		'!**/node_modules/**',
		'!**/dist/**',
		'!**/__tests__/**',
	],
	moduleFileExtensions: ['ts', 'js', 'json'],
};
