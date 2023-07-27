import {spawn} from "child_process";
import fs from "fs-extra";
import {join as joinPath} from "path";
import {runfilesPath} from "~/admin/helpers/runfiles_path.js";
import {waitForHttpServerOnPort} from "~/admin/helpers/wait_for_http_server_on_port.js";
import {waitForProcessExit} from "~/admin/helpers/wait_for_process_exit.js";
import {waitForProcessSpawn} from "~/admin/helpers/wait_for_process_spawn.js";
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

export type DynamoLocal = {
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
}): Promise<DynamoLocal> {
    const [, , javaBasePath] = await runAllPromises([
        fs.ensureDir(dataPath),
        fs.ensureDir(logsPath),
        javaBasePathPromise.get(),
    ]);

    const subprocess = spawn(
        opensearchLocalBinPath,
        [`-Ehttp.port=${port}`, `-Epath.data=${dataPath}`, `-Epath.logs=${logsPath}`],
        {
            env: {
                NODE_ENV: "development",
                JAVA_HOME: javaBasePath,
            },
            stdio: ["ignore", "ignore", "ignore"],
        },
    );

    await waitForProcessSpawn(subprocess);

    // Wait for the DynamoDB local server to start.
    await waitForHttpServerOnPort(port);

    return {
        port,
        stop: async () => {
            subprocess.kill();
            await waitForProcessExit(subprocess);
        },
    };
}
