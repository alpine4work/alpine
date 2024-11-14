import {Readable as ReadableStream} from "stream";
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
    // TODO(calebmer, #files): Remove after debugging.
    // eslint-disable-next-line no-console
    console.trace("waitForReadableStreamBuffer", debugIdByObject.getOrSetDefault(stream));

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

        const handleData = (data: Buffer) => {
            contentLength += data.length;
            chunks.push(data);

            // TODO(calebmer, #files): Remove after debugging.
            // eslint-disable-next-line no-console
            console.log(
                "waitForReadableStreamBuffer",
                debugIdByObject.getOrSetDefault(stream),
                "data",
                contentLength,
                encodeBase64(data.subarray(0, 60)),
            );
        };

        const handleEnd = () => {
            // TODO(calebmer, #files): Remove after debugging.
            // eslint-disable-next-line no-console
            console.log(
                "waitForReadableStreamBuffer",
                debugIdByObject.getOrSetDefault(stream),
                "end",
                contentLength,
            );

            const data = Buffer.concat(chunks);

            chunks = [];
            stream.off("data", handleData);
            stream.off("end", handleEnd);
            stream.off("error", handleError);
            signal.removeEventListener("abort", handleAbort);

            resolve(data);
        };

        const handleError = (error: unknown) => {
            // TODO(calebmer, #files): Remove after debugging.
            // eslint-disable-next-line no-console
            console.log(
                "waitForReadableStreamBuffer",
                debugIdByObject.getOrSetDefault(stream),
                "error",
                contentLength,
            );

            chunks = [];
            stream.off("data", handleData);
            stream.off("end", handleEnd);
            stream.off("error", handleError);
            signal.removeEventListener("abort", handleAbort);

            reject(error);
        };

        const handleAbort = () => {
            // TODO(calebmer, #files): Remove after debugging.
            // eslint-disable-next-line no-console
            console.log(
                "waitForReadableStreamBuffer",
                debugIdByObject.getOrSetDefault(stream),
                "abort",
                contentLength,
            );

            chunks = [];
            stream.off("data", handleData);
            stream.off("end", handleEnd);
            stream.off("error", handleError);
            signal.removeEventListener("abort", handleAbort);

            reject(signal.reason);
        };

        stream.on("data", handleData);
        stream.on("end", handleEnd);
        stream.on("error", handleError);
        signal.addEventListener("abort", handleAbort);
    });
}
