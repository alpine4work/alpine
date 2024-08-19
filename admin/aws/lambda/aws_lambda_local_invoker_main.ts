import fs from "fs-extra";
import {join as joinPath, sep as pathSeparator} from "path";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const execrootPath = assertExists(process.env.JS_BINARY__EXECROOT);

async function main() {
    const lambdaPath = assertExists(process.argv[2]);
    assert((await fs.stat(lambdaPath)).isDirectory());

    const lambdaResolvedPath = await fs.realpath(lambdaPath);
    const lambdaResolvedPathPrefix = joinPath(execrootPath, "bazel-out") + pathSeparator;
    assert(lambdaResolvedPath.startsWith(lambdaResolvedPathPrefix), "Output not in Bazel execroot");

    const lambdaRelativePath = lambdaResolvedPath
        .slice(lambdaResolvedPathPrefix.length)
        .split(pathSeparator)
        .slice(2)
        .join(pathSeparator);

    // Setup a mock AWS Lambda environment before importing our lambda code.
    process.env.LAMBDA_TASK_ROOT = lambdaPath;

    const lambdaModule = await import(
        joinPath(lambdaPath, "cyberworlds", `${lambdaRelativePath}.cjs`)
    );

    await lambdaModule.handler();
}

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});
