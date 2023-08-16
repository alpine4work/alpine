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
    // Conditions from Wrangler:
    // https://github.com/cloudflare/workers-sdk/blob/478bed3b80ea353a5be4bd7056b92460a3cf4cd5/packages/wrangler/src/deployment-bundle/bundle.ts#L341
    conditions: ["workerd", "worker", "browser"],
    define: {
        "process.env.NODE_ENV": JSON.stringify(
            compilationMode === "opt" ? "production" : "development",
        ),
    },
};
