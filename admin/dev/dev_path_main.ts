import {devEnvPaths} from "~/admin/helpers/dev_env_paths.js";
import {
    getBazelOutputBasePath,
    getBazelOutputPath,
} from "~/server/helpers/node/bazel_output_path.js";
import {getWorkspacePath} from "~/server/helpers/node/workspace_path.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {quote} from "~/shared/helpers/string/quote.js";

async function main() {
    const paths = new Map<string, string>();

    paths.set("workspace", getWorkspacePath());

    for (const [key, path] of Object.entries(devEnvPaths)) {
        paths.set(key, path);
    }

    paths.set("bazel_output_base", getBazelOutputBasePath());
    paths.set("bazel_output", getBazelOutputPath());

    const arg = process.argv[2];

    if (arg === undefined) {
        for (const [key, path] of paths) {
            // eslint-disable-next-line no-console
            console.log(`${key} = ${path}`);
        }
    } else {
        const path = paths.get(arg);
        if (path === undefined) {
            throw new InvalidArgumentError(quote`No path named ${arg}`);
        }

        // eslint-disable-next-line no-console
        console.log(path);
    }
}

main().then(
    () => {
        process.exit(0);
    },
    error => {
        // eslint-disable-next-line no-console
        console.error(error);
        process.exitCode = 1;
    },
);
