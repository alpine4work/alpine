import {exec} from "aws-cdk/lib/cli.js";

/**
 * This function runs `bazel run //admin/aws:cdk -- deploy --all`.
 *
 * There should be no functional difference from running that command from bash
 * or running this function from JavaScript. Except this function provides
 * tracing for the deploy.
 *
 * The `aws-cdk` library's only publicly accessible API is its CLI tool.
 * However, the library also graciously provides its code built as individual
 * files. This allows us to hack into `aws-cdk`'s internals to add custom
 * tracing.
 */
export async function deployAwsCdk() {
    await exec(["deploy", "--all"]);
}
