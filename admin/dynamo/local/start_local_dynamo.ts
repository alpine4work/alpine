import {spawn} from "child_process";
import fs from "fs-extra";
import path from "path";
import {runfilesPath} from "~/admin/helpers/runfiles_path";
import {waitForProcessExit} from "~/admin/helpers/wait_for_process_exit";
import {waitForProcessSpawn} from "~/admin/helpers/wait_for_process_spawn";
import {DeadlineExceededError} from "~/shared/error/error";
import {Lazy} from "~/shared/helpers/control/lazy";

const javaPathPromise = new Lazy(async () => {
    const javaPathPath = path.join(runfilesPath, "cyberworlds/admin/dynamo/local/java_path.txt");
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

const originalSetTimeout = setTimeout;

export type LocalDynamo = {
    readonly port: number;
    stop(): Promise<void>;
};

/**
 * Start running a [local DynamoDB][1] process with the database persisted to
 * the provided path and listening on the provided port.
 *
 * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html
 */
export async function startLocalDynamo({
    dataPath,
    port,
}: {
    dataPath: string;
    port: number;
}): Promise<LocalDynamo> {
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
    let attemptNumber = 0;
    while (true) {
        attemptNumber++;

        let error;
        try {
            // eslint-disable-next-line no-global-fetch
            const response = await fetch(`http://localhost:${port}`);
            await response.text();
            break;
        } catch (_error) {
            // Ignore errors...
            error = _error;
        }

        // If DynamoDB hasn't started, try checking again with exponential backoff.
        const delayMs = 10 * 2 ** (attemptNumber - 1);

        if (delayMs > 1000 * 20)
            throw DeadlineExceededError.from(
                error,
                `Timed out waiting for local DynamoDB to start listening on port ${port}`,
            );

        // See: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter
        const delayMsWithJitter = Math.floor(Math.random() * delayMs);

        // We can't use `wait()` or `setTimeout()` since Jest will override
        // `setTimeout()` when `jest.useFakeTimers()` is on. But we want to wait the
        // timeout anyway.
        await new Promise(resolve => originalSetTimeout(resolve, delayMsWithJitter));
    }

    return {
        port,
        stop: async () => {
            subprocess.kill();
            await waitForProcessExit(subprocess);
        },
    };
}
