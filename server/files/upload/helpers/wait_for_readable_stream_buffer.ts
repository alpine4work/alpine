import {Readable as ReadableStream, Writable as WritableStream} from "stream";

/**
 * Resolves once the provided `stream` has ended with a `Buffer` representing
 * all data from the stream. If aborted while waiting on the stream the promise
 * will reject with the `AbortSignal`'s reason.
 */
export function waitForReadableStreamBuffer(
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

        // This code is a little simpler if we attach `stream.on("data")` and
        // `stream.on("end")` listeners. However, according to the Node.js
        // documentation this may cause problems:
        //
        // > ##### Choose one API style
        // >
        // > The `Readable` stream API evolved across multiple Node.js versions and
        // > provides multiple methods of consuming stream data. In general,
        // > developers should choose one of the methods of consuming data and
        // > should never use multiple methods to consume data from a single
        // > stream. Specifically, using a combination of `on('data')`,
        // > `on('readable')`, `pipe()`, or async iterators could lead to
        // > unintuitive behavior.
        //
        // Given we use this to consume data from a stream we also consume with
        // `.pipe()` (the `req` body in an `uploadFile()` HTTP request) let's be
        // consistent and use `.pipe()` here too.
        const writableStream = new WritableStream({
            write: (data: Buffer, encoding, callback) => {
                chunks.push(data);

                callback();
            },
            final: callback => {
                const data = Buffer.concat(chunks);

                chunks = [];
                writableStream.off("error", handleError);
                signal.removeEventListener("abort", handleAbort);

                resolve(data);

                callback();
            },
        });

        const handleError = (error: unknown) => {
            chunks = [];
            writableStream.off("error", handleError);
            signal.removeEventListener("abort", handleAbort);

            reject(error);

            // Unpipe the stream so we don't receive any more data.
            stream.unpipe(writableStream);
        };

        const handleAbort = () => {
            chunks = [];
            writableStream.off("error", handleError);
            signal.removeEventListener("abort", handleAbort);

            reject(signal.reason);

            // Unpipe the stream so we don't receive any more data.
            stream.unpipe(writableStream);
        };

        writableStream.on("error", handleError);
        signal.addEventListener("abort", handleAbort);

        stream.pipe(writableStream);
    });
}
