import {spawn} from "child_process";
import fs from "fs-extra";
import {join as joinPath} from "path";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForHttpServer} from "~/server/helpers/node/wait_for_http_server.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {waitForProcessSpawn} from "~/server/helpers/node/wait_for_process_spawn.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {Lazy} from "~/shared/helpers/control/lazy.open_source.js";

const javaPathPromise = new Lazy(async () => {
    const javaPathPath = joinPath(runfilesPath, "cyberworlds/admin/dynamo/local/java_path.txt");
    const javaPath = (await fs.readFile(javaPathPath, "utf8")).trim();
    assert(javaPath.startsWith("external/"));
    return joinPath(runfilesPath, javaPath.slice("external/".length));
});

const dynamoLocalLibPath = joinPath(runfilesPath, "dynamo_local/DynamoDBLocal_lib");
const dynamoLocalJarPath = joinPath(runfilesPath, "dynamo_local/DynamoDBLocal.jar");

export type DynamoLocal = {
    readonly port: number;
    readonly logsPath: string;
    stop(): Promise<void>;
};

/**
 * Start running a [local DynamoDB][1] process with the database persisted to the
 * provided path and listening on the provided port.
 *
 * [1]:
 *     https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html
 */
export async function startDynamoLocal({
    dataPath,
    logsPath,
    port,
}: {
    logsPath: string;
    port: number;
} & (
    | {
          dataPath: string;
          withInMemoryData?: undefined;
      }
    | {
          withInMemoryData: true;
          dataPath?: undefined;
      }
)): Promise<DynamoLocal> {
    const [, logFileDescriptor, javaPath] = await runAllPromises([
        dataPath !== undefined ? fs.ensureDir(dataPath) : undefined,
        fs.ensureDir(logsPath).then(() => fs.open(joinPath(logsPath, "dynamo.log"), "a")),
        javaPathPromise.get(),
    ]);

    const subprocess = spawn(
        javaPath,
        [
            `-Djava.library.path=${dynamoLocalLibPath}`,
            "-jar",
            dynamoLocalJarPath,
            ...(dataPath !== undefined ? ["-dbPath", dataPath] : ["-inMemory"]),
            "-port",
            String(port),
        ],
        {
            env: {NODE_ENV: "development"},
            stdio: ["ignore", logFileDescriptor, logFileDescriptor],
        },
    );

    await waitForProcessSpawn(subprocess);

    // Wait for the DynamoDB local server to start.
    await waitForHttpServer(port);

    return {
        logsPath,
        port,
        stop: async () => {
            try {
                subprocess.kill();
                await waitForProcessExit(subprocess);
            } finally {
                await fs.close(logFileDescriptor);
            }
        },
    };
}
