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
    platform: "browser",
    target: "es2022",
    // NOTE(rmtobin, 12/12/2025): Service workers support `esm` format in Chrome and Safari, but
    // support in Firefox is still experimental[1]. In the future, we should consider using `esm`
    // format once module type service workers are more widely supported.
    //
    // [1]: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register#module
    format: "iife",
    mainFields: ["browser", "module", "main"],
    minify: compilationMode === "opt" ? true : false,
    define: {
        // `import.meta` doesn't work with an `iife` output format. But we use
        // `import.meta.jest` a lot to tell if we're in a unit test. Replace it with
        // `undefined` to avoid esbuild warnings.
        "import.meta.jest": "undefined",
    },
};
