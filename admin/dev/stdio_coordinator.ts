import chalk from "chalk";
import {ChildProcess, ChildProcessByStdio, SpawnOptionsWithoutStdio, spawn} from "child_process";
import {Readable} from "stream";
import stripAnsi from "strip-ansi";
import {WriteStream} from "tty";
import {waitForProcessExit} from "~/admin/helpers/wait_for_process_exit.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";

const blockingStdioSubprocesses: Array<() => Promise<void>> = [];
let coordinatedStdioBufferedChunks: Array<{
    where: "stdout" | "stderr";
    chunk: Buffer;
    stdioPrefix: string | null;
}> = [];

const clearScreenControlSequence = Buffer.from("\x1Bc");

/**
 * Remove escape sequences from stdio chunk that conflict with what's printed
 * by other processes. Notably remove the clear screen escape sequence.
 */
function transformChunk(chunk: Buffer) {
    while (true) {
        const index = chunk.indexOf(clearScreenControlSequence);
        if (index === -1) return chunk;

        const chunkStart = Uint8Array.prototype.slice.call(chunk, 0, index);
        const chunkEnd = Uint8Array.prototype.slice.call(
            chunk,
            index + clearScreenControlSequence.length,
        );

        const newChunk = new Uint8Array(chunkStart.length + chunkEnd.length);
        newChunk.set(chunkStart);
        newChunk.set(chunkEnd, chunkStart.length);

        // Keep removing escape control sequence until there are none left.
        chunk = Buffer.from(newChunk);
    }
}

/**
 * Same as `child_process`'s `spawn()` function where `stdio` is set to
 * `["ignore", "inherit", "inherit"]` but has exclusive access to print to our
 * process's `stdout` and `stderr`. Any processes spawned with
 * `spawnWithCoordinatedStdio()` must wait for this process to complete before
 * they can print.
 *
 * If another blocking process is running then this process will start running
 * but its output will not be written until the last blocking process
 * completes.
 */
export function spawnWithBlockingStdio(
    command: string,
    args?: ReadonlyArray<string>,
    options?: SpawnOptionsWithoutStdio & {
        /**
         * Callback for when our process has started blocking stdio. Useful if you want
         * to print anything before our process.
         */
        onStdioBlocked?: () => void;
    },
): ChildProcessByStdio<null, Readable, Readable> {
    const subprocess = spawn(command, args ?? [], {
        ...options,
        stdio: ["ignore", "pipe", "pipe"],
    });

    let isBuffering = true;
    let bufferedChunks: Array<{where: "stdout" | "stderr"; chunk: Buffer}> = [];

    subprocess.stdout.on("data", (chunk: Buffer) => {
        chunk = transformChunk(chunk);

        if (isBuffering) {
            bufferedChunks.push({where: "stdout", chunk});
        } else {
            writeWithStdioPrefix(process.stdout, chunk, null);
        }
    });

    subprocess.stderr.on("data", (chunk: Buffer) => {
        chunk = transformChunk(chunk);

        if (isBuffering) {
            bufferedChunks.push({where: "stderr", chunk});
        } else {
            writeWithStdioPrefix(process.stderr, chunk, null);
        }
    });

    blockingStdioSubprocesses.push(async () => {
        options?.onStdioBlocked?.();

        for (const {where, chunk} of bufferedChunks) {
            if (where === "stdout") {
                writeWithStdioPrefix(process.stdout, chunk, null);
            } else {
                writeWithStdioPrefix(process.stderr, chunk, null);
            }
        }

        bufferedChunks = [];
        isBuffering = false;

        // Hold the lock until our process finishes...
        await waitForProcessExit(subprocess);
    });

    // The first blocking stdio subprocess should start our blocking subprocess
    // coordinator loop.
    if (blockingStdioSubprocesses.length === 1) {
        runPromiseWithoutAwaiting(async () => {
            while (blockingStdioSubprocesses.length > 0) {
                const block = blockingStdioSubprocesses[0]!;
                try {
                    await block();
                } catch {
                    // Do nothing...
                }
                blockingStdioSubprocesses.shift();
            }

            // Once all blocking processes have finished, write buffered coordinated
            // stdio chunks.
            for (const {where, chunk, stdioPrefix} of coordinatedStdioBufferedChunks) {
                if (where === "stdout") {
                    writeWithStdioPrefix(process.stdout, chunk, stdioPrefix);
                } else {
                    writeWithStdioPrefix(process.stderr, chunk, stdioPrefix);
                }
            }

            coordinatedStdioBufferedChunks = [];
        });
    }

    return subprocess;
}

