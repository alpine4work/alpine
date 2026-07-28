/* eslint-disable cyberworlds/string-quotes */

import {Server, createServer} from "http";
import {setupCliForTest} from "~/server/agents/cli/integration_tests/setup_cli_for_test.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {assert} from "~/shared/helpers/control/assert.js";

const cli = setupCliForTest();

type TracerRequest = {
    method: string | undefined;
    url: string | undefined;
    events: Array<{
        time: number;
        data: Record<string, string | number | boolean>;
    }>;
};

let server: Server;
let tracerBaseUrl: string;
let tracerRequestResolver: PromiseResolver<TracerRequest>;

beforeEach(async () => {
    tracerRequestResolver = createPromiseResolver<TracerRequest>();

    server = createServer((request, response) => {
        void (async () => {
            try {
                if (request.url === "/api/time") {
                    const time = Date.now();
                    response.setHeader("content-type", "application/json");
                    response.end(JSON.stringify({startTime: time, endTime: time}));
                    return;
                }

                request.setEncoding("utf8");

                let body = "";
                for await (const chunk of request) body += chunk;

                tracerRequestResolver.resolve({
                    method: request.method,
                    url: request.url,
                    events: JSON.parse(body),
                });

                response.setHeader("content-type", "application/json");
                response.end(JSON.stringify({ok: true}));
            } catch (error) {
                tracerRequestResolver.reject(error);
                response.statusCode = 500;
                response.end();
            }
        })();
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            server.off("error", reject);
            resolve();
        });
    });

    const address = server.address();
    assert(address !== null && typeof address !== "string");
    tracerBaseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
        server.close(error => {
            if (error) reject(error);
            else resolve();
        });
    });
});

test("send successful CLI events to the tracer endpoint", async () => {
    const output = await cli.run(
        `\
alpine create document '# Traced CLI document

This command should send tracer events.'
`,
        {baseUrl: tracerBaseUrl},
    );

    const tracerRequest = await tracerRequestResolver.promise;

    expect({output, tracerRequest}).toEqual({
        output: `\
Create was successful. New document: [Traced CLI document](/document/traced-cli-document).
`,
        tracerRequest: {
            method: "POST",
            url: "/api/tracer",
            events: expect.arrayContaining([
                expect.objectContaining({
                    time: expect.any(Number),
                    data: expect.objectContaining({
                        name: "Handle: CLI create",
                        "context.handler": "CLI create",
                        "service.name": "CliClient",
                        "js.host": "Node",
                        "meta.untrusted": true,
                        "meta.client_time_offset_ms": expect.any(Number),
                    }),
                }),
            ]),
        },
    });
});

test("send failed CLI events with exceptions to the tracer endpoint", async () => {
    const output = await cli.run("alpine read", {baseUrl: tracerBaseUrl});

    const tracerRequest = await tracerRequestResolver.promise;

    expect({output, tracerRequest}).toEqual({
        output: `Error: Couldn’t run command. Missing required \`<path>\` arg. Try again but add the \`<path>\` arg. Expected syntax: \`alpine read <path> [--limit 20kb]\`.\n`,
        tracerRequest: {
            method: "POST",
            url: "/api/tracer",
            events: expect.arrayContaining([
                expect.objectContaining({
                    time: expect.any(Number),
                    data: expect.objectContaining({
                        name: "Handle: CLI read",
                        "context.handler": "CLI read",
                        "exception.type": "InvalidArgumentError",
                        "exception.message": "Missing required positional arg",
                        "service.name": "CliClient",
                        "js.host": "Node",
                        "meta.untrusted": true,
                        "meta.client_time_offset_ms": expect.any(Number),
                    }),
                }),
            ]),
        },
    });
});
