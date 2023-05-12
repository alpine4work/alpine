import {createRequestListener, writeResponse} from "@miniflare/http-server";
import {coupleWebSocket} from "@miniflare/web-sockets";
import http from "http";
import {Miniflare} from "miniflare";
import net from "net";
import path from "path";
import createServeStaticMiddleware from "serve-static";
import {Headers} from "undici";
import WebSocket from "ws";
import {parseDotenv} from "~/admin/helpers/parse_dotenv";
import {runfilesPath} from "~/admin/helpers/runfiles_path";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {assert} from "~/shared/helpers/control/assert";

export type LocalServer = {
    readonly miniflare: Miniflare;
    readonly server: http.Server;
    readonly webSocketServer: WebSocket.Server;
};

/**
 * Creates an HTTP server for running our app web server locally.
 */
export function createLocalServer({
    bindings,
    globals,
    middleware = (req, res, next) => next(),
    upgradeMiddleware = (req, res, next) => next(),
}: {
    bindings?: {[key: string]: unknown};
    globals?: {[key: string]: unknown};
    middleware?: (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void;
    upgradeMiddleware?: (req: http.IncomingMessage, socket: net.Socket, next: () => void) => void;
}): LocalServer {
    // NOTE(calebmer): [V8 and Node.js have a memory leak][1] with `vm` where
    // modules are never garbage collected. This means during development we get
    // the occasional memory leak. The only way to fix this until V8 fixes the
    // underlying memory leak is to occasionally restart the dev process. Maybe we
    // will automate this at some point...
    //
    // [1]: https://github.com/nodejs/node/issues/33439
    const miniflare = new Miniflare({
        scriptPath: path.join(runfilesPath, "cyberworlds/app/build/server.js"),
        compatibilityDate: "2022-07-12",
        compatibilityFlags: ["streams_enable_constructors"],
        modules: true,
        modulesRules: [{type: "ESModule", include: ["**/*.js"], fallthrough: true}],
        sourceMap: true,
        bindings: {...parseDotenv(), ...bindings},
        durableObjects: {
            DocumentCollaborationDurableObjectNamespace: "DocumentCollaborationDurableObject",
            PostRealtimeDurableObjectNamespace: "PostRealtimeDurableObject",
            ChatRealtimeDurableObjectNamespace: "ChatRealtimeDurableObject",
            MyAccountDurableObjectNamespace: "MyAccountDurableObject",
        },
        queueBindings: [{name: "NotificationsQueue", queueName: "notifications-queue"}],
        queueConsumers: [
            {
                queueName: "notifications-queue",
                maxBatchSize: 1,
                maxWaitMs: 0,
                maxRetries: 10,
                deadLetterQueue: "notifications-dead-letter-queue",
            },
        ],
        globals,
    });

    const miniflareListener = createRequestListener(miniflare);

    const serveStaticMiddleware = createServeStaticMiddleware(
        path.join(runfilesPath, "cyberworlds/app/public"),
        {cacheControl: false},
    );

    const server = http.createServer((req, res) => {
        middleware(req, res, () => {
            // Start by trying to serve our assets...
            serveStaticMiddleware(req, res, () => {
                // If we could not serve an asset then run our Cloudflare worker...
                runPromiseWithoutAwaiting(async () => {
                    await miniflareListener(req, res);
                });
            });
        });
    });

    // This code is almost entirely copied from Miniflare. Ideally Miniflare would
    // provide a `createWebSocketServer()` function or similar.
    // https://github.com/cloudflare/miniflare/blob/2e49dab9f6b0049323eae180cce1c7fcc2ffbfb0/packages/http-server/src/index.ts#L384-L467

    const webSocketServer = new WebSocket.Server({
        noServer: true,
        // Disable automatic handling of `Sec-WebSocket-Protocol` header, Cloudflare
        // Workers require users to include this header themselves in `Response`s:
        // https://github.com/cloudflare/miniflare/issues/179
        handleProtocols: () => false,
    });

    const restrictedWebSocketUpgradeHeaders = ["upgrade", "connection", "sec-websocket-accept"];

    // Add custom headers included in response to WebSocket upgrade requests
    const extraHeaders = new WeakMap<http.IncomingMessage, Headers>();
    webSocketServer.on("headers", (headers, req) => {
        const extra = extraHeaders.get(req);
        extraHeaders.delete(req);
        if (extra) {
            for (const [key, value] of extra) {
                if (!restrictedWebSocketUpgradeHeaders.includes(key.toLowerCase())) {
                    headers.push(`${key}: ${value}`);
                }
            }
        }
    });

    server.on("upgrade", (req, socket, head) => {
        // `socket` is guaranteed to be an instance of `net.Socket`:
        // https://nodejs.org/api/http.html#event-upgrade_1
        assert(socket instanceof net.Socket);

        upgradeMiddleware(req, socket, () => {
            runPromiseWithoutAwaiting(async () => {
                const response = await miniflareListener(req);

                // Check web socket response was returned
                const webSocket = response?.webSocket;
                if (response?.status === 101 && webSocket) {
                    // Accept and couple the Web Socket
                    extraHeaders.set(req, response.headers);
                    webSocketServer.handleUpgrade(req, socket, head, otherWebSocket => {
                        void coupleWebSocket(otherWebSocket, webSocket);
                        webSocketServer.emit("connection", otherWebSocket, req);
                    });
                    return;
                }

                // Otherwise, we'll be returning a regular HTTP response
                const res = new http.ServerResponse(req);
                res.assignSocket(socket);

                // If no response was provided, or it was an "ok" response, log an error
                if (!response || (200 <= response.status && response.status < 300)) {
                    res.writeHead(500);
                    res.end();

                    // eslint-disable-next-line no-console
                    console.error(
                        new TypeError(
                            "Web Socket request did not return status 101 Switching Protocols response with Web Socket",
                        ),
                    );
                    return;
                }

                await writeResponse(response, res);
            });
        });
    });

    return {
        miniflare,
        server,
        webSocketServer,
    };
}
