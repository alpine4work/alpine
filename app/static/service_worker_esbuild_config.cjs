"use strict";

module.exports = {
    // Always log with color. Bazel will strip color when it's not supported.
    color: true,
    platform: "browser",
    target: "es2022",
    format: "esm",
    mainFields: ["browser"],
};
