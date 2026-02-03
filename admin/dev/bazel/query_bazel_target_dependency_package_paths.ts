import {bazelExecutableMutex, bazelExecutablePath} from "~/admin/dev/bazel/bazel_executable.js";
import {runProcess} from "~/server/helpers/node/run_process.js";

/**
 * Query the packages that the provided Bazel target depends on.
 *
 * Our file watcher uses this to know which targets we need to rebuild when a
 * file changes. If a `BUILD` file changes then we need to re-query
 * dependencies.
 *
 * One of the packages we return may be the empty string. This refers to the
 * root package.
 */
export function queryBazelTargetDependencyPackagePaths(target: string): Promise<Array<string>> {
    return bazelExecutableMutex.withLock(async () => {
        const queryResult = await runProcess(
            bazelExecutablePath,
            // eslint-disable-next-line cyberworlds/string-quotes
            ["query", `filter("^//", deps(${target}))`, "--output=package"],
            {
                // Inherit `process.env` when running Bazel...
                env: process.env,
            },
        );

        return (
            queryResult
                // Replace a single trailing newline. We may have an empty string which refers
                // to the root package.
                .replace(/\n$/, "")
                .split("\n")
        );
    });
}
