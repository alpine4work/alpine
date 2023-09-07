import fs from "fs-extra";
import path from "path";
import {runfilesPath} from "~/admin/helpers/runfiles_path.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const bazeliskVendorPath = path.join(runfilesPath, "cyberworlds/admin/vendor/bazelisk");

/**
 * The path to the Bazel executable.
 */
export const bazelExecutablePath = path.join(
    bazeliskVendorPath,
    assertExists(fs.readdirSync(bazeliskVendorPath)[0]),
);

/**
 * Bazel can only run one command at a time. Use this mutex to coordinate
 * Bazel usage so only one piece of code in our Node.js process can be
 * executing a Bazel command at any given time.
 */
export const bazelExecutableMutex = new Mutex();
