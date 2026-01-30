import {Agent, STATUS_CODES, ServerResponse, createServer, request} from "http";
import {Socket} from "net";
import {parseArgs} from "util";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";

assert(process.getuid && process.setuid && process.getgid && process.setgid);

// In production we run a small proxy server on port 80 that turns requests
// in the form of `http://hostname:80/{port}/*` to `http://hostname:{port}/*`.
// We need this because annoyingly Cloudflare Workers only allows making
// requests to default ports in production (our development Cloudflare
// environment, Miniflare, respects ports).
//
// Would love for Cloudflare to allow any port. Then we can remove this.
//
// Unfortunately this code doesn't run in development but it's based off
// `dev_proxy_server.ts` which does run in development. As we find/fix bugs in
// `dev_proxy_server.ts` those changes should also probably be ported here.
//
// TODO(calebmer): We should run this code in development to make it easier to
// find bugs.

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

const server = createServer((req1, res1) => {
    const url = new URL(req1.url!, `http://${req1.headers.host!}`);

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
        // eslint-disable-next-line no-console
        console.error(error);

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

    const url = new URL(req1.url!, `http://${req1.headers.host!}`);
    const match = url.pathname?.match(/^\/(\d+)(\/.*|$)/);
    const port = match?.[1];

    if (!port || !ports.has(port)) {
        const res1 = new ServerResponse(req1);
        res1.assignSocket(socket1);
        res1.writeHead(404, {"content-type": "text/plain"});
        res1.end("404 Not Found");
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

    req2.on("error", error => {
        // eslint-disable-next-line no-console
        console.error(error);

        const res1 = new ServerResponse(req1);
        res1.assignSocket(socket1);
        res1.writeHead(500, {"content-type": "text/plain"});
        res1.end("500 Internal Server Error");
    });

    req2.on("response", res2 => {
        const res1 = new ServerResponse(req1);
        res1.assignSocket(socket1);
        res1.writeHead(res2.statusCode!, res2.statusMessage, res2.headers);
        res2.pipe(res1, {end: true});
    });

    req2.on("upgrade", (res2, socket2, head2) => {
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
        socket1.pipe(socket2);
        socket2.pipe(socket1);
    });

    req1.pipe(req2, {end: true});
});

// We need to be the root process to listen on port 80. Once our server is
// listening on port 80 we immediately downgrade the process to the `www-data`
// user which exists on Linux.
assert(process.getuid() === 0);

try {
    server.listen(80, () => {
        // eslint-disable-next-line no-console
        console.log(`Listening on port 80 (pid: ${process.pid})`);
    });
} finally {
    process.setgid("www-data");
    process.setuid("www-data");

    // We are paranoid. Check to make sure our process can't escalate back to the
    // root user after setting the user to `www-data`.
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
