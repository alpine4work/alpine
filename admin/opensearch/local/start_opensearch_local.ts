import {spawn} from "child_process";
import fs from "fs-extra";
import getPort from "get-port";
import murmurhash from "murmurhash";
import {join as joinPath} from "path";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForHttpServer} from "~/server/helpers/node/wait_for_http_server.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {waitForProcessSpawn} from "~/server/helpers/node/wait_for_process_spawn.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";

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

    const subprocess = spawn(
        opensearchLocalBinPath,
        [
            `-Ecluster.name=cyberworlds_development_${hash}`,
            `-Enode.name=data_${hash}`,
            // For whatever reason you can't bind to IPv4 localhost in a MacOS sandbox but
            // you can bind to IPv6 localhost. See:
            // https://github.com/bazelbuild/bazel/issues/5206#issuecomment-402398624
            "-Enetwork.host=[::1]",
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
                    `-Djna.nosys=true -Djna.debug_load=true -Djna.debug_load.jna=true`,
                ].join(" "),
            },
            stdio: ["ignore", "ignore", "ignore"],
        },
    );

    await waitForProcessSpawn(subprocess);

    // Wait for the DynamoDB local server to start.
    await waitForHttpServer(port);

    return {
        port,
        stop: async () => {
            subprocess.kill();
            await waitForProcessExit(subprocess);
        },
    };
}
