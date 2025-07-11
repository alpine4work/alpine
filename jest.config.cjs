"use strict";

const testMatch = "**/*.test.js";

const baseJestConfig = {
    testMatch: [testMatch],
    snapshotResolver: require.resolve("./admin/jest/jest_snapshot_resolver.cjs"),
    clearMocks: true,
    testPathIgnorePatterns: ["/node_modules/"],
    transformIgnorePatterns: ["/node_modules/"],
    // Disable Jest's Babel plugin. We already run Jest with SWC compiled
    // JavaScript files (built by Bazel).
    transform: {},
};

module.exports = {
    projects: [
        {
            ...baseJestConfig,
            displayName: "client",
            testEnvironment: "jest-environment-jsdom",
            testPathIgnorePatterns: [
                ...baseJestConfig.testPathIgnorePatterns,
                "<rootDir>/server/",
                "<rootDir>/admin/",
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
            testMatch: [`<rootDir>/server/${testMatch}`, `<rootDir>/admin/${testMatch}`],
            setupFilesAfterEnv: [
                require.resolve("./admin/jest/jest_setup_shared.cjs"),
                require.resolve("./admin/jest/jest_setup_server.cjs"),
            ],
        },
    ],
};
