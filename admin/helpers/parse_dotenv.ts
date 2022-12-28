import dotenv, {DotenvParseOutput} from "dotenv";
import fs from "fs-extra";
import path from "path";
import {workspacePath} from "~/admin/helpers/workspace_path";
import {assert} from "~/shared/helpers/control/assert";
import {isIdentifier} from "~/shared/helpers/string/is_identifier";

/**
 * Parses our `.env` files synchronously and returns an object with the
 * resulting variables.
 *
 * This needs to be synchronous since we run it during module evaluation.
 */
export function parseDotenv(): DotenvParseOutput {
    const nodeEnv = process.env.NODE_ENV ?? "development";
    assert(isIdentifier(nodeEnv));

    const files = [
        loadDotenvFile(path.join(workspacePath, ".env")),
        loadDotenvFile(path.join(workspacePath, `.env.${nodeEnv}`)),
        loadDotenvFile(path.join(workspacePath, `.env.${nodeEnv}.local`)),
    ];

    return Object.assign({}, ...files);
}

function loadDotenvFile(filePath: string): DotenvParseOutput {
    if (!fs.pathExistsSync(filePath)) return {};

    const file = fs.readFileSync(filePath, "utf8");
    return dotenv.parse(file);
}
