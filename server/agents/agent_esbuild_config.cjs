"use strict";

// Extract the compilation mode from the `BAZEL_BINDIR` environment variable.
// This is a little hacky.
// https://bazel.build/docs/user-manual#compilation-mode
//
// IMPORTANT: If you update the code here, you should also update the code in
// `styles_esbuild_config.cjs` and `aws_lambda_esbuild_config.cjs`.
const compilationModeMatch = process.env.BAZEL_BINDIR.match(
    /(?:^|\/)bazel-out\/[a-z0-9]+(?:_[a-z0-9_]+)?-(fastbuild|dbg|opt)/,
);

if (!compilationModeMatch) {
    throw new Error(
        `Expected to find compilation mode in the \`BAZEL_BINDIR\` environment variable: ${JSON.stringify(
            process.env.BAZEL_BINDIR,
        )}`,
    );
}

const compilationMode = compilationModeMatch[1];

module.exports = {
    // Always log with color. Bazel will strip color when it's not supported.
    color: true,
    platform: "neutral",
    target: "node14",
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
