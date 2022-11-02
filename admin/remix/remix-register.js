/*!
 * Register the same compiler as Remix (esbuild) to transform TypeScript files
 * (and modern JavaScript files) into code that will execute in the current
 * version of Node.js.
 *
 * You should only use this for one-off scripts! Since this compiles files at
 * runtime, it is not suitable for performance sensitive code.
 */

"use strict";

const vanillaExtractModuleRegExp = /\.css\.(js|jsx|ts|tsx|mjs)$/;

require("esbuild-register/dist/node").register({
    target: `node${process.version.slice(1)}`,
    // We compile `vanilla-extract` files with Babel because we need a custom
    // Babel plugin.
    hookMatcher: fileName => !vanillaExtractModuleRegExp.test(fileName),
});

// Compile CSS files with Babel so we can use the `vanilla-extract` Babel plugin.
require("@babel/register")({
    only: [vanillaExtractModuleRegExp],
    ignore: [/node_modules/],
    extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs"],
    presets: ["@babel/env", "@babel/typescript"],
    plugins: ["@vanilla-extract/babel-plugin"],
});
