import fs from "fs-extra";
import path from "path";
import {workspacePath} from "~/admin/helpers/workspace_path.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const bazeliskRunfilesVendorPath = path.join(runfilesPath, "cyberworlds/admin/vendor/bazelisk");

/**
 * The path to the Bazel executable in our binary's runfiles.
 */
// NOTE(calebmer, 2023-09-15): I think it's more technically correct to use
// bazelisk from runfiles than from the workspace (runfiles is more portable)
// but I'm running into issues with the dev process where after some period of
// time I start getting an EBADF error when trying to spawn the Bazelisk
// process that doesn't go away. Maybe this is because Bazel is using symlinks
// or deletes/recreates runfiles at some point?
//
// I'm trying out the path directly in our workspace for now to see if that
// works. If you're reading this comment far into the future that means the
// workspace is working. If the workspace path is working we should either
// remove bazelisk from our dev command's runfiles or find out why putting it
// in runfiles causes errors.
//
// NOTE(calebmer, 2023-10-30): I think the EBADF issue may have been due to a
// [file descriptor leak][1]? I think I've fixed this leak but leaving this
// as-is for now until I've confirmed the EBADF issue is fixed.
//
// [1]: https://stackoverflow.com/questions/77361105/how-to-debug-node-js-child-process-ebadf-errors
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const bazelRunfilesExecutablePath = path.join(
    bazeliskRunfilesVendorPath,
    assertExists(fs.readdirSync(bazeliskRunfilesVendorPath)[0]),
);

const bazeliskWorkspaceVendorPath = path.join(workspacePath, "admin/vendor/bazelisk");

/**
 * The path to the Bazel executable in our workspace (no symlinks).
 */
const bazelWorkspaceExecutablePath = path.join(
    bazeliskWorkspaceVendorPath,
    `bazelisk-${process.platform}-${process.arch}`,
);

/**
 * The path to the Bazel executable.
 */
export const bazelExecutablePath = bazelWorkspaceExecutablePath;

/**
 * Bazel can only run one command at a time. Use this mutex to coordinate
 * Bazel usage so only one piece of code in our Node.js process can be
 * executing a Bazel command at any given time.
 */
export const bazelExecutableMutex = new Mutex();
