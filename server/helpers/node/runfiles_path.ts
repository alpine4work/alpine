import {assertExists} from "~/shared/helpers/control/assert_exists.js";

/**
 * Path where we can find our runfiles from Bazel.
 */
// If we are in AWS lambda there is no `RUNFILES` environment variable. Instead
// look for a directory in our task root. See the `aws_lambda.bzl` build rule.
export const runfilesPath = process.env.LAMBDA_TASK_ROOT
    ? `${process.env.LAMBDA_TASK_ROOT}/index.mjs.runfiles`
    : assertExists(process.env.RUNFILES);
