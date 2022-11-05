import {assert} from "~/shared/helpers/control/assert";

/**
 * The absolute file system path to the directory our Cyberworlds repository
 * lives in no matter what environment we’re executing in.
 */
assert(process.env.BUILD_WORKSPACE_DIRECTORY);
export const workspacePath = process.env.BUILD_WORKSPACE_DIRECTORY;
