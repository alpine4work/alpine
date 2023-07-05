"use strict";

const path = require("path");
const fs = require("fs-extra");
const worker = require("@bazel/worker");
const {create: createCompiler} = require("@remix-run/dev/dist/compiler/compiler");
const {logger} = require("@remix-run/dev/dist/tux/logger");
const {createFileWatchCache} = require("@remix-run/dev/dist/compiler/fileWatchCache");
const {logThrown} = require("@remix-run/dev/dist/compiler/utils/log");

let state;

async function run(args) {
    const [configPath] = args;

    const configStats = fs.statSync(configPath);
    const configChangeTime = configStats.ctimeMs;

    if (!state || state.configChangeTime < configChangeTime) {
        const configString = fs.readFileSync(configPath, "utf8");

        if (!state || state.configString !== configString) {
            state = {
                configChangeTime,
                configString,
                compilerPromise: createCompiler({
                    config: JSON.parse(configString.replaceAll("{{remixRoot}}", process.cwd())),
                    options: {
                        mode:
                            process.env.BAZEL_COMPILATION_MODE === "opt"
                                ? "production"
                                : "development",
                        sourcemap: process.env.BAZEL_COMPILATION_MODE === "opt" ? false : true,
                    },
                    fileWatchCache: createFileWatchCache(),
                    logger,
                }),
            };
        }
    }

    try {
        const compiler = await state.compilerPromise;
        await compiler.compile();
        return true;
    } catch (error) {
        logThrown(error);
        return false;
    }
}

if (!worker.runAsWorker(process.argv)) {
    const argsFileContents = fs.readFileSync(
        path.resolve(process.cwd(), "../../..", process.argv[2].slice(1)),
        "utf8",
    );

    run(argsFileContents.trim().split("\n")).then(
        success => {
            process.exit(success ? 0 : 1);
        },
        error => {
            // eslint-disable-next-line no-console
            console.error(error);
            process.exit(1);
        },
    );
} else {
    worker.runWorkerLoop(run);
}
