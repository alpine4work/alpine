import {Writable as WritableStream} from "stream";

/**
 * Resolves once the provided `stream` has ended. Does not keep track of data
 * from the stream. If aborted while waiting on the stream the promise will
 * reject with the `AbortSignal`'s reason.
 */
export function waitForWritableStreamClose(
    stream: WritableStream,
    signal: AbortSignal,
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
            reject(signal.reason);
            return;
        }

        if (stream.closed) {
            resolve();
            return;
        }

        const handleClose = () => {
            stream.off("close", handleClose);
            stream.off("error", handleError);
            signal.removeEventListener("abort", handleAbort);

            resolve();
        };

        const handleError = (error: unknown) => {
            stream.off("close", handleClose);
            stream.off("error", handleError);
            signal.removeEventListener("abort", handleAbort);

            reject(error);
        };

        const handleAbort = () => {
            stream.off("close", handleClose);
            stream.off("error", handleError);
            signal.removeEventListener("abort", handleAbort);

            reject(signal.reason);
        };

        stream.on("close", handleClose);
        stream.on("error", handleError);
        signal.addEventListener("abort", handleAbort);
    });
}
