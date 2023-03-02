"use strict";

const {devices, defineConfig} = require("@playwright/test");

const isExecutedByBazelTest = !process.env.BUILD_WORKSPACE_DIRECTORY;

// Use higher timeouts when running with `bazel test` instead of `bazel run`.
// `bazel run` is useful for debugging a single test so to have a fast
// iteration cycle it's useful when tests fail fast.
//
// Timeouts align with Bazel's test timeouts:
// https://bazel.build/reference/test-encyclopedia
//
// TODO(calebmer): I'd really like to have the same fast timeouts between
// `bazel build` and `bazel test` but increase the timeouts in CI. Slow
// timeouts hide real issues! Or use better machines for CI so they can use the
// same timeouts we use locally.
const timeout = isExecutedByBazelTest ? 300 * 1000 : 20 * 1000;
const actionTimeout = isExecutedByBazelTest ? 60 * 1000 : 3 * 1000;

module.exports = defineConfig({
    testDir: "./app/integration_tests",
    testMatch: ["**/*.spec.js"],
    timeout,
    expect: {timeout: actionTimeout},
    reporter: "list",
    use: {
        actionTimeout: actionTimeout,
        screenshot: "only-on-failure",
        video: "retain-on-failure",
        trace: "retain-on-failure",
    },
    projects: [
        {
            name: "chromium",
            use: {...devices["Desktop Chrome"]},
        },
        {
            name: "firefox",
            use: {...devices["Desktop Firefox"]},
        },
        {
            name: "webkit_desktop",
            use: {...devices["Desktop Safari"]},
        },
        {
            name: "webkit_mobile",
            use: {...devices["iPhone 12"]},
        },
    ],
});
