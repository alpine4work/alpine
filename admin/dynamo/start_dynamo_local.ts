import {spawn} from "child_process";
import fs from "fs-extra";
import path from "path";
import {runfilesPath} from "~/admin/helpers/runfiles_path";
import {waitForProcessExit} from "~/admin/helpers/wait_for_process_exit";
import {waitForProcessSpawn} from "~/admin/helpers/wait_for_process_spawn";
import {InternalError} from "~/shared/error/error";

const dynamoLocalExecutablePath = path.join(runfilesPath, "cyberworlds/admin/dynamo/dynamo_local");

/**
 * Start running a [local DynamoDB][1] process with the database persisted to
 * the provided path and listening on the provided port.
 *
 * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html
 */
export async function startDynamoLocal({
    directoryPath,
    port,
    onError,
}: {
    directoryPath: string;
    port: number;
    onError: (error: unknown) => void;
}): Promise<{stop: () => Promise<void>}> {
    await fs.ensureDir(directoryPath);

    const subprocess = spawn(
        dynamoLocalExecutablePath,
        ["-dbPath", directoryPath, "-port", String(port)],
        {
            cwd: directoryPath,
            env: {PATH: process.env.PATH},
            stdio: ["ignore", "ignore", "ignore"],
        },
    );

    await waitForProcessSpawn(subprocess);

    let hasStopped = false;
    const exitPromise = waitForProcessExit(subprocess);

    exitPromise.then(
        () => {
            if (!hasStopped) {
                onError(new InternalError("DynamoDB local exited early"));
            }
        },
        error => {
            onError(error);
        },
    );

    return {
        stop: async () => {
            hasStopped = true;
            subprocess.kill();
            await exitPromise;
        },
    };
}
