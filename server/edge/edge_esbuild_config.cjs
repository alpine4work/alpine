"use strict";

const compilationMode = process.env.BAZEL_BINDIR.match(
    /(?:^|\/)bazel-out\/[^-/]+-([^-/]+)(\/|$)/,
)[1];
if (!compilationMode) throw new Error("Expected compilation mode to be in `BAZEL_BINDIR`");

module.exports = {
    target: "node14",
    platform: "neutral",
    format: "esm",
    mainFields: ["browser", "module", "main"],
    conditions: ["worker"],
    define: {
        "process.env.NODE_ENV": JSON.stringify(
            compilationMode === "opt" ? "production" : "development",
        ),
    },
};
