import {spawn} from "child_process";
import fs from "fs-extra";
import isPortReachable from "is-port-reachable";
import path from "path";
import {runfilesPath} from "~/admin/helpers/runfiles_path";
import {waitForProcessExit} from "~/admin/helpers/wait_for_process_exit";
import {waitForProcessSpawn} from "~/admin/helpers/wait_for_process_spawn";
import {InternalError} from "~/shared/error/error";
import {wait} from "~/shared/helpers/async/wait";
import {Lazy} from "~/shared/helpers/control/lazy";

const javaPathPromise = new Lazy(async () => {
    const javaPathPath = path.join(runfilesPath, "cyberworlds/admin/dynamo/java_path.txt");
    const javaPath = (await fs.readFile(javaPathPath, "utf8")).trim();
    return path.join(runfilesPath, "cyberworlds", javaPath);
});

const dynamoLocalLibPath = path.join(
    runfilesPath,
    "cyberworlds/external/dynamo_local/DynamoDBLocal_lib",
);
const dynamoLocalJarPath = path.join(
    runfilesPath,
    "cyberworlds/external/dynamo_local/DynamoDBLocal.jar",
);

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
}): Promise<{stop: () => Promise<void>}> {
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
            env: {},
            stdio: ["ignore", "ignore", "ignore"],
        },
    );

    await waitForProcessSpawn(subprocess);

    // Wait for the DynamoDB local server to start.
    let remainingAttempts = 10;
    while (true) {
        if (await isPortReachable(port, {host: "localhost"})) break;

        remainingAttempts--;
        if (remainingAttempts === 0) {
            subprocess.kill();
            throw new InternalError(
                `Timed out waiting for local DynamoDB to start listening on port ${port}`,
            );
        }

        await wait(100);
    }

    return {
        stop: async () => {
            subprocess.kill();
            await waitForProcessExit(subprocess);
        },
    };
}
