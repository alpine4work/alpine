import {spawn} from "child_process";
import path from "path";
import {getWorkspacePath} from "~/server/helpers/node/workspace_path.js";
import {UnknownError} from "~/shared/error/error.js";
import {isNonNullableOrFalse} from "~/shared/helpers/control/is_non_nullable_or_false.js";
import {quote} from "~/shared/helpers/string/quote.js";

type ProcessArgs = Array<string | undefined | null | false | ProcessArgs>;

/**
 * Convenient function for running a process to completion. Throws if the
 * process exits with a non-zero exit code. Returns stdout as a string if the
 * process was successful.
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
        isErrorExitCode = exitCode => exitCode !== 0,
    }: {
        /**
         * What directory should the process run in? By default runs in the root
         * directory of our code repository.
         */
        cwd?: string;

        /**
         * Extra environment variables to set when running the subprocess.
         */
        env?: {[key: string]: string | undefined};

        /**
         * Should we throw an error for the provided exit code? By default any non-zero
         * exit code is an error.
         */
        isErrorExitCode?: (exitCode: number) => boolean;
    } = {},
): Promise<string> {
    const flattenedArgs: Array<string | undefined | null | false> =
        // @ts-expect-error: I suspect this is a TypeScript bug?
        args.flat(Infinity);

    const subprocess = spawn(command, flattenedArgs.filter(isNonNullableOrFalse), {
        cwd,
        env: {...getProcessEnvToPropagate(), ...env},
        stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    subprocess.stdout.on("data", (chunk: Buffer) => {
        const string = chunk.toString("utf8");
        stdout += string;
    });

    subprocess.stderr.on("data", (chunk: Buffer) => {
        const string = chunk.toString("utf8");
        stderr += string;
    });

    await new Promise<void>((resolve, reject) => {
        const nameMessage = quote(path.basename(subprocess.spawnfile));
        let finished = false;

        subprocess.on("exit", (exitCode, signal) => {
            if (finished) return;
            finished = true;

            const stderrMessage =
                // stdout/stderr is not included in production since it may have sensitive
                // data.
                process.env.NODE_ENV === "production"
                    ? ""
                    : ` (stdout and stderr included for debugging)\n\nstdout:\n${stdout.trim()}\n\nstderr:\n${stderr.trim()}`;

            if (typeof exitCode === "number") {
                if (isErrorExitCode(exitCode)) {
                    reject(
                        new UnknownError(
                            `${nameMessage} process exited with code ${exitCode}${stderrMessage}`,
                        ),
                    );
                } else {
                    resolve();
                }
            } else {
                const signalMessage = signal !== null ? quote(signal) : "null";
                reject(
                    new UnknownError(
                        `${nameMessage} process exited by signal ${signalMessage}${stderrMessage}`,
                    ),
                );
            }
        });

        subprocess.on("error", error => {
            if (finished) return;
            finished = true;

            reject(error);
        });
    });

    return stdout;
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
