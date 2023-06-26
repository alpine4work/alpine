import {assert} from "~/shared/helpers/control/assert.js";

assert(process.env.RUNFILES);

/**
 * Path where we can find our runfiles from Bazel.
 */
export const runfilesPath = process.env.RUNFILES;
