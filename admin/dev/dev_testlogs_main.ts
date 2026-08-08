import * as inquirer from "@inquirer/prompts";
import chalk from "chalk";
import {spawn} from "child_process";
import glob from "fast-glob";
import fs from "fs-extra";
import murmurhash from "murmurhash";
import {basename, dirname, join as joinPath, relative as pathRelative} from "path";
import {devEnvPaths} from "~/admin/helpers/dev_env_paths.js";
import {runProcess} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForProcessExitWithAnyCode} from "~/server/helpers/node/wait_for_process_exit.js";
import {getWorkspacePath} from "~/server/helpers/node/workspace_path.js";
import {FailedPreconditionError, InternalError} from "~/shared/error/error.open_source.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.open_source.js";
import {Mutex} from "~/shared/helpers/async/mutex.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.open_source.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.open_source.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

async function main(): Promise<{exitCode: number}> {
    let testlogsPath = atob(process.argv[2] ?? "");

    if (testlogsPath.length === 0) {
        testlogsPath = joinPath(getWorkspacePath(), "bazel-testlogs");
    }

    testlogsPath = await fs.realpath(testlogsPath);

    if (testlogsPath.endsWith(".zip")) {
        const testlogsPathHash = murmurhash.v3(testlogsPath).toString(16).padStart(8, "0");
        const unzippedTestlogsPath = joinPath(devEnvPaths.temp, "testlogs", testlogsPathHash);

        await fs.ensureDir(unzippedTestlogsPath);

        await runProcess("unzip", ["-o", testlogsPath, "-d", unzippedTestlogsPath]);

        testlogsPath = unzippedTestlogsPath;
    }

    if (!(await fs.stat(testlogsPath)).isDirectory()) {
        throw new FailedPreconditionError(
            quote`Test logs path is not a directory: ${testlogsPath}`,
        );
    }

    const paths = await glob([
        joinPath(testlogsPath, "**/test.log"),
        joinPath(testlogsPath, "**/test.outputs/outputs.zip"),
        joinPath(testlogsPath, "**/test_attempts/attempt_*.log"),
        joinPath(testlogsPath, "**/test_attempts/attempt_*.outputs/outputs.zip"),
    ]);

    const testInfos = new DefaultMap<
        string,
        {
            name: string;
            logPath: string | null;
            outputPath: string | null;
            outputPlaywrightTraces: Array<{name: string; relativePath: string}>;
            attempts: DefaultMap<
                string,
                {
                    logPath: string | null;
                    outputPath: string | null;
                    outputPlaywrightTraces: Array<{name: string; relativePath: string}>;
                }
            >;
        }
    >(name => ({
        name,
        logPath: null,
        outputPath: null,
        outputPlaywrightTraces: [],
        attempts: new DefaultMap(() => ({
            logPath: null,
            outputPath: null,
            outputPlaywrightTraces: [],
        })),
    }));

    for (const path of paths) {
        const pathBasename = basename(path);
        const pathDirname = dirname(path);

        if (pathBasename === "test.log") {
            const testName = pathRelative(testlogsPath, pathDirname);

            testInfos.getOrSetDefault(testName).logPath = path;
        } else if (pathBasename === "outputs.zip") {
            const pathDirnameBasename = basename(pathDirname);
            const pathDirnameDirname = dirname(pathDirname);

            if (pathDirnameBasename === "test.outputs") {
                const testName = pathRelative(testlogsPath, pathDirnameDirname);

                testInfos.getOrSetDefault(testName).outputPath = path;
            } else {
                const [, attemptName = ""] = assertExists(
                    pathDirnameBasename.match(/^attempt_(.*)\.outputs$/),
                );
                const pathDirnameDirnameDirname = dirname(pathDirnameDirname);
                const testName = pathRelative(testlogsPath, pathDirnameDirnameDirname);

                testInfos
                    .getOrSetDefault(testName)
                    .attempts.getOrSetDefault(attemptName).outputPath = path;
            }
        } else {
            const [, attemptName = ""] = assertExists(pathBasename.match(/^attempt_(.*)\.log$/));
            const pathDirnameDirname = dirname(pathDirname);
            const testName = pathRelative(testlogsPath, pathDirnameDirname);

            testInfos.getOrSetDefault(testName).attempts.getOrSetDefault(attemptName).logPath =
                path;
        }
    }

    const mutexes = createArrayWithLength(3, () => new Mutex());

    const sortedTestInfos = (
        await runAllPromises(
            mapIterable(testInfos.values(), async (testInfo, i) => {
                // If we're looking at a testlogs directory that hasn't been cleaned by
                // `admin/bazel/prepare_bazel_testlogs_failure_artifact.sh` we'll have test
                // successes and test failures in the directory. Find any test successes and remove
                // them.
                const testXmlPath = joinPath(testlogsPath, testInfo.name, "test.xml");
                if (await fs.pathExists(testXmlPath)) {
                    // Read only the first three lines of our `test.xml` file.
                    //
                    // We only allow 3 `head` process runs at a time to make sure we don't run out of
                    // file descriptors. We found that running `head` concurrently on many files
                    // sometimes led to `testXmlContents` returning an empty string without error.
                    const testXmlContents = await mutexes[i % mutexes.length]!.withLock(() =>
                        runProcess("head", ["-3", testXmlPath]),
                    );

                    const failuresAndErrorsMatch = testXmlContents.match(
                        /<testsuite name=".*failures="([0-9]+)" errors="([0-9]+)"/,
                    );

                    if (!failuresAndErrorsMatch) {
                        throw new InternalError(
                            quote`Failed to parse \`test.xml\` file: ${testXmlPath}`,
                        );
                    }

                    if (failuresAndErrorsMatch[1] === "0" && failuresAndErrorsMatch[2] === "0") {
                        return null;
                    }
                }

                const primaryPath =
                    testInfo.logPath ??
                    testInfo.outputPath ??
                    iterableFirst(
                        filterMapIterable(
                            testInfo.attempts.values(),
                            testAttemptInfo =>
                                testAttemptInfo.logPath ?? testAttemptInfo.outputPath ?? undefined,
                        ),
                    );
                if (!primaryPath) return null;

                const [modifiedTime] = await runAllPromises([
                    fs.stat(primaryPath).then(stats => stats.mtime),
                    (async () => {
                        testInfo.outputPlaywrightTraces = await getTestOutputPlaywrightTraces(
                            testInfo.name,
                            testInfo.outputPath,
                        );
                    })(),
                    runAllPromises(
                        mapIterable(testInfo.attempts.values(), async testAttemptInfo => {
                            testAttemptInfo.outputPlaywrightTraces =
                                await getTestOutputPlaywrightTraces(
                                    testInfo.name,
                                    testAttemptInfo.outputPath,
                                );
                        }),
                    ),
                ]);

                return {modifiedTime, testInfo};
            }),
        )
    ).filter(isNonNullable);

    sortedTestInfos.sort(
        (testInfo1, testInfo2) =>
            (testInfo2.modifiedTime?.getTime() ?? 0) - (testInfo1.modifiedTime?.getTime() ?? 0),
    );

    if (sortedTestInfos.length === 0) {
        // eslint-disable-next-line no-console
        console.log(chalk.dim("All tests passed, no failing test artifacts to inspect"));
        return {exitCode: 0};
    }

    const choices1: Array<{
        name: string;
        description: string;
        value: () => Promise<{exitCode: number}>;
    }> = [];

    const choices2: Array<{
        name: string;
        description: string;
        value: () => Promise<{exitCode: number}>;
    }> = [];

    const choices3 = sortedTestInfos.flatMap(({testInfo}) => {
        const choices: Array<{
            name: string;
            description: string;
            value: () => Promise<{exitCode: number}>;
        }> = [];

        if (testInfo.logPath !== null) {
            const path = testInfo.logPath;

            choices.push({
                name: `${testInfo.name} › logs`,
                description: path,
                value: () => displayTestLogPath(path),
            });
        }

        if (testInfo.outputPath !== null) {
            const path = testInfo.outputPath;

            choices.push({
                name: `${testInfo.name} › output`,
                description: path,
                value: () => openTestOutputPath(path),
            });

            for (const testOutputPlaywrightTrace of testInfo.outputPlaywrightTraces) {
                // Put Playwright test options first since that's usually what you want to see when
                // you run the `dev testlogs` command.
                choices1.push({
                    name: `${testInfo.name} › output › playwright › ${testOutputPlaywrightTrace.name}`,
                    description: path,
                    value: () =>
                        showTestOutputPlaywrightTrace(path, testOutputPlaywrightTrace.relativePath),
                });
            }
        }

        for (const [testAttemptName, testAttemptInfo] of testInfo.attempts) {
            if (testAttemptInfo.logPath !== null) {
                const path = testAttemptInfo.logPath;

                choices.push({
                    name: `${testInfo.name} › attempt ${testAttemptName} › logs`,
                    description: path,
                    value: () => displayTestLogPath(path),
                });
            }

            if (testAttemptInfo.outputPath !== null) {
                const path = testAttemptInfo.outputPath;

                choices.push({
                    name: `${testInfo.name} › attempt ${testAttemptName} › output`,
                    description: path,
                    value: () => openTestOutputPath(path),
                });

                for (const testOutputPlaywrightTrace of testAttemptInfo.outputPlaywrightTraces) {
                    // Put Playwright test options first since that's usually what you want to see when
                    // you run the `dev testlogs` command.
                    choices2.push({
                        name: `${testInfo.name} › attempt ${testAttemptName} › output › playwright › ${testOutputPlaywrightTrace.name}`,
                        description: path,
                        value: () =>
                            showTestOutputPlaywrightTrace(
                                path,
                                testOutputPlaywrightTrace.relativePath,
                            ),
                    });
                }
            }
        }

        return choices;
    });

    const executeChoice = await inquirer.select({
        message: "Which failing test artifact do you want to inspect?",
        pageSize: 30,
        choices: [...choices1, ...choices2, ...choices3],
    });

    return await executeChoice();
}

