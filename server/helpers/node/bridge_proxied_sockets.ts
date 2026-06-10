import type {Duplex} from "stream";

/**
 * Handle errors emitted by a proxied socket.
 *
 * If the error is a connection reset or pipe error then it's expected and we can
 * ignore it, otherwise we log it as an unexpected error.
 */
export function handleProxiedSocketError({
    error,
    logUnexpectedError,
}: {
    readonly error: Error;
    readonly logUnexpectedError: (error: Error) => void;
}) {
    if ("code" in error && (error.code === "ECONNRESET" || error.code === "EPIPE")) {
        return;
    }

    logUnexpectedError(error);
}

/**
 * Bridge two raw sockets and ensure both sides are torn down when either side
 * closes via their `'close'` event.
 */
export function bridgeProxiedSockets({
    socket1,
    socket2,
}: {
    readonly socket1: Duplex;
    readonly socket2: Duplex;
}) {
    socket1.on("close", () => {
        if (socket2.destroyed) return;
        socket2.end();
    });
    socket2.on("close", () => {
        if (socket1.destroyed) return;
        socket1.end();
    });

    socket1.pipe(socket2, {end: true});
    socket2.pipe(socket1, {end: true});
}
