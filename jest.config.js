"use strict";

const nextJest = require("next/jest");

const createJestConfig = nextJest({dir: "./"});

const getJestConfig = createJestConfig({
    testMatch: ["**/*.test.[jt]s?(x)"],
    testEnvironment: "jest-environment-jsdom",
    resolver: require.resolve("./admin/jest/jest-resolver.js"),
    snapshotResolver: require.resolve("./admin/jest/jest-snapshot-resolver.js"),
    clearMocks: true,
});

// In case you need to modify the config after Next.js. Prefer adding options to
// the `createJestConfig()` call above!
module.exports = async (...args) => {
    const jestConfig = await getJestConfig(...args);

    // Because we use `@vanilla-extract/css` for our CSS, we want CSS files to
    // actually execute instead of being replaced with a style mock.
    if (!jestConfig.moduleNameMapper["^.+\\.(css|sass|scss)$"])
        throw new Error("Expected CSS style mock");

    const styleMockPath = jestConfig.moduleNameMapper["^.+\\.(css|sass|scss)$"];
    delete jestConfig.moduleNameMapper["^.+\\.(css|sass|scss)$"];

    // We do still want CSS imported from `node_modules` to use the style mock. So
    // we check for module paths that do not start with a `.` (relative path) or
    // `~` (absolute path).
    jestConfig.moduleNameMapper["^[^.~].+\\.(css|sass|scss)$"] = styleMockPath;

    // We need to insert a transformer for `.css.ts` files that runs before the
    // default Next.js SWC transformer.
    jestConfig.transform = {
        "^.+\\.css\\.(js|jsx|ts|tsx|mjs)$": [
            "babel-jest",
            {presets: ["next/babel"], plugins: ["@vanilla-extract/babel-plugin"]},
        ],
        ...jestConfig.transform,
    };

    // Configure the main Jest config object to ignore server code. We will create
    // a second config for testing server code.
    jestConfig.displayName = "client";

    const originalTestPathIgnorePatterns = [...jestConfig.testPathIgnorePatterns];
    jestConfig.testPathIgnorePatterns.push("<rootDir>/server/");

    jestConfig.setupFilesAfterEnv ??= [];
    const originalSetupFilesAfterEnv = [...jestConfig.setupFilesAfterEnv];
    jestConfig.setupFilesAfterEnv.push(require.resolve("./admin/jest/jest-setup-client-tests.ts"));

    const serverJestConfig = {
        ...jestConfig,
        displayName: "server",
        testEnvironment: "node",
        testMatch: jestConfig.testMatch.map(testMatch => `<rootDir>/server/${testMatch}`),
        testPathIgnorePatterns: originalTestPathIgnorePatterns,
        setupFilesAfterEnv: originalSetupFilesAfterEnv,
        globalSetup: require.resolve("./admin/jest/jest-global-setup-server-tests.ts"),
    };

    return {projects: [jestConfig, serverJestConfig]};
};
