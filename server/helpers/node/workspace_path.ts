import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

let workspacePath: string | null = null;

/**
 * The absolute file system path to the source directory our Cyberworlds repository
 * lives in no matter what environment we're executing in.
 *
 * This is not Bazel's execution root directory or a runfiles directory. This is
 * the source git repository checked out by the developer they edit files in.
 * Having this path is useful to perform operations on source files outside of
 * Bazel's hermetic build system.
 *
 * For example, if the developer has checked out their copy of Cyberworlds on their
 * machine at `/Users/calebmer/Projects/cyberworlds` this path will be
 * `/Users/calebmer/Projects/cyberworlds`.
 *
 * Throws an error if we're running in a sandboxed Bazel environment which doesn't
 * have access to the build workspace directory.
 */
export function getWorkspacePath() {
    workspacePath ??= assertExists(
        process.env.BUILD_WORKSPACE_DIRECTORY,
        "Can\u2019t get the workspace path when running in a Bazel sandbox",
    );
    return workspacePath;
}
