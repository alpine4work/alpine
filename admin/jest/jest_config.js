"use strict";

const testMatch = "**/*.test.(js|jsx|ts|tsx|mjs)";

const baseJestConfig = {
    testMatch: [testMatch],
    snapshotResolver: require.resolve("./jest_snapshot_resolver.js"),
    clearMocks: true,
    testPathIgnorePatterns: ["/node_modules/"],
    transformIgnorePatterns: ["/node_modules/"],
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
            setupFilesAfterEnv: [require.resolve("./jest_setup_client_tests.js")],
        },
        {
            ...baseJestConfig,
            displayName: "server",
            testEnvironment: "node",
            testMatch: [`<rootDir>/server/${testMatch}`, `<rootDir>/admin/${testMatch}`],
            setupFilesAfterEnv: [require.resolve("./jest_setup_server_tests.js")],
        },
    ],
};
