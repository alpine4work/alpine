"use strict";

const testMatch = "**/*.test.js";

const baseJestConfig = {
    // Use `jest-light-runner` which is faster since it doesn't spin up Node.js
    // VMs. Instead running tests directly in the Node.js process. We run
    // individual Jest test files with Bazel so Bazel is providing our test
    // isolation.
    runner: "jest-light-runner",
    testMatch: [testMatch],
    snapshotResolver: require.resolve("./admin/jest/jest_snapshot_resolver.cjs"),
    clearMocks: true,
    testPathIgnorePatterns: ["/node_modules/"],
    transformIgnorePatterns: ["/node_modules/"],
};

module.exports = {
    projects: [
        {
            ...baseJestConfig,
            displayName: {name: "client", color: "white"},
            // Because we use `jest-light-runner` we manually need to install `jsdom` in
            // the environment.
            testEnvironment: "node",
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
            displayName: {name: "server", color: "white"},
            testEnvironment: "node",
            testMatch: [`<rootDir>/server/${testMatch}`, `<rootDir>/admin/${testMatch}`],
            setupFilesAfterEnv: [
                require.resolve("./admin/jest/jest_setup_shared.cjs"),
                require.resolve("./admin/jest/jest_setup_server.cjs"),
            ],
        },
    ],
};