/**
 * Same as `child_process`'s `spawn()` function where `stdio` is set to
 * `["ignore", "inherit", "inherit"]` but will not print to our process's
 * `stdout` and `stderr` until all `spawnWithBlockingStdio()` have finished.
 */
export function spawnWithCoordinatedStdio(
    command: string,
    args?: ReadonlyArray<string>,
    options?: SpawnOptionsWithoutStdio & {stdioPrefix?: string},
): ChildProcess {
    const stdioPrefix = options?.stdioPrefix ?? null;

    const subprocess = spawn(command, args ?? [], {
        ...options,
        stdio: ["ignore", "pipe", "pipe"],
    });

    subprocess.stdout.on("data", (chunk: Buffer) => {
        chunk = transformChunk(chunk);

        if (blockingStdioSubprocesses.length > 0) {
            coordinatedStdioBufferedChunks.push({where: "stdout", chunk, stdioPrefix});
        } else {
            writeWithStdioPrefix(process.stdout, chunk, stdioPrefix);
        }
    });

    subprocess.stderr.on("data", (chunk: Buffer) => {
        chunk = transformChunk(chunk);

        if (blockingStdioSubprocesses.length > 0) {
            coordinatedStdioBufferedChunks.push({where: "stderr", chunk, stdioPrefix});
        } else {
            writeWithStdioPrefix(process.stderr, chunk, stdioPrefix);
        }
    });

    return subprocess;
}

/**
 * Write a message to our coordinated stdout. If there is a blocking process
 * then we will wait for it to complete before printing.
 */
export function writeToCoordinatedStdout(chunk: string) {
    if (blockingStdioSubprocesses.length > 0) {
        coordinatedStdioBufferedChunks.push({
            where: "stdout",
            chunk: Buffer.from(chunk),
            stdioPrefix: null,
        });
    } else {
        writeWithStdioPrefix(process.stdout, chunk, null);
    }
}

let previousWritePrefix: string | null = null;
let wasPreviousWriteEndedWithNewline: boolean | (() => boolean) = true;

/**
 * Write directly to stdout or stderr with a prefix. If the previous write was
 * with a prefix then it needs to be ended with a newline.
 */
export function writeWithStdioPrefix(
    stream: WriteStream,
    chunk: Buffer | string,
    prefix: string | null,
) {
    // If our last write had a different prefix then this write should always start
    // on a newline so it's not on a line with the wrong prefix.
    if (
        prefix !== previousWritePrefix &&
        !(typeof wasPreviousWriteEndedWithNewline === "function"
            ? wasPreviousWriteEndedWithNewline()
            : wasPreviousWriteEndedWithNewline)
    ) {
        stream.write("\n");
    }

    if (prefix === null) {
        if (chunk.length > 0) {
            stream.write(chunk);

            previousWritePrefix = prefix;

            const lastWasPreviousWriteEndedWithNewline = wasPreviousWriteEndedWithNewline;
            wasPreviousWriteEndedWithNewline = () => {
                // ANSI escape codes have no width in the terminal, so we need to skip them
                // when determining whether our last chunk ends in a newline.
                const chunkString = stripAnsi(chunk.toString());

                // If after stripping ansi codes the chunk is still empty then use the function
                // from our previous chunk.
                if (chunkString.length === 0) {
                    return typeof lastWasPreviousWriteEndedWithNewline === "function"
                        ? lastWasPreviousWriteEndedWithNewline()
                        : lastWasPreviousWriteEndedWithNewline;
                }

                return chunkString[chunkString.length - 1] === "\n";
            };
        }
    } else {
        const chunkLines = chunk.toString().split("\n");

        if (chunkLines.length > 0) {
            // If the last write was from the same prefix and didn't end with a newline
            // then continue writing on the same line.
            if (
                prefix === previousWritePrefix &&
                !(typeof wasPreviousWriteEndedWithNewline === "function"
                    ? wasPreviousWriteEndedWithNewline()
                    : wasPreviousWriteEndedWithNewline)
            ) {
                stream.write(chunkLines[0]!);
            } else {
                stream.write(`${chalk.dim(`[${prefix}]`)} ${chunkLines[0]!}`);
            }

            previousWritePrefix = prefix;
            wasPreviousWriteEndedWithNewline = false;

            for (let i = 1; i < chunkLines.length; i++) {
                const chunkLine = chunkLines[i]!;

                // If this chunk ends with a newline then the next chunk may have any prefix on
                // the new line.
                if (i === chunkLines.length - 1 && chunkLine === "") {
                    stream.write("\n");
                    wasPreviousWriteEndedWithNewline = true;
                    break;
                }

                stream.write(`\n${chalk.dim(`[${prefix}]`)} ${chunkLine}`);
            }
        }
    }
}
