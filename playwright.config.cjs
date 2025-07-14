"use strict";

const {devices, defineConfig} = require("@playwright/test");

const timeout = 30 * 1000;
const actionTimeout = 5 * 1000;

// Allow overriding the mobile device via environment variable
// This is useful for environments where the default device is not suitable
const mobileDevice = process.env.PLAYWRIGHT_MOBILE_DEVICE || "iPhone 12";

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
            use: {...devices[mobileDevice]},
        },
    ],
});
