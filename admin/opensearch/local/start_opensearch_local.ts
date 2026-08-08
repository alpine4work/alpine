import {spawn} from "child_process";
import crypto from "crypto";
import fs from "fs-extra";
import patchedFs from "fs/promises";
import getPort from "get-port";
import murmurhash from "murmurhash";
import {join as joinPath, resolve as resolvePath} from "path";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForHttpServer} from "~/server/helpers/node/wait_for_http_server.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {waitForProcessSpawn} from "~/server/helpers/node/wait_for_process_spawn.js";
import {FailedPreconditionError, UnknownError} from "~/shared/error/error.open_source.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {Lazy} from "~/shared/helpers/control/lazy.open_source.js";
import {isObject} from "~/shared/helpers/object/is_object.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

// Use the Node.js implementation of `fs` that doesn't include the `rules_js` `fs`
// patch.
const unpatchedFs: typeof patchedFs = (patchedFs as any)._unpatched ?? patchedFs;

const javaBasePathPromise = new Lazy(async () => {
    const javaPathPath = joinPath(
        runfilesPath,
        "cyberworlds/admin/opensearch/local/java_base_path.txt",
    );
    const javaPath = (await fs.readFile(javaPathPath, "utf8")).trim();
    assert(javaPath.startsWith("external/"));
    return joinPath(runfilesPath, javaPath.slice("external/".length));
});

const opensearchLocalHomePath = joinPath(runfilesPath, "opensearch_local");
const opensearchLocalBinPath = joinPath(opensearchLocalHomePath, "bin/opensearch");

export type OpensearchLocal = {
    readonly port: number;
    stop(): Promise<void>;
};

/**
 * Start running a [local OpenSearch][1] process with the database persisted to the
 * provided path and listening on the provided port.
 *
 * [1]: https://opensearch.org/
 */
