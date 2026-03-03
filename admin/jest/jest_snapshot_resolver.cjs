/**
 * We write snapshot files to the source code directory. So we redirect paths in
 * the runfiles directory to the workspace directory with our snapshot resolver
 * when we know what the workspace path is.
 *
 * We know the workspace path when using `bazel run` (e.g.
 * `bazel run :test -- --updateSnapshot`) but not when running `bazel test`.
 */

"use strict";

if (!process.env.RUNFILES) throw new Error("Expected `RUNFILES` environment variable");
const runfilesPath = `${process.env.RUNFILES}/cyberworlds`;

const workspacePath = process.env.BUILD_WORKSPACE_DIRECTORY;

module.exports = {
    resolveSnapshotPath: (testPath, snapshotExtension) => {
        if (!testPath.endsWith(".js")) throw new Error("Expected test to have `.js` extension");

        const snapshotPathInRunfiles = testPath.slice(0, -3) + snapshotExtension;

        // If we don't have access to the workspace path then use the snapshot file in our
        // runfiles.
        if (!workspacePath) return snapshotPathInRunfiles;

        if (!snapshotPathInRunfiles.startsWith(`${runfilesPath}/`))
            throw new Error("Expected test file to be in runfiles directory");

        return `${workspacePath}/${snapshotPathInRunfiles.slice(runfilesPath.length + 1)}`;
    },
    resolveTestPath: (snapshotPath, snapshotExtension) => {
        const testPathInWorkspace = snapshotPath.replace(snapshotExtension, ".js");

        // If we don't have access to the workspace path then the snapshot path will
        // actually be in runfiles. Return the location in runfiles.
        if (!workspacePath) return testPathInWorkspace;

        // If the test path is already in runfiles then don't replace the workspace path
        // the runfiles path.
        if (testPathInWorkspace.startsWith(`${runfilesPath}/`)) return testPathInWorkspace;

        if (!testPathInWorkspace.startsWith(`${workspacePath}/`))
            throw new Error("Expected snapshot file to be in workspace directory");

        return `${runfilesPath}/${testPathInWorkspace.slice(workspacePath.length + 1)}`;
    },
    testPathForConsistencyCheck: `${runfilesPath}/some.test.js`,
};
