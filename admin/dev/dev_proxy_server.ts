import http from "http";

/**
 * Create a server on `port1` that fully proxies the server on `port2`.
 * However, if the server on `port2` is not currently available we will pause
 * and wait for the server on `port2` to be available before responding. This
 * way a developer may hit the server in their browser and will see a loading
 * spinner while we wait for the server to be ready.
 */
export async function createDevProxyServer(port1: number, port2: number) {
    const proxyServer = http.createServer((proxyReq, proxyRes) => {
        let attemptCount = 0;
        run();

        function run() {
            attemptCount++;

            const req = http.request(
                {
                    hostname: "localhost",
                    port: port2,
                    path: proxyReq.url,
                    method: proxyReq.method,
                    headers: proxyReq.headers,
                },
                res => {
                    proxyRes.writeHead(res.statusCode!, res.headers);
                    res.pipe(proxyRes, {end: true});
                },
            );

            req.on("error", error => {
                // If we get an `ECONNREFUSED` error then the server may not have started yet.
                // Try again for ~60s. If we still can't connect write an error.
                if (
                    "code" in error &&
                    (error.code === "ECONNREFUSED" || error.code === "ECONNRESET") &&
                    attemptCount < 1200
                ) {
                    setTimeout(run, 50);
                    return;
                }

                // eslint-disable-next-line no-console
                console.error("Failed request to proxied server:", error);

                proxyRes.writeHead(502, {"content-type": "text/plain"});
                proxyRes.end("Bad Gateway");
            });

            proxyReq.pipe(req, {end: true});
        }
    });

    await new Promise<void>(resolve => {
        proxyServer.listen(port1, resolve);
    });
}
