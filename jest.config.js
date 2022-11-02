"use strict";

const testMatch = "**/*.test.(js|jsx|ts|tsx|mjs)";

const baseJestConfig = {
    testMatch: [testMatch],
    resolver: require.resolve("./admin/jest/jest-resolver.js"),
    snapshotResolver: require.resolve("./admin/jest/jest-snapshot-resolver.js"),
    clearMocks: true,
    transform: {
        "^.+\\.css\\.(js|jsx|ts|tsx|mjs)$": [
            "babel-jest",
            {
                presets: ["@babel/env", "@babel/typescript"],
                plugins: ["@vanilla-extract/babel-plugin"],
            },
        ],
        "^.+\\.(js|jsx|ts|tsx|mjs)$": [
            "esbuild-jest",
            {
                jsx: "automatic",
                sourcemap: true,
            },
        ],
    },
    testPathIgnorePatterns: ["/node_modules/", "/.cache/", "/public/build/"],
    transformIgnorePatterns: ["/node_modules/", "/.cache/", "/public/build/"],
    watchPathIgnorePatterns: ["/.cache/", "/public/build/"],
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
            setupFilesAfterEnv: [require.resolve("./admin/jest/jest-setup-client-tests.ts")],
        },
        {
            ...baseJestConfig,
            displayName: "server",
            testEnvironment: "node",
            testMatch: [`<rootDir>/server/${testMatch}`, `<rootDir>/admin/${testMatch}`],
            globalSetup: require.resolve("./admin/jest/jest-global-setup-server-tests.ts"),
            setupFilesAfterEnv: [require.resolve("./admin/jest/jest-setup-server-tests.ts")],
        },
    ],
};
