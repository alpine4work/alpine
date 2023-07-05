import pidtree from "pidtree";
import {runProcess} from "~/admin/helpers/run_process.js";
import {DeadlineExceededError, InternalError} from "~/shared/error/error.js";
import {createInterval} from "~/shared/helpers/async/interval.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

const isWindows = process.platform === "win32";

async function forceKillProcess(pid: number) {
    try {
        const command = isWindows
            ? ["taskkill", "/F", "/PID", pid.toString()]
            : ["kill", "-9", pid.toString()];

        await runProcess(command[0]!, command.slice(1));
    } catch (error) {
        throw InternalError.from(error, `Failed to kill process ${pid}`);
    }
}

function isProcessAlive(pid: number) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Forces the process with the provided PID and all child processes to
 * immediately shutdown with a SIGKILL. Does not allow the processes to cleanup
 * (like a SIGTERM would).
 *
 * If the process is not alive then this is a noop.
 */
// Code is adapted from the Remix dev server:
// https://github.com/remix-run/remix/blob/fae7cd1931e21ed1196a1d59bd168cba6898ac78/packages/remix-dev/devServer_unstable/proc.ts
export async function forceKillProcessTree(pid: number) {
    if (!isProcessAlive(pid)) return;

    const pids = [pid, ...(await pidtree(pid))];

    await runAllPromises(pids.map(forceKillProcess));

    return new Promise<void>((resolve, reject) => {
        const interval = createInterval(() => {
            if (!pids.some(isProcessAlive)) {
                interval.clear();
                resolve();
            }
        }, 50);

        setTimeout(() => {
            interval.clear();
            reject(new DeadlineExceededError("Processes did not exit within the specified time"));
        }, 2000);
    });
}
