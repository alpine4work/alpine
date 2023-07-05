"use strict";

const path = require("path");
const fs = require("fs-extra");
const worker = require("@bazel/worker");
const {create: createCompiler} = require("@remix-run/dev/dist/compiler/compiler");
const {logger} = require("@remix-run/dev/dist/tux/logger");
const {createFileWatchCache} = require("@remix-run/dev/dist/compiler/fileWatchCache");
const {logThrown} = require("@remix-run/dev/dist/compiler/utils/log");
const HDR = require("@remix-run/dev/dist/devServer_unstable/hdr");
const HMR = require("@remix-run/dev/dist/devServer_unstable/hmr");

let state;

async function run(args) {
    const [configPath] = args;

    const configStats = fs.statSync(configPath);
    const configChangeTime = configStats.ctimeMs;

    if (!state || state.configChangeTime < configChangeTime) {
        const configString = fs.readFileSync(configPath, "utf8");

        if (!state || state.configString !== configString) {
            const context = {
                config: JSON.parse(configString.replaceAll("{{remixRoot}}", process.cwd())),
                options: {
                    mode:
                        process.env.BAZEL_COMPILATION_MODE === "opt" ? "production" : "development",
                    sourcemap: process.env.BAZEL_COMPILATION_MODE === "opt" ? false : true,
                },
                // TODO(calebmer): We don't use a file watcher so we need some other way to
                // invalidate this cache. Probably ctime.
                fileWatchCache: createFileWatchCache(),
                logger,
            };

            state = {
                configChangeTime,
                configString,
                context,
                compilerPromise: createCompiler(context),

                // For HMR + HDR
                manifest: undefined,
                previousManifest: undefined,
                loaderChanges: undefined,
                previousLoaderChanges: undefined,
            };
        }
    }

    try {
        const {context, compilerPromise} = state;
        const compiler = await compilerPromise;

        const loaderChangesPromise = HDR.detectLoaderChanges(context).then(
            value => ({ok: true, value}),
            error => ({ok: false, error}),
        );

        await compiler.compile({
            onManifest: manifest => {
                state.manifest = manifest;
            },
        });

        // We manually implement Remix's HMR and HDR support to work with Bazel. You
        // can see their original source code here:
        // https://github.com/remix-run/remix/blob/fae7cd1931e21ed1196a1d59bd168cba6898ac78/packages/remix-dev/devServer_unstable/index.ts#L231-L255
        const newState = {previousManifest: state.manifest};
        try {
            const loaderChanges = await loaderChangesPromise;
            if (loaderChanges.ok) {
                newState.previousLoaderChanges = loaderChanges.value;
            }
            if (loaderChanges.ok && state.manifest && state.previousManifest) {
                const updates = HMR.updates(
                    context.config,
                    state.manifest,
                    state.previousManifest,
                    loaderChanges.value,
                    state.previousLoaderChanges,
                );

                // TODO(calebmer): HMR
            } else if (state.previousManifest !== undefined) {
                // TODO(calebmer): Live reload
            }
        } finally {
            Object.assign(state, newState);
        }

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
