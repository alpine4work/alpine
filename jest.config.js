"use strict";

const nextJest = require("next/jest");

const createJestConfig = nextJest({dir: "./"});

module.exports = createJestConfig({
    testMatch: ["**/*.test.[jt]s?(x)"],
    testEnvironment: "jest-environment-jsdom",
    resolver: require.resolve("./admin/jest/jest-resolver.js"),
    clearMocks: true,
});
