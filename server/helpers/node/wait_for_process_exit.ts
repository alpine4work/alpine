import {ChildProcess} from "child_process";
import path from "path";
import {UnknownError} from "~/shared/error/error.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

/**
 * Wait for a process spawned by `child_process` to exit. Rejects if the process
 * exits any way besides a 0 exit code.
 */
export function waitForProcessExit(
    subprocess: ChildProcess,
    options?: {onStdinError?: (error: unknown) => {preventDefault: boolean} | void},
): Promise<void> {
    return waitForProcessExitWithAnyCode(subprocess, options).then(({exitCode}) => {
        // If the subprocess was explicitly killed by our code then resolve even if it has
        // a non-zero exit code.
        if (exitCode !== 0 && !subprocess.killed) {
            const name = path.basename(subprocess.spawnfile);
            throw new UnknownError(quote`Process exited with code ${exitCode} (${name})`, {
                cause: {exitCode},
            });
        }
    });
}

/**
 * Wait for a process spawned by `child_process` to exit with any status code. The
 * caller should decide what they want to do with the `exitCode`.
 */
export function waitForProcessExitWithAnyCode(
    subprocess: ChildProcess,
    options?: {onStdinError?: (error: unknown) => {preventDefault: boolean} | void},
): Promise<{exitCode: number}> {
    return new Promise((resolve, reject) => {
        // If the process already exited then immediately resolve or reject.
        if (subprocess.exitCode !== null) {
            resolve({exitCode: subprocess.exitCode});
            return;
        }

        let finished = false;

        subprocess.on("exit", (exitCode, signal) => {
            if (finished) return;
            finished = true;

            if (typeof exitCode === "number") {
                resolve({exitCode});
            } else {
                const name = path.basename(subprocess.spawnfile);
                reject(new UnknownError(quote`Process exited from signal ${signal} (${name})`));
            }
        });

        subprocess.on("error", error => {
            if (finished) return;
            finished = true;

            reject(error);
        });

        subprocess.stdin?.on("error", error => {
            const result = options?.onStdinError?.(error);
            if (result?.preventDefault) return;

            if (finished) return;
            finished = true;

            reject(error);
        });

        subprocess.stdout?.on("error", error => {
            if (finished) return;
            finished = true;

            reject(error);
        });

        subprocess.stderr?.on("error", error => {
            if (finished) return;
            finished = true;

            reject(error);
        });
    });
}
