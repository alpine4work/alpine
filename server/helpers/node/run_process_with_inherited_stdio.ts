import {ChildProcessByStdio, spawn} from "child_process";
import path from "path";
import {Readable as ReadableStream, Writable as WritableStream} from "stream";
import {ProcessArgs, getProcessEnvToPropagate} from "~/server/helpers/node/run_process.js";
import {getWorkspacePath} from "~/server/helpers/node/workspace_path.js";
import {UnknownError} from "~/shared/error/error.open_source.js";
import {isNonNullableOrFalse} from "~/shared/helpers/control/is_non_nullable_or_false.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

/**
 * Convenient function for running a process to completion. Throws if the process
 * exits with a non-zero exit code. Prints stdout and stderr to the current
 * process's stdout/stderr.
 *
 * Executes the process in a predictable, reproducible, environment. By default,
 * executes in the repository root with no `PATH`.
 *
 * Swallows all of the process logs.
 */
export async function runProcessWithInheritedStdio(
    command: string,
    args: ProcessArgs,
    {
        cwd = getWorkspacePath(),
        env,
        stdin,
        signal,
        isErrorExitCode = exitCode => exitCode !== 0,
        onStdinError,
        onStdoutData,
        onStderrData,
    }: {
        /**
         * What directory should the process run in? By default runs in the root directory
         * of our code repository.
         */
        cwd?: string;

        /**
         * Extra environment variables to set when running the subprocess.
         */
        env?: {[key: string]: string | undefined};

        /**
         * Data to pipe into stdin.
         */
        stdin?: string | Uint8Array | ReadableStream;

        /**
         * Allows aborting the child process.
         */
        signal?: AbortSignal;

        /**
         * Should we throw an error for the provided exit code? By default any non-zero
         * exit code is an error.
         */
        isErrorExitCode?: (exitCode: number) => boolean;

        /**
         * If an error is emitted from our stdin stream you can handle it with this
         * function. If you return `{preventDefault: true}` then we won't reject the
         * `runProcess()` promise.
         */
        onStdinError?: (error: unknown) => {preventDefault: boolean} | void;

        /**
         * Called when the process emits some data to stdout. Allows you to inspect the
         * data and perform any additional processing.
         */
        onStdoutData?: (chunk: Uint8Array) => void;

        /**
         * Called when the process emits some data to stderr. Allows you to inspect the
         * data and perform any additional processing.
         */
        onStderrData?: (chunk: Uint8Array) => void;
    } = {},
): Promise<void> {
    const flattenedArgs: Array<string | undefined | null | false> =
        // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
        // @ts-ignore: I suspect this is a TypeScript bug?
        args.flat(Infinity);

    const subprocess = spawn(command, flattenedArgs.filter(isNonNullableOrFalse), {
        cwd,
        env: {...getProcessEnvToPropagate(), ...env},
        stdio: [
            stdin !== undefined ? "pipe" : "ignore",
            onStdoutData ? "pipe" : "inherit",
            onStderrData ? "pipe" : "inherit",
        ],
        signal,
    }) as ChildProcessByStdio<WritableStream | null, ReadableStream, ReadableStream>;

    if (stdin !== undefined) {
        if (stdin instanceof ReadableStream) {
            stdin.pipe(subprocess.stdin!);
        } else {
            subprocess.stdin!.write(stdin);
            subprocess.stdin!.end();
        }
    }

    if (onStdoutData) {
        subprocess.stdout.on("data", (chunk: Uint8Array) => {
            process.stdout.write(chunk);
            onStdoutData(chunk);
        });
    }

    if (onStderrData) {
        subprocess.stderr.on("data", (chunk: Uint8Array) => {
            process.stderr.write(chunk);
            onStderrData(chunk);
        });
    }

    await new Promise<void>((resolve, reject) => {
        const nameMessage = quote(path.basename(subprocess.spawnfile));
        let finished = false;

        subprocess.on("exit", (exitCode, signal) => {
            if (finished) return;
            finished = true;

            if (typeof exitCode === "number") {
                if (isErrorExitCode(exitCode)) {
                    reject(
                        new UnknownError(`Process exited with code ${exitCode} (${nameMessage})`, {
                            cause: {exitCode},
                        }),
                    );
                } else {
                    resolve();
                }
            } else {
                const signalMessage = signal !== null ? quote(signal) : "null";
                reject(
                    new UnknownError(
                        `Process exited from signal ${signalMessage} (${nameMessage})`,
                    ),
                );
            }
        });

        subprocess.on("error", error => {
            if (finished) return;
            finished = true;

            reject(error);
        });

        subprocess.stdin?.on("error", error => {
            const result = onStdinError?.(error);
            if (result?.preventDefault) return;

            if (finished) return;
            finished = true;

            reject(error);
        });

        if (onStdoutData) {
            subprocess.stdout.on("error", error => {
                if (finished) return;
                finished = true;

                reject(error);
            });
        }

        if (onStderrData) {
            subprocess.stderr.on("error", error => {
                if (finished) return;
                finished = true;

                reject(error);
            });
        }
    });
}