main()
    .then(({exitCode}) => {
        process.exit(exitCode);
    })
    .catch(error => {
        // eslint-disable-next-line no-console
        console.error(error);
        process.exitCode = 1;
    });

async function getTestOutputPlaywrightTraces(testName: string, testOutputPath: string | null) {
    if (testOutputPath === null) return [];

    const testManifestContents = await fs.readFile(
        joinPath(`${dirname(testOutputPath)}_manifest`, "MANIFEST"),
        "utf8",
    );

    return Array.from(testManifestContents.matchAll(/^(.*)\/trace\.zip\t/gm), match => {
        let relativePathPrefix = pathRelative("app/integration_tests", testName);
        let relativePathSuffix = "";

        const runRelativePathPrefixMatch = relativePathPrefix.match(
            /\/run_(?:[1-9][0-9]*)_of_(?:[1-9][0-9]*)$/,
        );
        if (runRelativePathPrefixMatch) {
            relativePathPrefix = relativePathPrefix.slice(0, -runRelativePathPrefixMatch[0].length);
        }

        if (relativePathPrefix.endsWith("_chromium_test")) {
            relativePathPrefix = relativePathPrefix.slice(0, -14);
            relativePathSuffix = "-chromium";
        } else if (relativePathPrefix.endsWith("_webkit_mobile_test")) {
            relativePathPrefix = relativePathPrefix.slice(0, -19);
            relativePathSuffix = "-webkit-mobile";
        } else {
            throw new InternalError(quote`Unexpected Playwright test name: ${relativePathPrefix}`);
        }

        relativePathPrefix = relativePathPrefix.replaceAll("/", "-");

        const relativePath = match[1]!;
        let name = relativePath;

        let hasStrippedRelativePathPrefix = false;

        for (let i = 0; i < relativePathPrefix.length + 1; i++) {
            if (i === relativePathPrefix.length || name[i] !== relativePathPrefix[i]) {
                if (name[i] !== "-") break;

                if (i + 1 >= 5) {
                    hasStrippedRelativePathPrefix = true;
                    name = name.slice(i + 1);
                }
                break;
            }
        }

        if (!hasStrippedRelativePathPrefix) {
            throw new InternalError(
                quote`Expected Playwright trace path to start with ${relativePathPrefix} (actual trace path: ${relativePath})`,
            );
        }

        if (!name.endsWith(relativePathSuffix)) {
            throw new InternalError(
                quote`Expected Playwright trace path to end with ${relativePathSuffix} (actual trace path: ${relativePath})`,
            );
        }

        name = name.slice(0, -relativePathSuffix.length);

        return {name, relativePath};
    });
}

