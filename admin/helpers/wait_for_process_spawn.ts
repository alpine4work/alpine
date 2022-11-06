import {ChildProcess} from "child_process";

/**
 * Wait for a process spawned by `child_process` to spawn. Rejects if the process
 * errors before it spawns.
 */
export function waitForProcessSpawn(subprocess: ChildProcess): Promise<void> {
    return new Promise((resolve, reject) => {
        subprocess.on("spawn", () => resolve());
        subprocess.on("error", error => reject(error));
    });
}
