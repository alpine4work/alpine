import {Readable as ReadableStream, Writable as WritableStream} from "stream";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {DefaultWeakMap} from "~/shared/helpers/map/default_weak_map.js";
import {Id, generateId} from "~/shared/id/id.js";

// TODO(calebmer, #files): Remove after debugging.
export const debugIdByObject = new DefaultWeakMap<object, Id>(generateId);

/**
 * Resolves once the provided `stream` has ended with a `Buffer` representing
 * all data from the stream. If aborted while waiting on the stream the promise
 * will reject with the `AbortSignal`'s reason.
 */
export function waitForReadableStreamBuffer(
    stream: ReadableStream,
    signal: AbortSignal,
): Promise<Buffer> {
    const debugId = generateId();

    // TODO(calebmer, #files): Remove after debugging.
    // eslint-disable-next-line no-console
    console.trace("waitForReadableStreamBuffer", debugIdByObject.getOrSetDefault(stream), debugId);

    return new Promise<Buffer>((resolve, reject) => {
        if (signal.aborted) {
            reject(signal.reason);
            return;
        }

        let contentLength = 0;
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
                contentLength += data.length;
                chunks.push(data);

                // TODO(calebmer, #files): Remove after debugging.
                // eslint-disable-next-line no-console
                console.log(
                    "waitForReadableStreamBuffer",
                    debugIdByObject.getOrSetDefault(stream),
                    debugId,
                    "data",
                    contentLength,
                    encodeBase64(data.subarray(0, 30)),
                );

                callback();
            },
            final: callback => {
                // TODO(calebmer, #files): Remove after debugging.
                // eslint-disable-next-line no-console
                console.log(
                    "waitForReadableStreamBuffer",
                    debugIdByObject.getOrSetDefault(stream),
                    debugId,
                    "end",
                    contentLength,
                );

                const data = Buffer.concat(chunks);

                chunks = [];
                writableStream.off("error", handleError);
                signal.removeEventListener("abort", handleAbort);

                resolve(data);

                callback();
            },
        });

        const handleError = (error: unknown) => {
            // TODO(calebmer, #files): Remove after debugging.
            // eslint-disable-next-line no-console
            console.log(
                "waitForReadableStreamBuffer",
                debugIdByObject.getOrSetDefault(stream),
                debugId,
                "error",
                contentLength,
            );

            chunks = [];
            writableStream.off("error", handleError);
            signal.removeEventListener("abort", handleAbort);

            reject(error);

            // Unpipe the stream so we don't receive any more data.
            stream.unpipe(writableStream);
        };

        const handleAbort = () => {
            // TODO(calebmer, #files): Remove after debugging.
            // eslint-disable-next-line no-console
            console.log(
                "waitForReadableStreamBuffer",
                debugIdByObject.getOrSetDefault(stream),
                debugId,
                "abort",
                contentLength,
            );

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
