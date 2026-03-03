import patchedFs from "fs";
import {join as joinPath, resolve as resolvePath} from "path";
import {getWorkspacePath} from "~/server/helpers/node/workspace_path.js";

// Use the Node.js implementation of `fs` that doesn't include the `rules_js` `fs`
// patch.
const unpatchedFs: typeof patchedFs = (patchedFs as any)._unpatched ?? patchedFs;

let bazelOutputPath: string | null = null;
let bazelOutputBasePath: string | null = null;

/**
 * Get Bazel's `outputPath`. This is the directory
 * `${getWorkspacePath()}/bazel-out` symlinks to. Learn more in the Bazel
 * documentation article "[Output Directory Layout][1]."
 *
 * [1]: https://bazel.build/remote/output-directories
 */
export function getBazelOutputPath(): string {
    if (bazelOutputPath === null) {
        const workspacePath = getWorkspacePath();
        bazelOutputPath = unpatchedFs.readlinkSync(joinPath(workspacePath, "bazel-out"));
    }
    return bazelOutputPath;
}

/**
 * Get Bazel's `outputBasePath`. This is where Bazel builds code for a repository.
 * Learn more in the Bazel documentation article "[Output Directory Layout][1]."
 *
 * [1]: https://bazel.build/remote/output-directories
 */
export function getBazelOutputBasePath(): string {
    bazelOutputBasePath ??= resolvePath(getBazelOutputPath(), "../../..");
    return bazelOutputBasePath;
}
