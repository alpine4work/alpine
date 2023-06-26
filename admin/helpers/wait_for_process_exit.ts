import {ChildProcess} from "child_process";
import path from "path";
import {UnknownError} from "~/shared/error/error.js";
import {quote} from "~/shared/helpers/string/quote.js";

/**
 * Wait for a process spawned by `child_process` to exit. Rejects if the process
 * exits any way besides a 0 exit code.
 */
export function waitForProcessExit(subprocess: ChildProcess): Promise<void> {
    return new Promise((resolve, reject) => {
        const name = path.basename(subprocess.spawnfile);

        // If the process already exited then immediately resolve or reject.
        if (subprocess.killed) {
            resolve();
            return;
        } else if (subprocess.exitCode !== null) {
            if (subprocess.exitCode === 0) {
                resolve();
            } else {
                reject(
                    new UnknownError(
                        quote`Process exited with code ${subprocess.exitCode} (${name})`,
                    ),
                );
            }
            return;
        }

        let finished = false;

        subprocess.on("exit", (exitCode, signal) => {
            if (finished) return;
            finished = true;

            if (exitCode === 0 || subprocess.killed) {
                resolve();
            } else if (typeof exitCode === "number") {
                reject(new UnknownError(quote`Process exited with code ${exitCode} (${name})`));
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
