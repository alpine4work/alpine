import crypto from "crypto";
import fsSync from "fs";
import fs from "fs/promises";
import {
    dirname as dirnamePath,
    join as joinPath,
    posix as pathPosix,
    relative as relativePath,
    resolve as resolvePath,
} from "path";
import {finished as finishedStream} from "stream/promises";
import {
    esbuildOutputFromId,
    flattenId,
    needsInterop,
    prepareEsbuildOptimizerRun,
    resolveConfig,
    stringifyDepsOptimizerMetadata,
    tryNodeResolve,
} from "vite";

main().then(
    () => {
        process.exit(0);
    },
    error => {
        // eslint-disable-next-line no-console
        console.error(error);
        process.exit(1);
    },
);

async function main() {
    const {bazelSandboxPlugin} = await import(
        joinPath(
            process.env.JS_BINARY__EXECROOT,
            "external/aspect_rules_esbuild/esbuild/private/plugins/bazel-sandbox.cjs",
        )
    );

    const rawDeps = await fs.readFile(
        joinPath(process.cwd(), "app/app_client_optimize_deps_data.bzl"),
        "utf8",
    );
    const deps = Array.from(rawDeps.matchAll(/"([^"]*)"/g), match => match[1]);

    const resolvedConfig = await resolveConfig(
        {
            root: process.cwd(),
            configFile: joinPath(process.cwd(), "vite.config.mjs"),
            mode: process.env.NODE_ENV,
        },
        "serve",
    );

    // Add the `aspect_rules_esbuild` Bazel sandbox plugin so imports don't escape the
    // sandbox.
    resolvedConfig.optimizeDeps.esbuildOptions.plugins ??= [];
    resolvedConfig.optimizeDeps.esbuildOptions.plugins.unshift(bazelSandboxPlugin());

    // Add the `aspect_rules_esbuild` Bazel sandbox plugin so imports don't escape the
    // sandbox.
    resolvedConfig.ssr.optimizeDeps.esbuildOptions.plugins ??= [];
    resolvedConfig.ssr.optimizeDeps.esbuildOptions.plugins.unshift(bazelSandboxPlugin());

    await Promise.all([
        runOptimizeDeps(deps, resolvedConfig, false),
        runOptimizeDeps(deps, resolvedConfig, true),
    ]);
}

