import {Readable as ReadableStream} from "stream";

/**
 * Resolves once the provided `stream` has ended with a `Buffer` representing
 * all data from the stream. If aborted while waiting on the stream the promise
 * will reject with the `AbortSignal`'s reason.
 */
export function waitForReadableStreamData(
    stream: ReadableStream,
    signal: AbortSignal,
): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
        if (signal.aborted) {
            reject(signal.reason);
            return;
        }

        let chunks: Array<Buffer> = [];

        if (stream.readableEnded) {
            resolve(Buffer.concat(chunks));
            return;
        }

        const handleData = (data: Buffer) => {
            chunks.push(data);
        };

        const handleEnd = () => {
            const data = Buffer.concat(chunks);

            chunks = [];
            stream.off("data", handleData);
            stream.off("end", handleEnd);
            signal.removeEventListener("abort", handleAbort);

            resolve(data);
        };

        const handleAbort = () => {
            chunks = [];
            stream.off("data", handleData);
            stream.off("end", handleEnd);
            signal.removeEventListener("abort", handleAbort);

            reject(signal.reason);
        };

        stream.on("data", handleData);
        stream.on("end", handleEnd);
        signal.addEventListener("abort", handleAbort);
    });
}
