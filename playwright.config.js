"use strict";

const {devices} = require("@playwright/test");

module.exports = {
    testMatch: ["**/*.test.js"],
    timeout: 30 * 1000,
    expect: {timeout: 5 * 1000},
    reporter: "list",
    use: {
        actionTimeout: 0,
        trace: "on-first-retry",
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
};