// Below we reproduce a lot of Vite's `runOptimizeDeps()` code. Except we only need
// to run the dependency optimizer once and we don't need to watch for changes.
//
// https://github.com/vitejs/vite/blob/b1ecdaf6594b48d2fcbff8682e9ef68916806089/packages/vite/src/node/optimizer/index.ts#L462-L710
async function runOptimizeDeps(deps, resolvedConfig, ssr) {
    const optimizerContext = {cancelled: false};
    const processingCacheDir = joinPath(
        process.cwd(),
        `app/optimize_deps/deps${ssr ? "_ssr" : ""}`,
    );

    const depsInfoEntries = await Promise.all(
        deps.map(async dep => {
            const resolvedDep = await tryNodeResolve(
                dep,
                undefined,
                {...resolvedConfig.resolve, root: resolvedConfig.root},
                !ssr,
                undefined,
                ssr,
                false,
            );
            if (!resolvedDep) throw new Error(`Couldn\u2019t resolve import \`${dep}\``);

            // Ignore any non-JavaScript files. e.g. `.css` files.
            if (!/\.(jsx?|cjs|mjs)$/.test(resolvedDep.id)) return;

            return [
                dep,
                {
                    id: dep,
                    src: resolvedDep.id,
                    file: joinPath(processingCacheDir, `${flattenId(dep)}.js`),
                },
            ];
        }),
    );

    const depsInfo = Object.fromEntries(depsInfoEntries.filter(Boolean));

    await fs.mkdir(processingCacheDir, {recursive: true});

    await fs.writeFile(
        joinPath(processingCacheDir, "package.json"),
        JSON.stringify({type: "module"}),
    );

    const {context, idToExports} = await prepareEsbuildOptimizerRun(
        resolvedConfig,
        depsInfo,
        ssr,
        processingCacheDir,
        optimizerContext,
    );

    const result = await context.rebuild();

    // Create a functionally equivalent hash to what Vite creates with
    // `getOptimizedBrowserHash()`. Except instead of building a hash from the lockfile
    // and config, build a hash from the built outputs themselves.
    //
    // This will be more accurate than the hash Vite creates. Should be cacheable by
    // Bazel.
    const browserHasher = crypto.createHash("sha256");

    for (const output of Object.keys(result.metafile.outputs).sort()) {
        browserHasher.write(`${output}\n`);
        const stream = fsSync.createReadStream(joinPath(process.cwd(), output));
        stream.pipe(browserHasher, {end: false});
        await finishedStream(stream);
    }

    const browserHash = browserHasher.digest("hex").substring(0, 8);

    const metadata = {
        hash: "00000000",
        lockfileHash: "00000000",
        configHash: "00000000",
        browserHash,
        optimized: {},
        chunks: {},
        discovered: {},
        depInfoList: [],
    };

    const config = {...resolvedConfig, command: "build"};
    const processingCacheDirOutputPath = relativePath(process.cwd(), processingCacheDir);

    for (const id of Object.keys(depsInfo)) {
        const output = esbuildOutputFromId(result.metafile.outputs, id, processingCacheDir);
        const {exportsData, ...info} = depsInfo[id];
        addOptimizedDepInfo(metadata, "optimized", {
            ...info,
            fileHash: metadata.browserHash,
            browserHash: metadata.browserHash,
            // After bundling we have more information and can warn the user about legacy
            // packages that require manual configuration
            needsInterop: needsInterop(config, ssr, id, idToExports[id], output),
        });
    }

    for (const output of Object.keys(result.metafile.outputs)) {
        if (/\.js\.map$/i.test(output)) continue;

        const id = relativePath(processingCacheDirOutputPath, output).replace(/\.js$/i, "");
        const file = pathPosix.normalize(resolvePath(processingCacheDir, flattenId(id) + ".js"));
        if (!findOptimizedDepInfoInRecord(metadata.optimized, depInfo => depInfo.file === file)) {
            addOptimizedDepInfo(metadata, "chunks", {
                id,
                file,
                needsInterop: false,
                browserHash: metadata.browserHash,
            });
        }
    }

    // Copy WASM files from dependencies
    await Promise.all(
        deps.map(async dep => {
            const resolvedDep = await tryNodeResolve(
                dep,
                undefined,
                {...resolvedConfig.resolve, root: resolvedConfig.root},
                !ssr,
                undefined,
                ssr,
                false,
            );

            if (resolvedDep) {
                // Look for WASM files in the same directory as the resolved dependency
                const depDir = dirnamePath(resolvedDep.id);

                // HACK: this isn't an ideal implementation, just a practical one to get Harper.js
                // working. Ideally we should recursively look through this directory for WASM
                // files.
                const files = await fs.readdir(depDir);
                for (const file of files) {
                    if (file.endsWith(".wasm")) {
                        const srcPath = joinPath(depDir, file);
                        const destPath = joinPath(processingCacheDir, file);
                        await fs.copyFile(srcPath, destPath);
                    }
                }
            }
        }),
    );

    await fs.writeFile(
        joinPath(processingCacheDir, "_metadata.json"),
        stringifyDepsOptimizerMetadata(metadata, processingCacheDir),
    );
}

function addOptimizedDepInfo(metadata, type, depInfo) {
    metadata[type][depInfo.id] = depInfo;
    metadata.depInfoList.push(depInfo);
    return depInfo;
}

function findOptimizedDepInfoInRecord(dependenciesInfo, callbackFn) {
    for (const o of Object.keys(dependenciesInfo)) {
        const info = dependenciesInfo[o];
        if (callbackFn(info, o)) {
            return info;
        }
    }
}
