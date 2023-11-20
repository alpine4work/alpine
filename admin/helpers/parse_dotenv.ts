import dotenv, {DotenvParseOutput} from "dotenv";
import fs from "fs-extra";
import path from "path";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";

/**
 * Parses our `.env` files synchronously and returns an object with the
 * resulting variables.
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
        loadDotenvFile(path.join(runfilesPath, `cyberworlds/.env.${nodeEnv}.local`)),
    ];

    return Object.assign({}, ...files);
});

function loadDotenvFile(filePath: string): DotenvParseOutput {
    if (!fs.pathExistsSync(filePath)) return {};

    const file = fs.readFileSync(filePath, "utf8");
    return dotenv.parse(file);
}
