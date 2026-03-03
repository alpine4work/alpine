import dotenv, {DotenvParseOutput} from "dotenv";
import fs from "fs-extra";
import path from "path";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {getWorkspacePath} from "~/server/helpers/node/workspace_path.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";

/**
 * Parses our `.env` files synchronously and returns an object with the resulting
 * variables.
 *
 * This needs to be synchronous since we run it during module evaluation.
 *
 * Caches the result so subsequent calls will return the same thing.
 */
export function parseDotenv(): DotenvParseOutput {
    return env.get();
}

const env = new Lazy(() => {
    const nodeEnv = process.env.NODE_ENV ?? "development";
    assert(isIdentifier(nodeEnv));

    const files = [
        loadDotenvFile(path.join(runfilesPath, "cyberworlds/.env")),
        loadDotenvFile(path.join(runfilesPath, `cyberworlds/.env.${nodeEnv}`)),

        // Load the local `.env` file from the workspace path, not the runfiles path. We
        // don't include the local `.env` file in runfiles because it changes from
        // machine-to-machine which will break Bazel's remote caching.
        //
        // Don't load a local `.env.test` file because tests run in a Bazel sandbox where
        // we don't have access to the workspace directory.
        process.env.NODE_ENV !== "test" && process.env.BUILD_WORKSPACE_DIRECTORY
            ? loadDotenvFile(path.join(getWorkspacePath(), `.env.${nodeEnv}.local`))
            : null,
    ];

    return Object.assign({}, ...files);
});

function loadDotenvFile(filePath: string): DotenvParseOutput {
    if (!fs.pathExistsSync(filePath)) return {};

    const file = fs.readFileSync(filePath, "utf8");
    return dotenv.parse(file);
}
