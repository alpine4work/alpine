import {spawn} from "child_process";
import fs from "fs-extra";
import getPort from "get-port";
import murmurhash from "murmurhash";
import {join as joinPath} from "path";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForHttpServer} from "~/server/helpers/node/wait_for_http_server.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {waitForProcessSpawn} from "~/server/helpers/node/wait_for_process_spawn.js";
import {UnknownError} from "~/shared/error/error.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {quote} from "~/shared/helpers/string/quote.js";

const javaBasePathPromise = new Lazy(async () => {
    const javaPathPath = joinPath(
        runfilesPath,
        "cyberworlds/admin/opensearch/local/java_base_path.txt",
    );
    const javaPath = (await fs.readFile(javaPathPath, "utf8")).trim();
    assert(javaPath.startsWith("external/"));
    return joinPath(runfilesPath, javaPath.slice("external/".length));
});

const opensearchLocalBinPath = joinPath(runfilesPath, "opensearch_local/bin/opensearch");

export type OpensearchLocal = {
    readonly port: number;
    stop(): Promise<void>;
};

/**
 * Start running a [local OpenSearch][1] process with the database persisted to
 * the provided path and listening on the provided port.
 *
 * [1]: https://opensearch.org/
 */
export async function startOpensearchLocal({
    dataPath,
    logsPath,
    port,
}: {
    dataPath: string;
    logsPath: string;
    port: number;
}): Promise<OpensearchLocal> {
    const [javaBasePath, transportPort] = await runAllPromises([
        javaBasePathPromise.get(),
        getPort(),
        fs.ensureDir(dataPath),
        fs.ensureDir(logsPath),
    ]);

    const hash = murmurhash.v3(dataPath).toString(16).padStart(8, "0");

    // For whatever reason you can't bind to IPv4 localhost in a MacOS sandbox but
    // you can bind to IPv6 localhost. See:
    // https://github.com/bazelbuild/bazel/issues/5206#issuecomment-402398624
    const host = process.platform === "darwin" ? "[::1]" : "localhost";

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
            // When running in tests, we'll be starting many OpenSearch nodes. Limit the
            // CPU processors OpenSearch can use. To reserve these processors on the Bazel
            // side (optional) you can set `tags = ["cpu:2"]`. See:
            // https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-threadpool.html
            ...(process.env.NODE_ENV === "test" ? ["-Enode.processors=2"] : []),
        ],
        {
            // Run OpenSearch in `logsPath` since OpenSearch wants to write some GC log
            // files relative to the directory it's running in. But when we're running in a
            // test sandbox everything is read-only! Except `logsPath`.
            //
            // - [Source for OpenSearch configuring GC logging][1]
            // - [Source for the default GC log path being the relative path `logs/gc.log`][2]
            //
            // [1]: https://github.com/opensearch-project/OpenSearch/blob/4dcad6dd1fd45b6bd91f041a041829c8687278fa/distribution/src/config/jvm.options#L66-L77
            // [2]: https://github.com/opensearch-project/OpenSearch/blob/59302a3d5ea255be7f2bb72187b8df1f0aa33572/distribution/build.gradle#L590
            cwd: logsPath,

            env: {
                NODE_ENV: "development",
                JAVA_HOME: javaBasePath,
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
                ].join(" "),
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
            // stdout/stderr is not included in production since it may have sensitive
            // data. This is the same error message used by `runProcess()`.
            process.env.NODE_ENV === "production"
                ? ""
                : ` (stdout and stderr included for debugging)\n\nstdout:\n${stdout.trim()}\n\nstderr:\n${stderr.trim()}`;

        if (typeof exitCode === "number") {
            errorPromiseResolver.reject(
                new UnknownError(
                    `"opensearch" process exited with code ${exitCode}${stderrMessage}`,
                ),
            );
        } else {
            const signalMessage = signal !== null ? quote(signal) : "null";
            errorPromiseResolver.reject(
                new UnknownError(
                    `"opensearch" process exited by signal ${signalMessage}${stderrMessage}`,
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

        // Once the OpenSearch server starts, we don't care about stdout/stderr
        // anymore. All logs should go to the logs path.
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
