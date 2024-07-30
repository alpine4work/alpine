"use strict";

const {devices, defineConfig} = require("@playwright/test");

const timeout = 30 * 1000;
const actionTimeout = 5 * 1000;

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
