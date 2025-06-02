import chalk from "chalk";
import {join as joinPath} from "path";
import yargs from "yargs";
import {hideBin} from "yargs/helpers";
import {ProcessArgs, runProcess} from "~/server/helpers/node/run_process.js";
import {runProcessWithInheritedStdio} from "~/server/helpers/node/run_process_with_inherited_stdio.js";
import {getWorkspacePath} from "~/server/helpers/node/workspace_path.js";
import {FailedPreconditionError, InvalidArgumentError} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isNonNullableOrFalse} from "~/shared/helpers/control/is_non_nullable_or_false.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {quote} from "~/shared/helpers/string/quote.js";

const branchNameRegExp = /^[a-zA-Z][a-zA-Z0-9-]+$/;

const stackBranchFullNameRegExp =
    /^(?<username>[^/]+)\/(?<stackDate>\d{4}-\d{2}-\d{2})-(?<stackName>[a-zA-Z][a-zA-Z0-9-]+)\/(?<branchNumber>\d{2})-(?<branchName>[a-zA-Z][a-zA-Z0-9-]+)$/;

main()
    .then(() => {
        process.exit(0);
    })
    .catch(error => {
        // eslint-disable-next-line no-console
        console.error(error);
        process.exitCode = 1;
    });

async function main(): Promise<{exitCode: number} | void> {
    const args = hideBin(process.argv);
    const separatorIndex = args.indexOf("--");
    const yargsArgs = separatorIndex >= 0 ? args.slice(0, separatorIndex) : args;
    const passthroughArgs = separatorIndex >= 0 ? args.slice(separatorIndex + 1) : emptyArray;

    await yargs(yargsArgs)
        .scriptName("dev stack")
        .command(
            "new <name> <branch-name>",
            "Create a new stack",
            yargs => {
                return yargs
                    .positional("name", {
                        describe: "Name of the stack",
                        type: "string",
                    })
                    .positional("branch-name", {
                        describe: "Name of the first branch in the stack",
                        type: "string",
                    });
            },
            args => runNewCommand(args),
        )
        .command(
            "add <name>",
            "Add a new branch to the stack",
            yargs => {
                return yargs.positional("name", {
                    describe: "Name of the new branch in the stack",
                    type: "string",
                });
            },
            args => runAddCommand(args),
        )
        .command(
            "pr",
            "Creates GitHub PRs for all branches",
            yargs => {
                return yargs.option("continue", {
                    describe: "Start creating PRs from the current branch",
                    type: "boolean",
                });
            },
            args => runPrCommand(args),
        )
        .command(
            "merge",
            "Merge changes into all branches",
            yargs => {
                return yargs.option("continue", {
                    describe: "Start merge from the current branch",
                    type: "boolean",
                });
            },
            args => runMergeCommand(args),
        )
        .command(
            "push",
            "Push all branches to the git remote",
            yargs => {
                return yargs.option("continue", {
                    describe: "Start push from the current branch",
                    type: "boolean",
                });
            },
            args => runPushCommand(args),
        )
        .command(
            "run",
            "Run a command for all branches",
            yargs => {
                return yargs.option("continue", {
                    describe: "Start run from the current branch",
                    type: "boolean",
                });
            },
            args => runRunCommand(args, passthroughArgs),
        )
        .strict()
        .version(false)
        .demandCommand(1, "Must provide a command")
        .fail((message, error, yargs) => {
            if (!error) {
                yargs.showHelp();

                // eslint-disable-next-line no-console
                console.error();
                // eslint-disable-next-line no-console
                console.error(message);
            } else if (isSystemError(error)) {
                // eslint-disable-next-line no-console
                console.error(error);
            } else {
                // eslint-disable-next-line no-console
                console.error(`${error.name}: ${error.message}`);
            }

            process.exit(1);
        })
        .parse();
}

