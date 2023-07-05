import {ChildProcess, SpawnOptionsWithoutStdio, spawn} from "child_process";
import {waitForProcessExit} from "~/admin/helpers/wait_for_process_exit.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";

const blockingStdioSubprocesses: Array<() => Promise<void>> = [];
let coordinatedStdioBufferedChunks: Array<{where: "stdout" | "stderr"; chunk: Buffer}> = [];

const clearScreenControlSequence = Buffer.from("\x1Bc");

/**
 * Remove escape sequences from stdio chunk that conflict with what's printed
 * by other processes. Notably remove the clear screen escape sequence.
 */
function transformChunk(chunk: Buffer) {
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

    return Buffer.from(newChunk);
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
    options?: SpawnOptionsWithoutStdio,
): ChildProcess {
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
            process.stdout.write(chunk);
        }
    });

    subprocess.stderr.on("data", (chunk: Buffer) => {
        chunk = transformChunk(chunk);

        if (isBuffering) {
            bufferedChunks.push({where: "stderr", chunk});
        } else {
            process.stderr.write(chunk);
        }
    });

    blockingStdioSubprocesses.push(async () => {
        for (const {where, chunk} of bufferedChunks) {
            if (where === "stdout") {
                process.stdout.write(chunk);
            } else {
                process.stderr.write(chunk);
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
                const block = blockingStdioSubprocesses.shift()!;
                await block();
            }

            // Once all blocking processes have finished, write buffered coordinated
            // stdio chunks.
            for (const {where, chunk} of coordinatedStdioBufferedChunks) {
                if (where === "stdout") {
                    process.stdout.write(chunk);
                } else {
                    process.stderr.write(chunk);
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
    options?: SpawnOptionsWithoutStdio,
): ChildProcess {
    const subprocess = spawn(command, args ?? [], {
        ...options,
        stdio: ["ignore", "pipe", "pipe"],
    });

    subprocess.stdout.on("data", (chunk: Buffer) => {
        chunk = transformChunk(chunk);

        if (blockingStdioSubprocesses.length > 0) {
            coordinatedStdioBufferedChunks.push({where: "stdout", chunk});
        } else {
            process.stdout.write(chunk);
        }
    });

    subprocess.stderr.on("data", (chunk: Buffer) => {
        chunk = transformChunk(chunk);

        if (blockingStdioSubprocesses.length > 0) {
            coordinatedStdioBufferedChunks.push({where: "stderr", chunk});
        } else {
            process.stderr.write(chunk);
        }
    });

    return subprocess;
}
