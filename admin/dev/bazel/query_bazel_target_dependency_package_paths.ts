import {bazelExecutablePath, lockBazelExecutable} from "~/admin/dev/bazel/bazel_executable.js";
import {runProcess} from "~/admin/helpers/run_process.js";

/**
 * Query the packages that the provided Bazel target depends on.
 *
 * Our file watcher uses this to know which targets we need to rebuild when a
 * file changes. If a `BUILD` file changes then we need to re-query
 * dependencies.
 */
export function queryBazelTargetDependencyPackagePaths(target: string): Promise<Array<string>> {
    return lockBazelExecutable(async () => {
        const queryResult = await runProcess(
            bazelExecutablePath,
            ["query", `filter("^//", deps(${target}))`, "--output=package"],
            {
                // Inherit `process.env` when running Bazel...
                env: process.env,
            },
        );

        return queryResult.trim().split("\n");
    });
}