async function runNewCommand({
    name: stackName = "",
    branchName: firstBranchName = "",
}: {
    name: string | undefined;
    branchName: string | undefined;
}) {
    if (!branchNameRegExp.test(stackName)) {
        throw new InvalidArgumentError(
            quote`Invalid stack name ${stackName}, must only use alphanumeric characters and "-"`,
        );
    }

    if (!branchNameRegExp.test(firstBranchName)) {
        throw new InvalidArgumentError(
            quote`Invalid branch name ${firstBranchName}, must only use alphanumeric characters and "-"`,
        );
    }

    const workspacePath = getWorkspacePath();

    const username = (
        await runProcess(joinPath(workspacePath, "admin/bin/dev"), ["whoami"])
    ).trim();

    const currentTime = new Date();

    const currentDate =
        currentTime.getFullYear().toString().padStart(4, "0") +
        "-" +
        (currentTime.getMonth() + 1).toString().padStart(2, "0") +
        "-" +
        currentTime.getDate().toString().padStart(2, "0");

    // Create a branch name in the same format as `dev branch`. The stack branch
    // format appends another `/` and includes the branch number along with the
    // individual stack branch's name.
    const firstBranchFullName = `${username}/${currentDate}-${stackName}/01-${firstBranchName}`;

    await runGit([
        "checkout",
        "-b",
        firstBranchFullName,
        // Make sure to create a branch from main! Not where the branch that's
        // currently checked out.
        "main",
    ]);
}

async function runAddCommand({name: branchName = ""}: {name: string | undefined}) {
    if (!branchNameRegExp.test(branchName)) {
        throw new InvalidArgumentError(
            quote`Invalid branch name ${branchName}, must only use alphanumeric characters and "-"`,
        );
    }

    const currentBranchFullName = await getCurrentBranchFullName();
    const stack = await getStack(currentBranchFullName);
    const lastStackBranch = stack.branches[stack.branches.length - 1]!;

    const newStackBranchNumber = (lastStackBranch.number + 1).toString().padStart(2, "0");

    // Don't allow stacks that require a three digit number since we won't be able
    // to lexicographically sort stack branches anymore since we only pad to two
    // characters.
    if (newStackBranchNumber.length !== 2) {
        throw new FailedPreconditionError(
            "Too many branches in the stack, a stack may have at most 99 branches",
        );
    }

    // Create a branch name in the same format as `dev branch`. The stack branch
    // format appends another `/` and includes the branch number along with the
    // individual stack branch's name.
    const newBranchFullName = `${stack.username}/${stack.date}-${stack.name}/${newStackBranchNumber}-${branchName}`;

    await runGit([
        "checkout",
        "-b",
        newBranchFullName,
        // Make sure to create a new branch after the last branch in the stack. Not the
        // branch that's currently checked out.
        lastStackBranch.fullName,
    ]);
}

async function runPushCommand({continue: shouldContinue = false}: {continue: boolean | undefined}) {
    const currentBranchFullName = await getCurrentBranchFullName();
    const stack = await getStack(currentBranchFullName);

    let isFirst = true;

    for (const stackBranch of stack.branches) {
        if (shouldContinue && stackBranch.fullName < currentBranchFullName) continue;

        // eslint-disable-next-line no-console
        if (!isFirst) console.log();
        isFirst = false;

        await runGit(["push", "-u", "origin", stackBranch.fullName]);
    }
}

