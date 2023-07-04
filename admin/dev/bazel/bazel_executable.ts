import fs from "fs-extra";
import path from "path";
import {runfilesPath} from "~/admin/helpers/runfiles_path.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const bazeliskVendorPath = path.join(runfilesPath, "cyberworlds/admin/vendor/bazelisk");

/**
 * The path to the Bazel executable.
 */
export const bazelExecutablePath = path.join(
    bazeliskVendorPath,
    assertExists(fs.readdirSync(bazeliskVendorPath)[0]),
);

let lockPromise: Promise<void> | null = null;

/**
 * Bazel can only run one command at a time. Use this promise to coordinate
 * Bazel usage so only one piece of code in our Node.js process can be
 * executing a Bazel command at any given time.
 */
export async function lockBazelExecutable<Value>(action: () => Promise<Value>): Promise<Value> {
    while (lockPromise !== null) await lockPromise;

    const actionPromise = action();

    lockPromise = actionPromise.then(
        () => {
            lockPromise = null;
        },
        () => {
            lockPromise = null;
        },
    );

    return actionPromise;
}
