import {spawn} from "child_process";
import fs from "fs-extra";
import path from "path";
import lockfile from "proper-lockfile";
import treeKill from "tree-kill";
import {devEnvPaths} from "~/admin/helpers/dev_env_paths";
import {runfilesPath} from "~/admin/helpers/runfiles_path";
import {waitForProcessSpawn} from "~/admin/helpers/wait_for_process_spawn";
import {assert} from "~/shared/helpers/control/assert";

const localstackPath = path.join(devEnvPaths.data, "localstack");
const localstackPidPath = path.join(localstackPath, "localstack.pid");

/**
 * Path where we write our logs for LocalStack.
 */
export const localstackLogPath = path.join(localstackPath, "localstack.log");

const localstackBackgroundExecutablePath = path.join(
    runfilesPath,
    "cyberworlds/admin/aws/localstack/background/background.sh",
);

/**
 * Start LocalStack in a background process if it is not already running.
 */
export async function startLocalstack(): Promise<{started: boolean}> {
    return withLocalstackPidPathLock(async () => {
        // If Localstack is already started then we don't need to start it now.
        const localstackPidContents = (await fs.readFile(localstackPidPath, "utf8")).trim();
        if (localstackPidContents !== "") {
            const localstackPid = parseInt(localstackPidContents, 10);
            assert(Number.isInteger(localstackPid));

            // If the LocalStack process is already running then don't spawn
            // LocalStack again.
            if (isProcessRunning(localstackPid)) return {started: false};
        }

        const localstackLogFileDescriptor = fs.openSync(localstackLogPath, "a");

        const subprocess = spawn(localstackBackgroundExecutablePath, [], {
            detached: true,
            stdio: ["ignore", localstackLogFileDescriptor, localstackLogFileDescriptor],
        });

        await waitForProcessSpawn(subprocess);

        assert(subprocess.pid);
        await fs.writeFile(localstackPidPath, `${subprocess.pid}\n`);

        subprocess.unref();

        return {started: true};
    });
}

/**
 * If LocalStack is running, then kill it.
 */
export async function stopLocalstack(): Promise<{stopped: boolean}> {
    return withLocalstackPidPathLock(async () => {
        // If LocalStack is already stopped then we don't need to stop it again.
        const localstackPidContents = (await fs.readFile(localstackPidPath, "utf8")).trim();
        if (localstackPidContents === "") return {stopped: false};

        const localstackPid = parseInt(localstackPidContents, 10);
        assert(Number.isInteger(localstackPid));

        try {
            treeKill(localstackPid);
        } catch (error) {
            // Process was already killed. Ignore this error.
            if ((error as any).code === "ESRCH") return {stopped: false};
            throw error;
        }

        await fs.writeFile(localstackPidPath, "\n");

        return {stopped: true};
    });
}

function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if ((error as any).code === "ESRCH") return false;
        throw error;
    }
}

async function withLocalstackPidPathLock<Value>(action: () => Promise<Value>): Promise<Value> {
    await fs.mkdirp(localstackPath);

    // Create the PID file if it does not already exist.
    if (!(await fs.pathExists(localstackPidPath))) {
        await fs.writeFile(localstackPidPath, "");
    }

    const release = await lockfile.lock(localstackPidPath);
    try {
        const value = await action();
        return value;
    } finally {
        await release();
    }
}
