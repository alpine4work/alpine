import {join as joinPath} from "path";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";

/**
 * The path to the Bazel executable.
 */
export const bazelExecutablePath = joinPath(
    runfilesPath,
    "cyberworlds/admin/vendor/bazelisk/bazelisk",
);

/**
 * Bazel can only run one command at a time. Use this mutex to coordinate Bazel
 * usage so only one piece of code in our Node.js process can be executing a Bazel
 * command at any given time.
 */
export const bazelExecutableMutex = new Mutex();
