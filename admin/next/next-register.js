/*!
 * Register the Next.js compiler (SWC) to transform TypeScript files (and
 * modern JavaScript files) into code that will execute in the current version
 * of Node.js.
 *
 * You should only use this for one-off scripts! Since this compiles files at
 * runtime, it is not suitable for performance sensitive code.
 *
 * Ideally, Next.js would bake in a feature that allows us to run one-off
 * scripts. Instead we hackishly rely on Next.js internal implementation
 * details (the very fact that SWC is the Next.js compiler is an implementation
 * detail) to create a similar runtime.
 */
// TODO(calebmer): Instead of hackishly relying on Next.js internals, propose
// that Next.js provides a feature out of the box for us to run arbitrary
// scripts in a Next.js codebase.

"use strict";

require("./next-dotenv");

const fs = require("fs");
const JSON5 = require("json5");
const path = require("path");
const {getJestSWCOptions} = require("next/dist/build/swc/options");

const repoDirectoryPath = path.resolve(__dirname, "../..");

const jsConfig = JSON5.parse(
    fs.readFileSync(path.join(repoDirectoryPath, "tsconfig.json"), "utf8"),
);

const resolvedBaseUrl = path.join(repoDirectoryPath, jsConfig.compilerOptions.baseUrl);

// We want to use the same SWC options that Next.js uses. The
// `getJestSWCOptions()` is conveniently imported and since Jest executes code
// compiled with SWC in Node.js (same thing we want to do here) we use the
// Next.js Jest options as a base.
const swcOptions = getJestSWCOptions({
    isServer: true,
    filename: "mock.ts",
    nextConfig: require("../../next.config"),
    jsConfig,
    resolvedBaseUrl,
    pagesDir: path.join(repoDirectoryPath, "pages"),
    esm: false,
});

// Delete properties that are presumably supported by the Next.js SWC fork but
// are not supported in the generally available SWC project.
delete swcOptions.styledComponents;
delete swcOptions.reactRemoveProperties;
delete swcOptions.emotion;
delete swcOptions.disableNextSsg;
delete swcOptions.disablePageConfig;
delete swcOptions.pagesDir;

// Next.js [currently doesn't propagate `resolvedBaseUrl`][1]. How does it
// transform paths for Jest then?? Presumably there's a resolver at a different
// level?
//
// [1]: https://github.com/vercel/next.js/blob/f0ed328b6f5466d978161ce046bb30a09f2179d1/packages/next/build/swc/options.js#L175-L176
swcOptions.jsc.baseUrl = resolvedBaseUrl;
swcOptions.jsc.paths = jsConfig.compilerOptions.paths;

swcOptions.ignore = [
    // Don't compile third-party code.
    /node_modules/,
    // Don't compile CSS files with SWC. We will use Babel to compile CSS files to
    // add a custom plugin.
    /^.+\.css\.(js|jsx|ts|tsx|mjs)$/,
];

require("@swc/register")(swcOptions);

// Compile CSS files with Babel so we can use the `vanilla-extract` Babel plugin.
require("@babel/register")({
    only: [/^.+\.css\.(js|jsx|ts|tsx|mjs)$/],
    ignore: [/node_modules/],
    extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs"],
    presets: ["next/babel"],
    plugins: ["@vanilla-extract/babel-plugin"],
});

// The SWC compiler will use our TypeScript config to compile import paths but
// our Babel compiler won't. So register `tsconfig-paths` to handle imports
// from code compiled with Babel.
//
// Maybe in the future convert this to a Babel plugin so it only runs with
// Babel compiled code and matches SWC?
require("tsconfig-paths/register");