async function runPrCommand({continue: shouldContinue = false}: {continue: boolean | undefined}) {
    try {
        await runProcess("which", ["gh"]);
    } catch (error) {
        if (!(error instanceof Error) || !isObject(error.cause) || error.cause.exitCode !== 1)
            throw error;

        throw new FailedPreconditionError(
            `Can't find the GitHub CLI, to install visit: ${chalk.underline(
                "https://cli.github.com",
            )}`,
        );
    }

    try {
        await runProcess("gh", ["auth", "status"], {
            // The GitHub CLI needs to inherit all environment variables to find
            // authentication credentials.
            env: process.env,
        });
    } catch (error) {
        if (!(error instanceof Error) || !isObject(error.cause) || error.cause.exitCode !== 1)
            throw error;

        throw new FailedPreconditionError(
            `Please log in to the GitHub CLI, to log in run: ${chalk.bold("gh auth login")}`,
        );
    }

    // Throw if there are uncommitted changes in the working directory.
    await checkGitIsClean();

    const currentBranchFullName = await getCurrentBranchFullName();
    const stack = await getStack(currentBranchFullName);

    let isFirst = true;
    let previousStackBranch: {fullName: string} | null = null;

    for (let i = 0; i < stack.branches.length; i++) {
        const stackBranch = stack.branches[i]!;

        if (shouldContinue && stackBranch.fullName < currentBranchFullName) continue;

        // eslint-disable-next-line no-console
        if (!isFirst) console.log();
        isFirst = false;

        await runGit(["push", "-u", "origin", stackBranch.fullName]);

        // eslint-disable-next-line no-console
        console.log();

        let ghPrCreateStderr = "";

        try {
            await runGh(
                [
                    "pr",
                    "create",
                    "--draft",
                    ["--base", previousStackBranch?.fullName ?? "main"],
                    ["--head", stackBranch.fullName],
                    [
                        "--title",
                        `[${stack.name}][${i + 1}/${stack.branches.length}] ${stackBranch.name}`,
                    ],
                    ["--body", ""],
                ],
                {
                    onStderrData: chunk => {
                        ghPrCreateStderr += chunk.toString("utf8");
                    },
                },
            );
        } catch (error) {
            if (
                error instanceof Error &&
                isObject(error.cause) &&
                error.cause.exitCode === 1 &&
                /pull request for branch "[^"]*" into branch "[^"]*" already exists/.test(
                    ghPrCreateStderr,
                )
            ) {
                // Ignore "PR already exists" error.
            } else {
                throw error;
            }
        }

        previousStackBranch = stackBranch;
    }
}

async function runMergeCommand({
    continue: shouldContinue = false,
}: {
    continue: boolean | undefined;
}) {
    // Throw if there are uncommitted changes in the working directory.
    await checkGitIsClean();

    const currentBranchFullName = await getCurrentBranchFullName();
    const stack = await getStack(currentBranchFullName);

    let isFirst = true;
    let previousStackBranch: {fullName: string} | null = null;

    for (const stackBranch of stack.branches) {
        if (shouldContinue && stackBranch.fullName <= currentBranchFullName) {
            previousStackBranch = stackBranch;
            continue;
        }

        // eslint-disable-next-line no-console
        if (!isFirst) console.log();
        isFirst = false;

        await runGit(["checkout", stackBranch.fullName]);

        // eslint-disable-next-line no-console
        console.log();

        await runGit(["merge", "--no-edit", previousStackBranch?.fullName ?? "main"]);

        previousStackBranch = stackBranch;
    }

    // Return to the original branch if successful.
    await runGit(["checkout", currentBranchFullName]);
}

async function runRunCommand(
    {
        continue: shouldContinue = false,
    }: {
        continue: boolean | undefined;
    },
    [command, ...args]: ReadonlyArray<string>,
) {
    if (!command) {
        throw new InvalidArgumentError("Missing command");
    }

    const currentBranchFullName = await getCurrentBranchFullName();
    const stack = await getStack(currentBranchFullName);

    let isFirst = true;

    for (const stackBranch of stack.branches) {
        if (shouldContinue && stackBranch.fullName < currentBranchFullName) continue;

        // Throw if there are uncommitted changes in the working directory before
        // moving the branch each time.
        await checkGitIsClean();

        // eslint-disable-next-line no-console
        if (!isFirst) console.log();
        isFirst = false;

        await runGit(["checkout", stackBranch.fullName]);

        // eslint-disable-next-line no-console
        console.log();

        // eslint-disable-next-line no-console
        console.log(`${chalk.dim("$")} ${chalk.bold(command)} ${args.join(" ")}`);

        await runProcessWithInheritedStdio(command, args, {env: process.env});
    }

    // Return to the original branch if successful.
    await runGit(["checkout", currentBranchFullName]);
}

/**
 * Run `git` and log `git`'s output to the console. We also log the `git`
 * command we're about to run so the user knows exactly what's happening.
 *
 * If you want to run git silently use `runProcess()`.
 */
