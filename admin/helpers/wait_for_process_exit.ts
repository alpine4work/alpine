import {ChildProcess} from "child_process";
import path from "path";
import {UnknownError} from "~/shared/error/error";
import {quote} from "~/shared/helpers/string/quote";

/**
 * Wait for a process spawned by `child_process` to exit. Rejects if the process
 * exits any way besides a 0 exit code.
 */
export function waitForProcessExit(subprocess: ChildProcess): Promise<void> {
    return new Promise((resolve, reject) => {
        const name = path.basename(subprocess.spawnfile);
        let finished = false;

        subprocess.on("exit", (code, signal) => {
            if (finished) return;
            finished = true;

            if (code === 0) {
                resolve();
            } else if (typeof code === "number") {
                reject(new UnknownError(quote`Process exited with code ${code} (${name})`));
            } else {
                reject(new UnknownError(quote`Process exited by signal ${signal} (${name})`));
            }
        });

        subprocess.on("error", error => {
            if (finished) return;
            finished = true;

            reject(error);
        });
    });
}
