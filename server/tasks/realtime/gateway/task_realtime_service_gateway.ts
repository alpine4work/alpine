import {Agent, IncomingMessage, STATUS_CODES, ServerResponse, createServer, request} from "http";
import {Socket} from "net";
import {parseArgs} from "util";
import {
    bridgeProxiedSockets,
    handleProxiedSocketError,
} from "~/server/helpers/node/bridge_proxied_sockets.js";
import {httpServerGracefulForceShutdownTimeoutMs} from "~/server/helpers/node/shutdown_timeouts.js";
import {InternalError} from "~/shared/error/error.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";

assert(process.getuid && process.setuid && process.getgid && process.setgid);

// In production we run a small proxy server on port 80 that turns requests in the
// form of `http://hostname:80/{port}/*` to `http://hostname:{port}/*`. We need
// this because annoyingly Cloudflare Workers only allows making requests to
// default ports in production (our development Cloudflare environment, Miniflare,
// respects ports).
//
// Would love for Cloudflare to allow any port. Then we can remove this.
//
// Unfortunately this code doesn't run in development but it's based off
// `dev_proxy_server.ts` which does run in development. As we find/fix bugs in
// `dev_proxy_server.ts` those changes should also probably be ported here.
//
// TODO(calebmer): We should run this code in development to make it easier to find
// bugs.

const {
    values: {port: portsArray},
} = parseArgs({
    strict: true,
    options: {
        port: {type: "string", multiple: true},
    },
});

const ports = new Set(portsArray);
const keepAliveAgent = new Agent({keepAlive: true});
const dontKeepAliveAgent = new Agent({keepAlive: false});

let isShuttingDown = false;
let activeSocketClosePromiseResolver: PromiseResolver<void> | null = null;
const activeProxiedSockets = new Set<Socket>();

function trackActiveProxiedSocket(socket: Socket) {
    activeProxiedSockets.add(socket);

    socket.once("close", () => {
        activeProxiedSockets.delete(socket);

        if (isShuttingDown && activeProxiedSockets.size === 0) {
            activeSocketClosePromiseResolver?.resolve();
            activeSocketClosePromiseResolver = null;
        }
    });
}

function waitForActiveProxiedSocketsToClose(): Promise<void> {
    if (activeProxiedSockets.size === 0) return Promise.resolve();

    assert(!activeSocketClosePromiseResolver);
    activeSocketClosePromiseResolver = createPromiseResolver();
    return activeSocketClosePromiseResolver.promise;
}

function logUnexpectedProxiedSocketError(error: Error) {
    // eslint-disable-next-line no-console
    console.error("Proxied request failed:", error);
}

function rejectHttpRequest(res: ServerResponse, statusCode: number, statusMessage: string) {
    res.writeHead(statusCode, {
        "content-type": "text/plain",
        connection: "close",
    });
    res.end(`${statusCode} ${statusMessage}`);
}

function rejectUpgradeRequest(
    req: IncomingMessage,
    socket: Socket,
    statusCode: number,
    statusMessage: string,
) {
    const res = new ServerResponse(req);
    res.assignSocket(socket);
    rejectHttpRequest(res, statusCode, statusMessage);
}

const server = createServer((req1, res1) => {
    const url = new URL(req1.url!, `http://${req1.headers.host!}`);

    if (isShuttingDown) {
        rejectHttpRequest(res1, 503, "Service Unavailable (shutting down)");
        return;
    }

    if (url.pathname === "/healthcheck") {
        res1.writeHead(200, {"content-type": "text/plain"});
        res1.end("200 OK");
        return;
    }

    const match = url.pathname?.match(/^\/(\d+)(\/.*|$)/);
    const port = match?.[1];

    if (!port || !ports.has(port)) {
        res1.writeHead(404, {"content-type": "text/plain"});
        res1.end("404 Not Found");
        return;
    }

    const req2 = request({
        agent: keepAliveAgent,
        hostname: "localhost",
        port,
        path: match[2]!.length === 0 ? "/" : match[2],
        method: req1.method,
        headers: req1.headers,
    });

    req2.on("error", error => {
        logUnexpectedProxiedSocketError(error);

        res1.writeHead(500, {"content-type": "text/plain"});
        res1.end("500 Internal Server Error");
    });

    req2.on("response", res2 => {
        res1.writeHead(res2.statusCode!, res2.statusMessage, res2.headers);
        res2.pipe(res1, {end: true});
    });

    req1.pipe(req2, {end: true});
});