async function runGit(args: ProcessArgs) {
    const flattenedArgs: Array<string | undefined | null | false> =
        // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
        // @ts-ignore: I suspect this is a TypeScript bug?
        args.flat(Infinity);

    const argsString = flattenedArgs
        .filter(isNonNullableOrFalse)
        .map((arg, i) => {
            arg = String(arg);
            if (arg.includes(" ") || arg.length === 0) arg = `"${arg}"`;
            if (i === 0) return chalk.bold(arg);
            return arg;
        })
        .join(" ");

    // eslint-disable-next-line no-console
    console.log(`${chalk.dim("$")} ${chalk.bold("git")} ${argsString}`);

    await runProcessWithInheritedStdio("git", args);
}

/**
 * Run the GitHub CLI (`gh`) and log `gh`'s output to the console. We also log
 * the `gh` command we're about to run so the user knows exactly what's
 * happening.
 *
 * If you want to run `gh` silently use `runProcess()`.
 */
async function runGh(
    args: ProcessArgs,
    {
        onStdoutData,
        onStderrData,
    }: {
        onStdoutData?: (chunk: Buffer) => void;
        onStderrData?: (chunk: Buffer) => void;
    } = {},
) {
    const flattenedArgs: Array<string | undefined | null | false> =
        // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
        // @ts-ignore: I suspect this is a TypeScript bug?
        args.flat(Infinity);

    const argsString = flattenedArgs
        .filter(isNonNullableOrFalse)
        .map((arg, i) => {
            arg = String(arg);
            if (arg.includes(" ") || arg.length === 0) arg = `"${arg}"`;
            if (i === 0 || i === 1) return chalk.bold(arg);
            return arg;
        })
        .join(" ");

    // eslint-disable-next-line no-console
    console.log(`${chalk.dim("$")} ${chalk.bold("gh")} ${argsString}`);

    await runProcessWithInheritedStdio("gh", args, {
        // The GitHub CLI needs to inherit all environment variables to find
        // authentication credentials.
        env: process.env,
        onStdoutData,
        onStderrData,
    });
}

/**
 * Get the current git branch name.
 */
async function getCurrentBranchFullName() {
    return (await runProcess("git", ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
}

/**
 * Get the stack that the provided branch name is a part of. Returns all
 * branches in the stack in order.
 */
async function getStack(branchFullName: string): Promise<{
    username: string;
    date: string;
    name: string;
    branches: Array<{
        number: number;
        name: string;
        fullName: string;
    }>;
}> {
    const branchFullNameMatch = branchFullName.match(stackBranchFullNameRegExp);

    if (!branchFullNameMatch) {
        throw new InvalidArgumentError("Must be in a stack branch");
    }

    const username = assertExists(branchFullNameMatch.groups?.username);
    const stackDate = assertExists(branchFullNameMatch.groups?.stackDate);
    const stackName = assertExists(branchFullNameMatch.groups?.stackName);

    const stackBranchFullNames = (
        await runProcess("git", ["branch", "--list", `${username}/${stackDate}-${stackName}/*`])
    )
        // The current branch has a `*` next to it.
        .replace("*", " ")
        .trim()
        .split("\n")
        .map(line => line.trim());

    assert(stackBranchFullNames.length > 0);

    const stackBranches = stackBranchFullNames
        .map(branchFullName => {
            const branchFullNameMatch = assertExists(
                branchFullName.match(stackBranchFullNameRegExp),
            );

            return {
                number: parseInt(assertExists(branchFullNameMatch.groups?.branchNumber), 10),
                name: assertExists(branchFullNameMatch.groups?.branchName),
                fullName: branchFullName,
            };
        })
        .sort((a, b) => a.number - b.number);

    return {
        username,
        date: stackDate,
        name: stackName,
        branches: stackBranches,
    };
}

/**
 * Check that the `git` working directory is clean and throws an error if
 * it's not.
 */
async function checkGitIsClean() {
    const statusOutput = await runProcess("git", ["status", "--porcelain"]);
    if (statusOutput.trim().length > 0) {
        throw new FailedPreconditionError(
            "Working directory isn't clean, please commit or stash changes",
        );
    }
}
