"use strict";

const worker = require("@bazel/worker");
const remixCompiler = require("@remix-run/dev/dist/compiler/remixCompiler");
const {logCompileFailure} = require("@remix-run/dev/dist/compiler/onCompileFailure");
const {readConfig} = require("@remix-run/dev/dist/config");

let compilerPromise;

async function run() {
    if (!compilerPromise) {
        compilerPromise = (async () => {
            const config = await readConfig();

            return remixCompiler.createRemixCompiler(config, {
                mode: process.env.COMPILATION_MODE === "opt" ? "production" : "development",
                sourcemap: process.env.COMPILATION_MODE === "opt" ? false : true,
            });
        })();
    }

    let failed = false;
    const compiler = await compilerPromise;

    await remixCompiler.compile(compiler, {
        onCompileFailure: failure => {
            logCompileFailure(failure);
            failed = true;
        },
    });

    return !failed;
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
