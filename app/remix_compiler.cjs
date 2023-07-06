"use strict";

const path = require("path");
const fs = require("fs-extra");
const worker = require("@bazel/worker");
const {create: createCompiler} = require("@remix-run/dev/dist/compiler/compiler");
const {logger} = require("@remix-run/dev/dist/tux/logger");
const {logThrown} = require("@remix-run/dev/dist/compiler/utils/log");

let state;

async function run(args) {
    const [configPath] = args;

    const configStats = fs.statSync(configPath);
    const configModificationTime = configStats.mtimeMs;

    if (!state || state.configModificationTime < configModificationTime) {
        const configString = fs.readFileSync(configPath, "utf8");

        if (!state || state.configString !== configString) {
            const context = {
                config: JSON.parse(configString.replaceAll("{{remixRoot}}", process.cwd())),
                options: {
                    mode:
                        process.env.BAZEL_COMPILATION_MODE === "opt" ? "production" : "development",
                    sourcemap: process.env.BAZEL_COMPILATION_MODE === "opt" ? false : true,
                },
                fileWatchCache: createFileWatchCache(),
                logger,
            };

            state = {
                configModificationTime,
                configString,
                context,
                compilerPromise: createCompiler(context),
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
            process.exitCode = 1;
        },
    );
} else {
    worker.runWorkerLoop(run);
}

/**
 * We have a custom implementation of the Remix [file watch cache][1]
 * because...well...our Remix compiler doesn't watch files. It builds on
 * demand. So we record the file's modification time and invalidate the cache
 * when it changes.
 *
 * [1]: https://github.com/remix-run/remix/blob/76327d3b9dcfbb93fd57cd9254a7b66342aba704/packages/remix-dev/compiler/fileWatchCache.ts
 */
function createFileWatchCache() {
    const promiseForCacheKey = new Map();

    const modificationTimeForFileDepForCacheKey = new Map();
    const cacheKeysForFileDep = new Map();

    function invalidateCacheKey(invalidatedCacheKey) {
        // If it's not a cache key (or doesn't have a cache entry), bail out
        if (!promiseForCacheKey.has(invalidatedCacheKey)) return;
        promiseForCacheKey.delete(invalidatedCacheKey);

        // Since we keep track of the mapping between cache key and file
        // dependencies, we clear all references to the invalidated cache key.
        // These will be repopulated when "set" or "getOrSet" are called.
        const modificationTimeForFileDep =
            modificationTimeForFileDepForCacheKey.get(invalidatedCacheKey);
        if (modificationTimeForFileDep) {
            for (const fileDep of modificationTimeForFileDep.keys()) {
                cacheKeysForFileDep.get(fileDep)?.delete(invalidatedCacheKey);
            }
            modificationTimeForFileDepForCacheKey.delete(invalidatedCacheKey);
        }
    }

    function invalidateFile(invalidatedFile) {
        // Invalidate all cache entries that depend on the file.
        const cacheKeys = cacheKeysForFileDep.get(invalidatedFile);
        if (cacheKeys) {
            for (const cacheKey of cacheKeys) {
                invalidateCacheKey(cacheKey);
            }
        }
    }

    function get(key) {
        // NOTE(calebmer): This is our main modification to this function from Remix.
        // If the file mtime has changed then we invalidate the cache for that file.
        const modificationTimeForFileDep = modificationTimeForFileDepForCacheKey.get(key);
        if (modificationTimeForFileDep) {
            for (const [fileDep, modificationTime] of modificationTimeForFileDep) {
                const newModificationTime = fs.statSync(fileDep).mtimeMs;
                if (newModificationTime > modificationTime) {
                    invalidateFile(fileDep);
                }
            }
        }

        return promiseForCacheKey.get(key);
    }

    function set(key, promise) {
        promiseForCacheKey.set(key, promise);

        promise
            .catch(() => {
                // Swallow errors to prevent the build from crashing and remove the
                // rejected promise from the cache so consumers can retry
                if (promiseForCacheKey.get(key) === promise) {
                    promiseForCacheKey.delete(key);
                }

                return null;
            })
            .then(promiseValue => {
                // If the promise was rejected, don't attempt to track dependencies
                if (promiseValue === null) {
                    return;
                }

                if (promiseForCacheKey.get(key) !== promise) {
                    // This cache key was invalidated before the promise resolved
                    // so we don't want to track the dependencies.
                    return;
                }

                const {fileDependencies, globDependencies} = promiseValue;

                // Track all file dependencies for this entry point so we can invalidate
                // all cache entries that depend on a file that was invalidated.
                if (fileDependencies) {
                    let modificationTimeForFileDep = modificationTimeForFileDepForCacheKey.get(key);
                    if (!modificationTimeForFileDep) {
                        modificationTimeForFileDep = new Map();
                        modificationTimeForFileDepForCacheKey.set(key, modificationTimeForFileDep);
                    }
                    for (const fileDep of fileDependencies) {
                        modificationTimeForFileDep.set(fileDep, fs.statSync(fileDep).mtimeMs);

                        let cacheKeys = cacheKeysForFileDep.get(fileDep);
                        if (!cacheKeys) {
                            cacheKeys = new Set();
                            cacheKeysForFileDep.set(fileDep, cacheKeys);
                        }
                        cacheKeys.add(key);
                    }
                }

                // Only use of glob dependencies is a CSS directory import:
                // https://github.com/remix-run/remix/blob/76327d3b9dcfbb93fd57cd9254a7b66342aba704/packages/remix-dev/compiler/utils/postcss.ts#L191-L198
                if (globDependencies && globDependencies.size > 0) {
                    throw new Error(
                        "Glob dependencies are unsupported in our custom `FileWatchCache`",
                    );
                }
            });

        return promise;
    }

    function getOrSet(key, lazySetter) {
        return get(key) || set(key, lazySetter());
    }

    return {
        get,
        set,
        getOrSet,
        invalidateFile,
    };
}
