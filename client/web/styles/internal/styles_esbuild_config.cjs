"use strict";

const {vanillaExtractPlugin} = require("@vanilla-extract/esbuild-plugin");
const postcss = require("postcss");
const autoprefixer = require("autoprefixer");

// Extract the compilation mode from the `BAZEL_BINDIR` environment variable. This
// is a little hacky. https://bazel.build/docs/user-manual#compilation-mode
//
// IMPORTANT: If you update the code here, you should also update the code in
// `edge_esbuild_config.cjs` and `aws_lambda_esbuild_config.cjs`.
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

async function processCss(css) {
    const result = await postcss([autoprefixer]).process(css, {
        from: undefined, // Suppress source map warning
    });

    return result.css;
}

module.exports = {
    // Always log with color. Bazel will strip color when it's not supported.
    color: true,
    platform: "neutral",
    format: "esm",
    plugins: [
        vanillaExtractPlugin({
            // Instead of `identifiers: "short"`, in production we need to make sure generated
            // class names always start with an underscore. If the file hash starts with a
            // number then `@vanilla-extract` will add an underscore to the start of the class
            // name but if the file hash starts with a letter then `@vanilla-extract` won't add
            // an underscore.
            //
            // However, `@vanilla-extract` has a bug that can be worked around by adding an
            // underscore to the start of _every_ class name. See:
            // https://github.com/vanilla-extract-css/vanilla-extract/issues/1501
            identifiers:
                compilationMode === "opt"
                    ? ({hash}) => (!hash.startsWith("_") ? `_${hash}` : hash)
                    : "debug",
            processCss,
        }),
    ],
};
