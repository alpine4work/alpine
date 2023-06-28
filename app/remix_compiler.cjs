"use strict";

const worker = require("@bazel/worker");
const {create: createCompiler} = require("@remix-run/dev/dist/compiler/compiler");
const {logger} = require("@remix-run/dev/dist/tux/logger");
const {createFileWatchCache} = require("@remix-run/dev/dist/compiler/fileWatchCache");
const {readConfig} = require("@remix-run/dev/dist/config");
const {logThrown} = require("@remix-run/dev/dist/compiler/utils/log");

let compilerPromise;

async function run() {
    if (!compilerPromise) {
        compilerPromise = (async () => {
            const config = await readConfig();

            return createCompiler({
                config,
                options: {
                    mode: process.env.COMPILATION_MODE === "opt" ? "production" : "development",
                    sourcemap: process.env.COMPILATION_MODE === "opt" ? false : true,
                },
                fileWatchCache: createFileWatchCache(),
                logger,
            });
        })();
    }

    const compiler = await compilerPromise;

    try {
        await compiler.compile();
        return true;
    } catch (error) {
        logThrown(error);
        return false;
    }
}

if (!worker.runAsWorker(process.argv)) {
    run().then(
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
