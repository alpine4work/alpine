import ansiStyles from "ansi-styles";
import chalk from "chalk";
import {ChildProcess, ChildProcessByStdio, SpawnOptionsWithoutStdio, spawn} from "child_process";
import {Readable as ReadableStream, Writable as WritableStream} from "stream";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

type AnsiCode = {
    readonly code: string;
    readonly endCode: string;
};

type ChunkLine = {
    readonly chunks: ReadonlyArray<Buffer>;
    readonly activeCodes: ReadonlyArray<AnsiCode>;
};

const blockingStdioSubprocesses: Array<() => Promise<void>> = [];
let coordinatedStdioBufferedChunks: Array<{
    readonly where: "stdout" | "stderr";
    readonly chunkLines: ReadonlyArray<ChunkLine>;
    readonly stdioPrefix: string | null;
}> = [];

const ansiEscapeBuffer = Buffer.from("\u001b");
assert(ansiEscapeBuffer.length === 1);
const ansiEscapeByte = ansiEscapeBuffer[0]!;

const ansiClearScreenSequence = Buffer.from("\u001bc");
assert(ansiClearScreenSequence.length === 2);
assert(ansiClearScreenSequence[0] === ansiEscapeByte);
const ansiClearScreenSequenceByte2 = ansiClearScreenSequence[1]!;

const digit0Buffer = Buffer.from("0");
assert(digit0Buffer.length === 1);
const digit0Byte = digit0Buffer[0]!;

const digit9Buffer = Buffer.from("9");
assert(digit9Buffer.length === 1);
const digit9Byte = digit9Buffer[0]!;

const leftBracketBuffer = Buffer.from("[");
assert(leftBracketBuffer.length === 1);
const leftBracketByte = leftBracketBuffer[0]!;

const semicolonBuffer = Buffer.from(";");
assert(semicolonBuffer.length === 1);
const semicolonByte = semicolonBuffer[0]!;

const characterMBuffer = Buffer.from("m");
assert(characterMBuffer.length === 1);
const characterMByte = characterMBuffer[0]!;

const newlineBuffer = Buffer.from("\n");
assert(newlineBuffer.length === 1);
const newlineByte = newlineBuffer[0]!;

/**
 * Transforms a chunk to prepare it for printing:
 *
 * 1. Removes any clear ANSI escape sequences, a child process can't clear the
 *    screen.
 * 2. Splits the chunk into individual lines. All `ChunkLine` objects returned
 *    end with a newline except the last `ChunkLine` object.
 * 3. Parses open ANSI color codes on each line so we can correctly
 *    disable/enable them when switching to printing a different process.
 */
function transformChunk(chunk: Buffer): ReadonlyArray<ChunkLine> {
    let offset = 0;
    let index = 0;
    const length = chunk.length;

    const chunkLines: Array<{
        chunks: Array<Buffer>;
        activeCodes: Array<AnsiCode>;
    }> = [{chunks: [], activeCodes: []}];

    while (index < length) {
        const byte = chunk[index]!;

        // Create newline.
        if (byte === newlineByte) {
            const lastChunkLine = chunkLines[chunkLines.length - 1]!;
            lastChunkLine.chunks.push(chunk.subarray(offset, index + 1));
            chunkLines.push({chunks: [], activeCodes: []});

            offset = index + 1;
            index = offset;
            continue;
        }

        // Remove clear screen escape sequences.
        if (
            byte === ansiEscapeByte &&
            index + 1 < chunk.length &&
            chunk[index + 1] === ansiClearScreenSequenceByte2
        ) {
            chunkLines[chunkLines.length - 1]!.chunks.push(chunk.subarray(offset, index));

            offset = index + 2;
            index = offset;
            continue;
        }

        // Derived from `tokenize()` function of `slice-ansi`:
        // https://github.com/chalk/slice-ansi/blob/400a6ca5c23db8e71bf62d9ebf6082796ce5a7c6/index.js#L65-L104
        if (byte === ansiEscapeByte) {
            const code = parseAnsiCode(chunk, index);
            if (code !== null) {
                const codeString = code.toString("utf8");

                chunkLines[chunkLines.length - 1]!.activeCodes.push({
                    code: codeString,
                    endCode: getAnsiEndCode(codeString),
                });

                index += code.length;
                continue;
            }
        }

        index++;
    }

    if (offset !== chunk.length) {
        chunkLines[chunkLines.length - 1]!.chunks.push(chunk.subarray(offset));
    }

    return chunkLines;
}

export function transformChunkForTest(chunk: Buffer): ReadonlyArray<ChunkLine> {
    assert(import.meta.jest);
    return transformChunk(chunk);
}

