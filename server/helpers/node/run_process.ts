import {ChildProcessByStdio, spawn} from "child_process";
import path from "path";
import {Readable as ReadableStream, Writable as WritableStream} from "stream";
import {getWorkspacePath} from "~/server/helpers/node/workspace_path.js";
import {UnknownError} from "~/shared/error/error.js";
import {isNonNullableOrFalse} from "~/shared/helpers/control/is_non_nullable_or_false.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {quote} from "~/shared/helpers/string/quote.js";

export type ProcessArgs = Array<string | undefined | null | false | ProcessArgs>;

/**
 * Convenient function for running a process to completion. Throws if the process
 * exits with a non-zero exit code. Returns stdout as a string if the process was
 * successful.
 *
 * Executes the process in a predictable, reproducible, environment. By default,
 * executes in the repository root with no `PATH`.
 *
 * Swallows all of the process logs.
 */
export async function runProcess(
    command: string,
    args: ProcessArgs,
    {
        cwd = getWorkspacePath(),
        env,
        stdin,
        signal,
        isErrorExitCode = exitCode => exitCode !== 0,
        withOutputInErrorMessage = process.env.NODE_ENV !== "production",
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
        stdin?: string | Uint8Array | Buffer | ReadableStream;

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
         * Should we include stdout and stderr in the error message?
         *
         * True by default in development and test environments. False in production since
         * error messages are included in logging and the command's output might contain
         * sensitive data we can't send to our logging providers.
         *
         * If you're certain the command won't include sensitive data you may set this to
         * true for better debugging.
         */
        withOutputInErrorMessage?: boolean;

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
        onStdoutData?: (string: string, chunk: Buffer, fullString: string) => void;

        /**
         * Called when the process emits some data to stderr. Allows you to inspect the
         * data and perform any additional processing.
         */
        onStderrData?: (string: string, chunk: Buffer, fullString: string) => void;
    } = {},
): Promise<string> {
    const flattenedArgs: Array<string | undefined | null | false> =
        // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
        // @ts-ignore: I suspect this is a TypeScript bug?
        args.flat(Infinity);

    const subprocess = spawn(command, flattenedArgs.filter(isNonNullableOrFalse), {
        cwd,
        env: {...getProcessEnvToPropagate(), ...env},
        stdio: [stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
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

    let stdout = "";
    let stderr = "";

    subprocess.stdout.on("data", (chunk: Buffer) => {
        const string = chunk.toString("utf8");
        stdout += string;
        onStdoutData?.(string, chunk, stdout);
    });

    subprocess.stderr.on("data", (chunk: Buffer) => {
        const string = chunk.toString("utf8");
        stderr += string;
        onStderrData?.(string, chunk, stderr);
    });

    await new Promise<void>((resolve, reject) => {
        const nameMessage = quote(path.basename(subprocess.spawnfile));
        let finished = false;

        subprocess.on("exit", (exitCode, signal) => {
            if (finished) return;
            finished = true;

            const outputMessage = withOutputInErrorMessage
                ? `\n\nstdout:\n${stdout.trim()}\n\nstderr:\n${stderr.trim()}`
                : "";

            if (typeof exitCode === "number") {
                if (isErrorExitCode(exitCode)) {
                    reject(
                        new UnknownError(
                            `Process exited with code ${exitCode} (${nameMessage})${outputMessage}`,
                            {cause: {exitCode}},
                        ),
                    );
                } else {
                    resolve();
                }
            } else {
                const signalMessage = signal !== null ? quote(signal) : "null";
                reject(
                    new UnknownError(
                        `Process exited from signal ${signalMessage} (${nameMessage})${outputMessage}`,
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

        subprocess.stdout.on("error", error => {
            if (finished) return;
            finished = true;

            reject(error);
        });

        subprocess.stderr.on("error", error => {
            if (finished) return;
            finished = true;

            reject(error);
        });
    });

    return stdout;
}

/**
 * Is this an error thrown by `runProcess()` when the process exits with a non-zero
 * exit code? If you expect a non-zero exit code from `runProcess()` you can use
 * this to handle that error.
 *
 * When `runProcess()` exits with a non-zero exit code the error has a plain cause
 * object with the `exitCode` property.
 */
export function isProcessExitErrorWithCode(error: unknown, exitCode: number): boolean {
    if (isObject(error) && error.exitCode === exitCode) return true;

    // Recurse into error cause if it exists.
    if (error instanceof Error && error.cause)
        return isProcessExitErrorWithCode(error.cause, exitCode);

    return false;
}

/**
 * Gets a subset of `process.env` that we want to propagate to child processes.
 */
export function getProcessEnvToPropagate() {
    const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        NODE_ENV: process.env.NODE_ENV,
        RUNFILES: process.env.RUNFILES,
        BUILD_WORKSPACE_DIRECTORY: process.env.BUILD_WORKSPACE_DIRECTORY,
        BAZEL_BINDIR: process.env.BAZEL_BINDIR,
    };

    for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith("JS_BINARY__")) env[key] = value;
    }

    return env;
}
