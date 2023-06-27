"use strict";

const {vanillaExtractPlugin} = require("@vanilla-extract/esbuild-plugin");

// Extract the compilation mode from the `BAZEL_BINDIR` environment variable.
// This is a little hacky.
// https://bazel.build/docs/user-manual#compilation-mode
const compilationModeMatch = process.env.BAZEL_BINDIR.match(
    /(?:^|\/)bazel-out\/[a-z0-9]+(?:_[a-z0-9]+)?-(fastbuild|dbg|opt)/,
);
if (!compilationModeMatch)
    throw new Error(
        `Expected to find compilation mode in the \`BAZEL_BINDIR\` environment variable: ${JSON.stringify(
            process.env.BAZEL_BINDIR,
        )}`,
    );

const compilationMode = compilationModeMatch[1];

module.exports = {
    plugins: [vanillaExtractPlugin({identifiers: compilationMode === "opt" ? "short" : "debug"})],
};