/**
 * Parses an ANSI color escape code.
 *
 * To implement this we referenced the syntax in "[ANSI Escape Codes][1]."
 *
 * Originally used the same implementation as [`parseAnsiCode()` in
 * `slice-ansi`][2] but that implementation is too generous and parses
 * non-color ANSI escape codes incorrectly.
 *
 * [1]: https://gist.github.com/fnky/458719343aabd01cfb17a3a4f7296797#colors--graphics-mode
 * [2]: https://github.com/chalk/slice-ansi/blob/400a6ca5c23db8e71bf62d9ebf6082796ce5a7c6/index.js#L52-L63
 */
function parseAnsiCode(buffer: Buffer, offset: number): Buffer | null {
    let index = offset + 1;
    let state: "Escape" | "LeftBracket" | "Digit" | "Semicolon" = "Escape";

    while (index < buffer.length) {
        const byte = buffer[index]!;

        switch (state) {
            case "Escape": {
                if (byte === leftBracketByte) {
                    index += 1;
                    state = "LeftBracket";
                    continue;
                } else {
                    return null;
                }
            }
            case "LeftBracket": {
                if (digit0Byte <= byte && byte <= digit9Byte) {
                    index += 1;
                    state = "Digit";
                    continue;
                } else {
                    return null;
                }
            }
            case "Digit": {
                if (digit0Byte <= byte && byte <= digit9Byte) {
                    index += 1;
                    continue;
                } else if (byte === semicolonByte) {
                    index += 1;
                    state = "Semicolon";
                    continue;
                } else if (byte === characterMByte) {
                    index += 1;
                    return buffer.subarray(offset, index);
                } else {
                    return null;
                }
            }
            case "Semicolon": {
                if (digit0Byte <= byte && byte <= digit9Byte) {
                    index += 1;
                    state = "Digit";
                    continue;
                } else {
                    return null;
                }
            }
            default:
                throw exhaustive(state);
        }
    }

    return null;
}

function hasNonAnsiCodes(buffer: Buffer): boolean {
    let index = 0;

    while (index < buffer.length) {
        const byte = buffer[index]!;
        if (byte !== ansiEscapeByte) return true;

        const code = parseAnsiCode(buffer, index);
        if (code === null) return true;

        index += code.length;
    }

    return false;
}

// Derived from:
// https://github.com/chalk/slice-ansi/blob/400a6ca5c23db8e71bf62d9ebf6082796ce5a7c6/index.js#L12-L17
const ansiEndCodesSet = new Set<string>();
const ansiEndCodesMap = new Map<string, string>();
for (const [start, end] of ansiStyles.codes) {
    ansiEndCodesSet.add(ansiStyles.color.ansi(end));
    ansiEndCodesMap.set(ansiStyles.color.ansi(start), ansiStyles.color.ansi(end));
}