export async function startOpensearchLocal({
    configPath: homePath,
    dataPath,
    logsPath,
    port,
}: {
    configPath: string;
    dataPath: string;
    logsPath: string;
    port: number;
}): Promise<OpensearchLocal> {
    const opensearchLocalHomeHash = crypto
        .createHash("sha256")
        .update(opensearchLocalHomePath)
        .digest("hex")
        .slice(0, 32);

    // It's ok if the path of our OpenSearch runfiles directory changes. This could
    // happen if the `cyberworlds` directory itself moves on the developer's machine.
    // Add a hash of the OpenSearch runfiles directory to `homePath` so `cyberworlds`
    // repositories running from different paths don't conflict.
    homePath = joinPath(homePath, opensearchLocalHomeHash);

    const [javaBasePath, transportPort] = await runAllPromises([
        javaBasePathPromise.get(),
        getPort(),
        fs.ensureDir(homePath),
        fs.ensureDir(dataPath),
        fs.ensureDir(logsPath),
    ]);

    const hash = murmurhash.v3(dataPath).toString(16).padStart(8, "0");

    // For whatever reason you can't bind to IPv4 localhost in a MacOS sandbox but you
    // can bind to IPv6 localhost. See:
    // https://github.com/bazelbuild/bazel/issues/5206#issuecomment-402398624
    const host = process.platform === "darwin" ? "[::1]" : "localhost";

    // Symlink all files in the actual OpenSearch home directory to a new, writable
    // home directory.
    //
    // We need to set OpenSearch's home directory to a path in a writable directory.
    // Since OpenSearch writes some files (e.g. a [temporary keystore file][1]) to its
    // home directory on startup. We should not be writing to Bazel's runfiles
    // directory. Only Bazel should write there. When running tests on our CI Linux
    // server the OS will successfully block all attempts at writing to Bazel's
    // runfiles directory. Which prevents OpenSearch tests from starting.
    //
    // [1]:
    //     https://github.com/opensearch-project/OpenSearch/blob/59302a3d5ea255be7f2bb72187b8df1f0aa33572/server/src/main/java/org/opensearch/bootstrap/Bootstrap.java#L275-L277
    await symlinkHome(opensearchLocalHomePath, homePath);

    async function symlinkHome(actualHomePath: string, newHomePath: string) {
        const actualHomeChildNames = await fs.readdir(actualHomePath);

        await runAllPromises(
            actualHomeChildNames.map(async actualHomeChildName => {
                const newHomeChildPath = joinPath(newHomePath, actualHomeChildName);

                let actualHomeChildPath = joinPath(actualHomePath, actualHomeChildName);
                let actualHomeChildStats = await unpatchedFs.lstat(actualHomeChildPath);

                if (actualHomeChildStats.isSymbolicLink()) {
                    actualHomeChildPath = await unpatchedFs.readlink(actualHomeChildPath);
                    actualHomeChildStats = await unpatchedFs.lstat(actualHomeChildPath);
                }

                if (actualHomeChildStats.isDirectory()) {
                    await fs.ensureDir(newHomeChildPath);
                    await symlinkHome(actualHomeChildPath, newHomeChildPath);
                } else {
                    try {
                        await fs.symlink(actualHomeChildPath, newHomeChildPath, "file");
                    } catch (error) {
                        // If the symlink file already exists and is linked to the right place, then we can
                        // ignore this error. Everything's all right.
                        if (isObject(error) && error.code === "EEXIST") {
                            const currentHomeChildPath =
                                await unpatchedFs.readlink(newHomeChildPath);
                            if (currentHomeChildPath !== actualHomeChildPath) {
                                throw new FailedPreconditionError(
                                    quote`OpenSearch home symlink already exists

 Symlink path: ${newHomeChildPath}
Expected path: ${actualHomeChildPath}
  Actual path: ${currentHomeChildPath}`,
                                );
                            }

                            // Otherwise, all good...
                        } else {
                            throw error;
                        }
                    }
                }
            }),
        );
    }

    const securityPolicyPath = joinPath(homePath, "config/opensearch_security.policy");

    let resolvedHomePath = resolvePath(
        (await unpatchedFs.lstat(opensearchLocalBinPath)).isSymbolicLink()
            ? await unpatchedFs.readlink(opensearchLocalBinPath)
            : opensearchLocalBinPath,
        "../..",
    );

    // If we're in `${bazelOutputBase}/execroot/cyberworlds/external/opensearch_local`
    // we want to change our resolved path to
    // `${bazelOutputBase}/external/opensearch_local` which is where the `.jar` files
    // OpenSearch needs to read actually live.
    const resolvedHomePathParts = resolvedHomePath.split("/");
    if (resolvedHomePathParts[resolvedHomePathParts.length - 4] === "execroot") {
        resolvedHomePathParts.splice(resolvedHomePathParts.length - 4, 2);
        resolvedHomePath = resolvedHomePathParts.join("/");
    }

    /* eslint-disable cyberworlds/string-quotes */

    // Includes the permissions OpenSearch needs to bootstrap. Once OpenSearch has
    // bootstrapped it'll extend this security policy with its own `security.policy`
    // file ([source][1]) and `plugin-security.policy` files ([example][2]).
    //
    // The `java.io.FilePermission` line is the critical line we need to add.
    //
    // [1]:
    //     https://github.com/opensearch-project/OpenSearch/blob/2.11.0/server/src/main/resources/org/opensearch/bootstrap/security.policy
    // [2]:
    //     https://github.com/opensearch-project/OpenSearch/blob/2.11.0/modules/reindex/src/main/plugin-metadata/plugin-security.policy
    await fs.writeFile(
        securityPolicyPath,
        `\
grant {
    permission java.lang.RuntimePermission "exitVM";
    permission java.lang.RuntimePermission "shutdownHooks";
    permission java.lang.RuntimePermission "createSecurityManager";
    permission java.lang.RuntimePermission "setSecurityManager";
    permission java.lang.RuntimePermission "getenv.*";
    permission java.util.PropertyPermission "opensearch.*", "read";
    permission java.security.SecurityPermission "setProperty.networkaddress.cache.ttl";
    permission java.security.SecurityPermission "setProperty.networkaddress.cache.negative.ttl";
    permission java.io.FilePermission "${joinPath(resolvedHomePath, "-")}", "read";
};
`,
    );

    /* eslint-enable cyberworlds/string-quotes */

    const subprocess = spawn(
        opensearchLocalBinPath,
        [
            `-Ecluster.name=cyberworlds_development_${hash}`,
            `-Enode.name=data_${hash}`,
            `-Enetwork.host=${host}`,
            `-Ehttp.port=${port}`,
            `-Etransport.port=${transportPort}`,
            `-Epath.data=${dataPath}`,
            `-Epath.logs=${logsPath}`,
            // When running in tests, we'll be starting many OpenSearch nodes. Limit the CPU
            // processors OpenSearch can use. To reserve these processors on the Bazel side
            // (optional) you can set `tags = ["cpu:2"]`. See:
            // https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-threadpool.html
            ...(process.env.NODE_ENV === "test" ? ["-Enode.processors=2"] : []),
        ],
        {
            env: {
                NODE_ENV: "development",
                JAVA_HOME: javaBasePath,
                OPENSEARCH_HOME: homePath,
                OPENSEARCH_JAVA_OPTS: [
                    // Should improve OpenSearch startup times. See discussion here:
                    // https://github.com/elastic/elasticsearch/issues/28650#issuecomment-365905076
                    //
                    // Documentation for this property here:
                    // https://www.oracle.com/java/technologies/javase/vmoptions-jsp.html
                    `-XX:-AlwaysPreTouch`,
                    // In tests we run many OpenSearch nodes at once. Limit each node to only one
                    // garbage collector thread. See:
                    // https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-threadpool.html
                    // https://www.oracle.com/java/technologies/javase/vmoptions-jsp.html
                    ...(process.env.NODE_ENV === "test"
                        ? ["-XX:ParallelGCThreads=1", "-XX:ConcGCThreads=1"]
                        : []),
                    // NOTE(calebmer, 2023-11-22): Set `jna.debug_load` and `jna.debug_load.jna` to
                    // help us debug issues with the JNA load which caused problems in the past.
                    "-Djna.nosys=true -Djna.debug_load=true -Djna.debug_load.jna=true",
                    // NOTE(calebmer, 2024-07-30): We need to include a custom [Java security
                    // policy][1] to allow OpenSearch to read the original `external/opensearch_local`
                    // directory when it follows symlinks created by `symlinkHome()`.
                    //
                    // [1]:
                    //     https://docs.oracle.com/javase/8/docs/technotes/guides/security/PolicyFiles.html
                    `-Djava.security.manager -Djava.security.policy=${securityPolicyPath}`,
                ].join(" "),

                // Needed on Linux for Java to be able to correctly load the compiled Faiss
                // library. Without this we get the following error:
                //
                // ```
                // java.lang.UnsatisfiedLinkError: no opensearchknn_faiss in java.library.path: /usr/java/packages/lib:/usr/lib64:/lib64:/lib:/usr/lib
                // ```
                //
                // Resources:
                //
                // - [Example in `opensearch-tar-install.sh` startup script](https://github.com/opensearch-project/opensearch-build/blob/e8479607316e0e00b624e4a87782213d7ccd170b/scripts/startup/tar/linux/opensearch-tar-install.sh#L37-L52)
                // - [Forum post discussing the error we were seeing](https://forum.opensearch.org/t/issue-with-opensearch-knn/12633/2)
                LD_LIBRARY_PATH:
                    process.platform !== "darwin"
                        ? process.env.LD_LIBRARY_PATH
                            ? `${process.env.LD_LIBRARY_PATH}:${homePath}/plugins/opensearch-knn/lib`
                            : `${homePath}/plugins/opensearch-knn/lib`
                        : undefined,
            },
            stdio: ["ignore", "pipe", "pipe"],
        },
    );

    let stdout = "";
    let stderr = "";

    const handleStdoutData = (chunk: Buffer) => {
        const string = chunk.toString("utf8");
        stdout += string;
    };

    const handleStderrData = (chunk: Buffer) => {
        const string = chunk.toString("utf8");
        stderr += string;
    };

    subprocess.stdout.on("data", handleStdoutData);
    subprocess.stderr.on("data", handleStderrData);

    const errorPromiseResolver = createPromiseResolver<never>();

    const handleExit = (exitCode: number | null, signal: NodeJS.Signals | null) => {
        if (errorPromiseResolver.isSettled()) return;

        const stderrMessage =
            // stdout/stderr is not included in production since it may have sensitive data.
            // This is the same error message used by `runProcess()`.
            process.env.NODE_ENV === "production"
                ? ""
                : ` (stdout and stderr included for debugging)\n\nstdout:\n${stdout.trim()}\n\nstderr:\n${stderr.trim()}`;

        if (typeof exitCode === "number") {
            errorPromiseResolver.reject(
                new UnknownError(
                    `Process exited with code ${exitCode} (\`opensearch\`)${stderrMessage}`,
                    {cause: {exitCode}},
                ),
            );
        } else {
            const signalMessage = signal !== null ? quote(signal) : "null";
            errorPromiseResolver.reject(
                new UnknownError(
                    `Process exited from signal ${signalMessage} (\`opensearch\`)${stderrMessage}`,
                ),
            );
        }
    };

    const handleError = (error: unknown) => {
        if (errorPromiseResolver.isSettled()) return;

        errorPromiseResolver.reject(error);
    };

    subprocess.on("exit", handleExit);
    subprocess.on("error", handleError);

    try {
        await Promise.race([
            // Wait for the OpenSearch local server to start.
            waitForProcessSpawn(subprocess).then(() => waitForHttpServer(port)),
            // If the process closes before the HTTP server starts, we'll throw an error.
            errorPromiseResolver.promise,
        ]);
    } finally {
        subprocess.off("exit", handleExit);
        subprocess.off("error", handleError);

        // Once the OpenSearch server starts, we don't care about stdout/stderr anymore.
        // All logs should go to the logs path.
        subprocess.stdout.off("data", handleStdoutData);
        subprocess.stderr.off("data", handleStderrData);
        stdout = "";
        stderr = "";
    }

    return {
        port,
        stop: async () => {
            subprocess.kill();
            await waitForProcessExit(subprocess);
        },
    };
}