server.on("upgrade", (req1, socket1, head1) => {
    assert(socket1 instanceof Socket);

    // A raw socket that emits an `'error'` event with no listener is rethrown as an
    // unhandled exception, which crashes the entire gateway process and drops every
    // other connection it is proxying. A client dropping its WebSocket connection
    // (`ECONNRESET`) is routine for a realtime service, so destroy the socket on error
    // instead of crashing. We attach this immediately because `socket1` can error
    // during the window before the upstream connection in `req2` is established.
    socket1.on("error", error => {
        handleProxiedSocketError({
            error,
            logUnexpectedError: logUnexpectedProxiedSocketError,
        });
    });

    const url = new URL(req1.url!, `http://${req1.headers.host!}`);
    const match = url.pathname?.match(/^\/(\d+)(\/.*|$)/);
    const port = match?.[1];

    if (isShuttingDown) {
        rejectUpgradeRequest(req1, socket1, 503, "Service Unavailable (shutting down)");
        return;
    }

    if (!port || !ports.has(port)) {
        rejectUpgradeRequest(req1, socket1, 404, "Not Found");
        return;
    }

    const req2 = request({
        agent: dontKeepAliveAgent,
        hostname: "localhost",
        port,
        path: match[2]!.length === 0 ? "/" : match[2],
        method: req1.method,
        headers: req1.headers,
    });

    // While the upstream request is still in its handshake phase (no `error`,
    // `response`, or `upgrade` yet) destroying `socket1` doesn't tear down `req2` on
    // its own. If the client disconnects during this window we'd leak the upstream
    // connection, so cancel `req2` ourselves. Each terminal `req2` event below
    // detaches this listener once the request is no longer pending.
    const destroyReq2 = () => req2.destroy();
    socket1.on("close", destroyReq2);

    req2.on("error", error => {
        socket1.off("close", destroyReq2);
        if (socket1.destroyed) return;

        logUnexpectedProxiedSocketError(error);

        rejectUpgradeRequest(req1, socket1, 500, "Internal Server Error");
    });

    req2.on("response", res2 => {
        socket1.off("close", destroyReq2);

        if (socket1.destroyed) {
            res2.destroy();
            return;
        }

        const res1 = new ServerResponse(req1);
        res1.assignSocket(socket1);
        res1.writeHead(res2.statusCode!, res2.statusMessage, res2.headers);
        res2.pipe(res1, {end: true});
    });

    req2.on("upgrade", (res2, socket2, head2) => {
        socket1.off("close", destroyReq2);

        if (socket1.destroyed) {
            socket2.destroy();
            return;
        }

        // See the comment on `socket1` above. Guard the upstream socket the same way.
        socket2.on("error", error => {
            handleProxiedSocketError({
                error,
                logUnexpectedError: logUnexpectedProxiedSocketError,
            });
        });

        trackActiveProxiedSocket(socket1);
        trackActiveProxiedSocket(socket2);

        const headers = [];
        for (let i = 0; i < res2.rawHeaders.length; i += 2) {
            headers.push(`${res2.rawHeaders[i]!}: ${res2.rawHeaders[i + 1]!}`);
        }

        socket1.write(
            `HTTP/1.1 ${res2.statusCode!} ${
                res2.statusMessage ?? STATUS_CODES[res2.statusCode!]!
            }\r\n` +
                `${headers.join("\r\n")}\r\n` +
                "\r\n",
        );

        // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
        // fixing for now.
        // @ts-expect-error
        socket1.write(head2);
        // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
        // fixing for now.
        // @ts-expect-error
        socket2.write(head1);
        bridgeProxiedSockets({socket1, socket2});
    });

    req1.pipe(req2, {end: true});
});

async function shutdown(signal: "SIGINT" | "SIGTERM") {
    if (isShuttingDown) return;
    isShuttingDown = true;

    try {
        // eslint-disable-next-line no-console
        console.log(`Gateway graceful shutdown started by ${signal} (pid: ${process.pid})`);

        const closeServerPromise = new Promise<void>((resolve, reject) => {
            server.close(error => {
                if (error) reject(error);
                else resolve();
            });
        });

        const forceCloseTimeout = createTimeout(() => {
            // eslint-disable-next-line no-console
            console.log("Graceful shutdown timeout exceeded, forcefully shutting down");
            for (const socket of activeProxiedSockets) {
                socket.destroy();
            }
        }, httpServerGracefulForceShutdownTimeoutMs);

        try {
            await runAllPromises([closeServerPromise, waitForActiveProxiedSocketsToClose()]);
            forceCloseTimeout.clear();

            // eslint-disable-next-line no-console
            console.log(`Gateway graceful shutdown finished (pid: ${process.pid})`);
        } catch (error) {
            forceCloseTimeout.clear();
            throw error;
        }

        process.exit(0);
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Gateway shutdown finished with exception: ", error);

        process.exit(1);
    }
}

process.on("SIGINT", () => {
    void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
});

// We need to be the root process to listen on port 80. Once our server is
// listening on port 80 we immediately downgrade the process to the `www-data` user
// which exists on Linux.
assert(process.getuid() === 0);

try {
    server.listen(80, () => {
        // eslint-disable-next-line no-console
        console.log(`Listening on port 80 (pid: ${process.pid})`);
    });
} finally {
    process.setgid("www-data");
    process.setuid("www-data");

    // We are paranoid. Check to make sure our process can't escalate back to the root
    // user after setting the user to `www-data`.
    {
        let failed = false;
        try {
            process.setuid(0);
        } catch (error) {
            if ((error as any).syscall === "setuid" && (error as any).code === "EPERM") {
                failed = true;
            } else {
                throw error;
            }
        }

        if (!failed) {
            // eslint-disable-next-line no-console
            console.error(new InternalError("Process could set it\u2019s uid back to root user"));
            process.exit(1);
        }
    }
}
