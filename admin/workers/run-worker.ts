/* eslint-disable no-console */
import {vanillaExtractPlugin} from "@vanilla-extract/esbuild-plugin";
import {Plugin, build as esbuild} from "esbuild";
import path from "path";
import {repoDirectoryPath} from "~/server/helpers/repo-directory-path";
import {runProcess} from "~/server/helpers/run-process";
import {Schema} from "~/shared/schema/schema";

const SHOULD_PRINT_DEPS = false;

const COLLABORATION_WORKER_PORT = Schema.string.deserialize(
    process.env.COLLABORATION_WORKER_PORT ?? null,
);

const printDepsPlugin: Plugin = {
    name: "printDeps",
    setup: build => {
        build.onResolve({filter: /./}, args => {
            if (args.importer.includes("/node_modules/")) return undefined;
            const imported = args.path.replace(/^~\//, "");
            const importer = path
                .relative(repoDirectoryPath, args.importer)
                .replace(/\.[tj]sx?$/, "");
            console.log(`${JSON.stringify(importer)} -> ${JSON.stringify(imported)}`);
            return undefined;
        });
    },
};

async function buildWorker({watch = false, minify = false} = {}) {
    return await esbuild({
        entryPoints: ["collaboration-worker/collaboration-worker.ts"],
        outfile: "collaboration-worker/bundled/collaboration-worker.js",
        bundle: true,
        format: "esm",
        target: "es2019",
        plugins: [
            vanillaExtractPlugin() as Plugin,
            ...(SHOULD_PRINT_DEPS ? [printDepsPlugin] : []),
        ],
        sourcemap: "inline",
        define: Object.fromEntries(
            Object.entries(process.env).map(([key, value]) => [
                `process.env.${key}`,
                JSON.stringify(value),
            ]),
        ),
        external: ["crypto", "~/server/network/all-network-implementations"],
        minify: minify,
        watch: watch,
    });
}

async function runWorker() {
    console.log("building worker...");
    await buildWorker({watch: true});
    console.log("starting wrangler...");
    await runProcess(
        "./node_modules/.bin/wrangler",
        [
            "dev",
            "--config",
            "./collaboration-worker/wrangler.toml",
            "--no-bundle",
            "--port",
            COLLABORATION_WORKER_PORT,
            "--local",
        ],
        {
            onStdoutData: data => process.stdout.write(data),
            onStderrData: data => process.stderr.write(data),
        },
    );
}

runWorker().catch(error => {
    console.log(error.stack);
    process.exit(1);
});
