"use strict";

const testMatch = "**/*.test.js";

const baseJestConfig = {
    testMatch: [testMatch],
    snapshotResolver: require.resolve("./admin/jest/jest_snapshot_resolver.js"),
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
                "<rootDir>/integration_tests/",
            ],
            setupFilesAfterEnv: [require.resolve("./admin/jest/jest_setup_client.js")],
        },
        {
            ...baseJestConfig,
            displayName: "server",
            testEnvironment: "node",
            testMatch: [`<rootDir>/server/${testMatch}`, `<rootDir>/admin/${testMatch}`],
            setupFilesAfterEnv: [require.resolve("./admin/jest/jest_setup_server.js")],
        },
        {
            ...baseJestConfig,
            displayName: "integration_tests",
            preset: "jest-playwright-preset",
            testMatch: [`<rootDir>/integration_tests/${testMatch}`],
            setupFilesAfterEnv: [require.resolve("./admin/jest/jest_setup_integration_tests.js")],
            testEnvironmentOptions: {
                "jest-playwright": {
                    launchType: "LAUNCH",
                    // devices: ["Desktop Chrome", "Desktop Firefox"],
                },
            },
        },
    ],
};
