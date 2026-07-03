"use strict";

const testMatch = "**/*.test.js";

const alpineJestCoverageDirectory = process.env.TEST_UNDECLARED_OUTPUTS_DIR
    ? `${process.env.TEST_UNDECLARED_OUTPUTS_DIR}/coverage`
    : "coverage";

const baseJestConfig = {
    testMatch: [testMatch],
    snapshotResolver: require.resolve("./admin/jest/jest_snapshot_resolver.cjs"),
    clearMocks: true,
    testPathIgnorePatterns: ["/node_modules/"],
    transformIgnorePatterns: ["/node_modules/"],
    globals: {
        // This is normally re-written out to an actual value by Vite, but if we only use
        // SWC to compile our TypeScript files, like in tests, we need to set it manually
        // as a global.
        __RESOURCE_SERVICE_URL__: "http://localhost",
    },
    // Disable Jest's Babel plugin. We already run Jest with SWC compiled JavaScript
    // files (built by Bazel).
    transform: {},
    moduleNameMapper: {
        // SWC rewrites `~/external/sqlite/...` imports to relative
        // `../external/sqlite/...` paths, but Bazel mounts `@sqlite` at the runfiles root
        // as `sqlite/...`.
        "^(?:\\.\\./)+external/sqlite/(.*)$": "<rootDir>/../sqlite/$1",
        // The `uuid` package used by giphy ships an ESM-only browser build which
        // `jest-environment-jsdom` resolves by default, causing a `SyntaxError`. Map it to
        // a simple CJS mock instead.
        "^uuid$": require.resolve("./admin/jest/uuid_mock.cjs"),
    },
};

module.exports = {
    collectCoverage: true,
    coverageDirectory: alpineJestCoverageDirectory,
    coverageProvider: "v8",
    coverageReporters: ["json"],
    projects: [
        {
            ...baseJestConfig,
            displayName: "client",
            testEnvironment: "jest-environment-jsdom",
            testPathIgnorePatterns: [
                ...baseJestConfig.testPathIgnorePatterns,
                "<rootDir>/server/",
                "<rootDir>/admin/",
                "<rootDir>/app/routes_test/",
            ],
            setupFilesAfterEnv: [
                require.resolve("./admin/jest/jest_setup_shared.cjs"),
                require.resolve("./admin/jest/jest_setup_client.cjs"),
            ],
        },
        {
            ...baseJestConfig,
            displayName: "server",
            testEnvironment: "node",
            testMatch: [
                `<rootDir>/server/${testMatch}`,
                `<rootDir>/admin/${testMatch}`,
                `<rootDir>/app/routes_test/${testMatch}`,
            ],
            setupFilesAfterEnv: [
                require.resolve("./admin/jest/jest_setup_shared.cjs"),
                require.resolve("./admin/jest/jest_setup_server.cjs"),
            ],
        },
    ],
};