async function displayTestLogPath(testLogPath: string) {
    const subprocess = spawn("bash", [testLogPath], {
        cwd: getWorkspacePath(),
        env: process.env,
        stdio: ["inherit", "inherit", "inherit"],
    });

    return await waitForProcessExitWithAnyCode(subprocess);
}

async function openTestOutputPath(testOutputPath: string) {
    const testOutputPathDirname = dirname(testOutputPath);
    const unzippedTestOutputPath = joinPath(testOutputPathDirname, "outputs");

    if (!(await fs.pathExists(unzippedTestOutputPath))) {
        await runProcess("chmod", ["+w", testOutputPathDirname]);
        await runProcess("unzip", ["-o", testOutputPath, "-d", unzippedTestOutputPath]);
    }

    await runProcess("open", [unzippedTestOutputPath]);

    return {exitCode: 0};
}

async function showTestOutputPlaywrightTrace(
    testOutputPath: string,
    testOutputPlaywrightTraceRelativePath: string,
) {
    const testOutputPathDirname = dirname(testOutputPath);
    const unzippedTestOutputPath = joinPath(testOutputPathDirname, "outputs");

    if (!(await fs.pathExists(unzippedTestOutputPath))) {
        await runProcess("chmod", ["+w", testOutputPathDirname]);
        await runProcess("unzip", ["-o", testOutputPath, "-d", unzippedTestOutputPath]);
    }

    const playwrightShowTraceBinPath = joinPath(
        runfilesPath,
        "cyberworlds/admin/playwright/playwright_show_trace.sh",
    );

    await runProcess(
        playwrightShowTraceBinPath,
        [
            "show-trace",
            joinPath(unzippedTestOutputPath, testOutputPlaywrightTraceRelativePath, "trace.zip"),
        ],
        {env: {BAZEL_BINDIR: "."}},
    );

    return {exitCode: 0};
}
