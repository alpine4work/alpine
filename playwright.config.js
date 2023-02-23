"use strict";

const {devices, defineConfig} = require("@playwright/test");

module.exports = defineConfig({
    testDir: "./app/integration_tests",
    testMatch: ["**/*.spec.js"],
    timeout: 30 * 1000,
    expect: {timeout: 5 * 1000},
    reporter: "list",
    use: {
        actionTimeout: 5 * 1000,
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
