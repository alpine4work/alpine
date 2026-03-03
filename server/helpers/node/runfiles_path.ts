import {assertExists} from "~/shared/helpers/control/assert_exists.js";

/**
 * Path where we can find our runfiles from Bazel.
 */
// If we are in a non-containerized AWS lambda there is no `RUNFILES` environment
// variable. Instead look for a directory in our task root. See
// #lambda-container-runfile-dir TODO(ifitzsimmons, #deprecate-zip-lambdas): Remove
// this once we've migrated to the new Lambda container.
export const runfilesPath =
    process.env.LAMBDA_TASK_ROOT && !process.env.RUNFILES
        ? process.env.LAMBDA_TASK_ROOT
        : assertExists(process.env.RUNFILES);
