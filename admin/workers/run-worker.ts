/* eslint-disable no-console */
import {vanillaExtractPlugin} from "@vanilla-extract/esbuild-plugin";
import {Plugin, build as esbuild} from "esbuild";
import path from "path";
import {repoDirectoryPath} from "~/server/helpers/repo-directory-path";
import {runProcess} from "~/server/helpers/run-process";
import {Schema} from "~/shared/schema/schema";

const shouldPrintDeps = false;

const workerPort = Schema.string.deserialize(process.env.WORKER_PORT ?? null);

const printDepsPlugin: Plugin = {
    name: "printDeps",
    setup: build => {
        build.onResolve({filter: /./}, args => {
            if (args.importer.includes("/node_modules/")) return undefined;
            const imported = args.path.replace(/^~\//, "");
            const importer = path
                .relative(repoDirectoryPath, args.importer)
                .replace(/\.(t|m?j)sx?$/, "");
            console.log(`${JSON.stringify(importer)} -> ${JSON.stringify(imported)}`);
            return undefined;
        });
    },
};

async function buildWorker({watch = false, minify = false} = {}) {
    return await esbuild({
        entryPoints: ["worker/worker.ts"],
        outfile: "worker/bundled/worker.js",
        bundle: true,
        format: "esm",
        target: "es2019",
        plugins: [vanillaExtractPlugin() as Plugin, ...(shouldPrintDeps ? [printDepsPlugin] : [])],
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
    const builder = await buildWorker({watch: true});
    console.log("starting wrangler...");
    try {
        await runProcess(
            "./node_modules/.bin/wrangler",
            [
                "dev",
                "--config",
                "./worker/wrangler.toml",
                "--no-bundle",
                "--port",
                workerPort,
                "--local",
            ],
            {
                onStdoutData: data => process.stdout.write(data),
                onStderrData: data => process.stderr.write(data),
            },
        );
    } finally {
        builder.stop?.();
    }
}

runWorker().catch(error => {
    console.log(error.stack);
    process.exit(1);
});
