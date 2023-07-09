import {spawn} from "child_process";
import fs from "fs-extra";
import path from "path";
import {runfilesPath} from "~/admin/helpers/runfiles_path.js";
import {waitForHttpServerOnPort} from "~/admin/helpers/wait_for_http_server_on_port.js";
import {waitForProcessExit} from "~/admin/helpers/wait_for_process_exit.js";
import {waitForProcessSpawn} from "~/admin/helpers/wait_for_process_spawn.js";
import {DeadlineExceededError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";

const javaPathPromise = new Lazy(async () => {
    const javaPathPath = path.join(runfilesPath, "cyberworlds/admin/dynamo/local/java_path.txt");
    const javaPath = (await fs.readFile(javaPathPath, "utf8")).trim();
    assert(javaPath.startsWith("external/"));
    return path.join(runfilesPath, javaPath.slice("external/".length));
});

const dynamoLocalLibPath = path.join(runfilesPath, "dynamo_local/DynamoDBLocal_lib");
const dynamoLocalJarPath = path.join(runfilesPath, "dynamo_local/DynamoDBLocal.jar");

const originalSetTimeout = setTimeout;

export type DynamoLocal = {
    readonly port: number;
    stop(): Promise<void>;
};

/**
 * Start running a [local DynamoDB][1] process with the database persisted to
 * the provided path and listening on the provided port.
 *
 * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html
 */
export async function startDynamoLocal({
    dataPath,
    port,
}: {
    dataPath: string;
    port: number;
}): Promise<DynamoLocal> {
    await fs.ensureDir(dataPath);

    const javaPath = await javaPathPromise.get();
    const subprocess = spawn(
        javaPath,
        [
            `-Djava.library.path=${dynamoLocalLibPath}`,
            "-jar",
            dynamoLocalJarPath,
            "-dbPath",
            dataPath,
            "-port",
            String(port),
        ],
        {
            env: {NODE_ENV: "development"},
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