// Derived from `getEndCode()` function of `slice-ansi`:
// https://github.com/chalk/slice-ansi/blob/400a6ca5c23db8e71bf62d9ebf6082796ce5a7c6/index.js#L19-L39
function getAnsiEndCode(code: string): string {
    if (ansiEndCodesSet.has(code)) {
        return code;
    }

    const endCode = ansiEndCodesMap.get(code);
    if (endCode !== undefined) {
        return endCode;
    }

    code = code.slice(2);
    if (code.includes(";")) {
        code = code[0] + "0";
    }

    const parsedCode = ansiStyles.codes.get(parseInt(code, 10));
    if (parsedCode) {
        return ansiStyles.color.ansi(parsedCode);
    }

    return ansiStyles.reset.open;
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
        onStdioBlocked?: (writeStdout: (chunk: string) => void) => void;
    },
): ChildProcessByStdio<null, ReadableStream, ReadableStream> {
    const subprocess = spawn(command, args ?? [], {
        ...options,
        stdio: ["ignore", "pipe", "pipe"],
    });

    let isBuffering = true;
    let bufferedChunks: Array<{
        where: "stdout" | "stderr";
        chunkLines: ReadonlyArray<ChunkLine>;
    }> = [];

    subprocess.stdout.on("data", (chunk: Buffer) => {
        const chunkLines = transformChunk(chunk);

        if (isBuffering) {
            bufferedChunks.push({where: "stdout", chunkLines});
        } else {
            writeWithStdioPrefix(process.stdout, chunkLines, null);
        }
    });

    subprocess.stderr.on("data", (chunk: Buffer) => {
        const chunkLines = transformChunk(chunk);

        if (isBuffering) {
            bufferedChunks.push({where: "stderr", chunkLines});
        } else {
            writeWithStdioPrefix(process.stderr, chunkLines, null);
        }
    });

    blockingStdioSubprocesses.push(async () => {
        let canWrite = true;

        options?.onStdioBlocked?.(chunk => {
            assert(canWrite);
            const chunkLines = transformChunk(Buffer.from(chunk));
            writeWithStdioPrefix(process.stdout, chunkLines, null);
        });

        canWrite = false;

        for (const {where, chunkLines} of bufferedChunks) {
            if (where === "stdout") {
                writeWithStdioPrefix(process.stdout, chunkLines, null);
            } else {
                writeWithStdioPrefix(process.stderr, chunkLines, null);
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
            for (const {where, chunkLines, stdioPrefix} of coordinatedStdioBufferedChunks) {
                if (where === "stdout") {
                    writeWithStdioPrefix(process.stdout, chunkLines, stdioPrefix);
                } else {
                    writeWithStdioPrefix(process.stderr, chunkLines, stdioPrefix);
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
        const chunkLines = transformChunk(chunk);

        if (blockingStdioSubprocesses.length > 0) {
            coordinatedStdioBufferedChunks.push({
                where: "stdout",
                chunkLines,
                stdioPrefix,
            });
        } else {
            writeWithStdioPrefix(process.stdout, chunkLines, stdioPrefix);
        }
    });

    subprocess.stderr.on("data", (chunk: Buffer) => {
        const chunkLines = transformChunk(chunk);

        if (blockingStdioSubprocesses.length > 0) {
            coordinatedStdioBufferedChunks.push({
                where: "stderr",
                chunkLines,
                stdioPrefix,
            });
        } else {
            writeWithStdioPrefix(process.stderr, chunkLines, stdioPrefix);
        }
    });

    return subprocess;
}

/**
 * Write a message to our coordinated stdout. If there is a blocking process
 * then we will wait for it to complete before printing.
 */
export function writeToCoordinatedStdout(chunk: string) {
    const chunkLines = transformChunk(Buffer.from(chunk));

    if (blockingStdioSubprocesses.length > 0) {
        coordinatedStdioBufferedChunks.push({
            where: "stdout",
            chunkLines,
            stdioPrefix: null,
        });
    } else {
        writeWithStdioPrefix(process.stdout, chunkLines, null);
    }
}

/**
 * Write a message to our coordinated stderr. If there is a blocking process
 * then we will wait for it to complete before printing.
 */
export function writeToCoordinatedStderr(chunk: string) {
    const chunkLines = transformChunk(Buffer.from(chunk));

    if (blockingStdioSubprocesses.length > 0) {
        coordinatedStdioBufferedChunks.push({
            where: "stderr",
            chunkLines,
            stdioPrefix: null,
        });
    } else {
        writeWithStdioPrefix(process.stderr, chunkLines, null);
    }
}

let previousWritePrefix: string | null = null;
let wasPreviousWriteEndedWithNewline: boolean = true;
const activeCodesByWritePrefix = new Map<string | null, ReadonlyArray<AnsiCode>>();

export function resetWriteWithStdioPrefixForTest() {
    assert(import.meta.jest);
    previousWritePrefix = null;
    wasPreviousWriteEndedWithNewline = true;
    activeCodesByWritePrefix.clear();
}

// Derived from `reduceAnsiCodes()` function of `slice-ansi`.
// https://github.com/chalk/slice-ansi/blob/400a6ca5c23db8e71bf62d9ebf6082796ce5a7c6/index.js#L106-L124
function reduceAnsiCodes(codes: ReadonlyArray<AnsiCode>): ReadonlyArray<AnsiCode> {
    let newCodes: Array<AnsiCode> = [];

    for (const code of codes) {
        if (code.code === ansiStyles.reset.open) {
            // Reset code, disable all codes
            newCodes = [];
        } else if (ansiEndCodesSet.has(code.code)) {
            // This is an end code, disable all matching start codes
            newCodes = newCodes.filter(newCode => newCode.endCode !== code.code);
        } else {
            // This is a start code. Disable all styles this "overrides", then enable it
            newCodes = newCodes.filter(newCode => newCode.endCode !== code.endCode);
            newCodes.push(code);
        }
    }

    return newCodes;
}

function mergeAnsiCodes(
    codes1: ReadonlyArray<AnsiCode>,
    codes2: ReadonlyArray<AnsiCode>,
): ReadonlyArray<AnsiCode> {
    if (codes1.length === 0) return reduceAnsiCodes(codes2);
    if (codes2.length === 0) return reduceAnsiCodes(codes1);

    return reduceAnsiCodes(codes1.concat(codes2));
}

/**
 * Write directly to stdout or stderr with a prefix. If the previous write was
 * with a prefix then it needs to be ended with a newline.
 */
function writeWithStdioPrefix(
    stream: WritableStream,
    chunkLines: ReadonlyArray<ChunkLine>,
    prefix: string | null,
) {
    if (chunkLines.length === 0) return;

    const firstChunkLine = chunkLines[0]!;
    let activeCodes = activeCodesByWritePrefix.get(previousWritePrefix) ?? emptyArray;

    // 1. If we're changing the prefix:
    if (prefix !== previousWritePrefix) {
        // 1.1. Reset styles
        for (let i = activeCodes.length - 1; i >= 0; i--) {
            const {endCode} = activeCodes[i]!;
            stream.write(endCode);
        }
        activeCodes = emptyArray;

        // 1.2. Write a new line to separate the prefixes if needed
        if (!wasPreviousWriteEndedWithNewline) {
            stream.write(newlineBuffer);
        }

        // 1.3. If we have a prefix, write the prefix
        if (prefix !== null) {
            stream.write(`${chalk.dim(`[${prefix}]`)} `);
        }

        // 1.4. Write current styles
        activeCodes = activeCodesByWritePrefix.get(prefix) ?? emptyArray;
        for (const {code} of activeCodes) {
            stream.write(code);
        }
    }
    // 2. If we're NOT changing the prefix, we have a prefix, and the previous
    //    write ended with a newline:
    else if (prefix !== null && wasPreviousWriteEndedWithNewline) {
        // 2.1. Temporarily reset styles
        for (let i = activeCodes.length - 1; i >= 0; i--) {
            const {endCode} = activeCodes[i]!;
            stream.write(endCode);
        }

        // 2.2. Write the prefix
        stream.write(`${chalk.dim(`[${prefix}]`)} `);

        // 2.3. Restore styles
        for (const {code} of activeCodes) {
            stream.write(code);
        }
    }

    // 3. Write the first line's content
    for (const chunk of firstChunkLine.chunks) {
        stream.write(chunk);
    }
    activeCodes = mergeAnsiCodes(activeCodes, firstChunkLine.activeCodes);

    // 4. For remaining lines after the first line and excluding the last line:
    for (let chunkLineIndex = 1; chunkLineIndex < chunkLines.length - 1; chunkLineIndex++) {
        const chunkLine = chunkLines[chunkLineIndex]!;

        // 4.1. If we have a prefix:
        if (prefix !== null) {
            // 4.1.1. Temporarily reset styles
            for (let i = activeCodes.length - 1; i >= 0; i--) {
                const {endCode} = activeCodes[i]!;
                stream.write(endCode);
            }

            // 4.1.2. Write the prefix
            stream.write(`${chalk.dim(`[${prefix}]`)} `);

            // 4.1.3. Restore styles
            for (const {code} of activeCodes) {
                stream.write(code);
            }
        }

        // 4.2. Write the line's content
        for (const chunk of chunkLine.chunks) {
            stream.write(chunk);
        }
        activeCodes = mergeAnsiCodes(activeCodes, chunkLine.activeCodes);
    }

    // 5.1. If there's only chunk we've already written it
    if (chunkLines.length === 1) {
        wasPreviousWriteEndedWithNewline = false;
    }
    // 5.2. Write the last chunk
    else {
        const lastChunkLine = chunkLines[chunkLines.length - 1]!;

        // 5.2.1. If the last chunk is empty (or only has invisible ANSI codes) then
        //        this write has ended with a newline. Write the chunk but do NOT write
        //        a prefix for an empty line. The next write will add a prefix if
        //        needed.
        if (lastChunkLine.chunks.every(chunk => !hasNonAnsiCodes(chunk))) {
            wasPreviousWriteEndedWithNewline = true;

            // 5.2.1.1. Write the line's content
            for (const chunk of lastChunkLine.chunks) {
                stream.write(chunk);
            }
            activeCodes = mergeAnsiCodes(activeCodes, lastChunkLine.activeCodes);
        }
        // 5.2.2. Otherwise the line has some content but doesn't end with a newline
        else {
            wasPreviousWriteEndedWithNewline = false;

            // 5.2.2.1. If we have a prefix:
            if (prefix !== null) {
                // 5.2.2.1.1. Temporarily reset styles
                for (let i = activeCodes.length - 1; i >= 0; i--) {
                    const {endCode} = activeCodes[i]!;
                    stream.write(endCode);
                }

                // 5.2.2.1.2. Write the prefix
                stream.write(`${chalk.dim(`[${prefix}]`)} `);

                // 5.2.2.1.3. Restore styles
                for (const {code} of activeCodes) {
                    stream.write(code);
                }
            }

            // 5.2.2.2. Write the line's content
            for (const chunk of lastChunkLine.chunks) {
                stream.write(chunk);
            }
            activeCodes = mergeAnsiCodes(activeCodes, lastChunkLine.activeCodes);
        }
    }

    // Save current styles
    previousWritePrefix = prefix;
    activeCodesByWritePrefix.set(prefix, activeCodes);
}

export function writeWithStdioPrefixForTest(
    stream: WritableStream,
    chunkLines: ReadonlyArray<ChunkLine>,
    prefix: string | null,
) {
    assert(import.meta.jest);
    writeWithStdioPrefix(stream, chunkLines, prefix);
}
