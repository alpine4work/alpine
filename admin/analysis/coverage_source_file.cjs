"use strict";

const path = require("node:path");

const coverageSourceRoots = ["admin", "app", "client", "server", "shared"];
const coverageSourceExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const typescriptCoverageSourceExtensions = new Set([".ts", ".tsx"]);

/**
 * Decides whether a tracked file is source code worth reporting on.
 */
function isCoverageSourceFile(filePath, options = {}) {
    const extensions = options.extensions ?? coverageSourceExtensions;
    const extension = path.extname(filePath);
    return (
        extensions.has(extension) &&
        !filePath.endsWith(".d.ts") &&
        !/\.(test|spec)\.[^.]+$/.test(filePath)
    );
}

/**
 * Decides whether `dev test` should report changed-line coverage for a file.
 */
function isTypeScriptCoverageSourceFile(filePath) {
    return isCoverageSourceFile(filePath, {
        extensions: typescriptCoverageSourceExtensions,
    });
}

module.exports = {
    coverageSourceExtensions,
    coverageSourceRoots,
    isCoverageSourceFile,
    isTypeScriptCoverageSourceFile,
    typescriptCoverageSourceExtensions,
};
