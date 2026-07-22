import {mkdtemp, readFile} from "fs/promises";
import {createServer} from "http";
import {AddressInfo} from "net";
import {tmpdir} from "os";
import {join as joinPath} from "path";
import {createAgentsCliTracerEventSender} from "~/server/agents/cli/create_agents_cli_tracer_event_sender.js";
import {TracerEvent} from "~/shared/tracer/tracer_event.js";

import.meta.jest.setTimeout(15 * 1000);

test("sends events from a subprocess with a cached synchronized clock offset", async () => {
    const tracerRequests: Array<Array<{time: number; data: Record<string, unknown>}>> = [];
    let timeRequestCount = 0;
    let resolveFirstTracerRequest!: () => void;
    let resolveSecondTracerRequest!: () => void;
    const firstTracerRequestPromise = new Promise<void>(resolve => {
        resolveFirstTracerRequest = resolve;
    });
    const secondTracerRequestPromise = new Promise<void>(resolve => {
        resolveSecondTracerRequest = resolve;
    });

    const server = createServer((request, response) => {
        if (request.url === "/api/time") {
            timeRequestCount++;
            const serverTime = Date.now() + 500;
            response.end(JSON.stringify({startTime: serverTime, endTime: serverTime}));
            return;
        }

        if (request.url === "/api/tracer") {
            void (async () => {
                let body = "";
                request.setEncoding("utf8");
                for await (const chunk of request) body += chunk;

                tracerRequests.push(JSON.parse(body));
                response.end();

                if (tracerRequests.length === 1) {
                    resolveFirstTracerRequest();
                } else {
                    resolveSecondTracerRequest();
                }
            })();
            return;
        }

        response.statusCode = 404;
        response.end();
    });

    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));

    try {
        const address = server.address() as AddressInfo;
        const baseUrl = new URL(`http://127.0.0.1:${address.port}`);
        const dataDirectoryPath = await mkdtemp(joinPath(tmpdir(), "alpine-cli-tracer-test-"));

        const firstSender = createAgentsCliTracerEventSender();
        firstSender.sendEvent({
            time: 1000,
            getFlatData: () => ({name: "first"}),
        } as TracerEvent);
        firstSender.start({baseUrl, dataDirectoryPath});
        await firstSender.flush();
        await firstTracerRequestPromise;

        const secondSender = createAgentsCliTracerEventSender();
        secondSender.start({baseUrl, dataDirectoryPath});
        secondSender.sendEvent({
            time: 2000,
            getFlatData: () => ({name: "second"}),
        } as TracerEvent);
        await secondSender.flush();
        await secondTracerRequestPromise;

        const firstOffset = tracerRequests[0]![0]!.data["meta.client_time_offset_ms"] as number;
        const secondOffset = tracerRequests[1]![0]!.data["meta.client_time_offset_ms"] as number;
        const cachedOffset = JSON.parse(
            await readFile(joinPath(dataDirectoryPath, "clock-offset.json"), "utf8"),
        );

        expect({
            timeRequestCount,
            firstOriginalTime: tracerRequests[0]![0]!.time - firstOffset,
            secondOriginalTime: tracerRequests[1]![0]!.time - secondOffset,
            firstName: tracerRequests[0]![0]!.data["name"],
            secondName: tracerRequests[1]![0]!.data["name"],
            offsets: [firstOffset, secondOffset, cachedOffset],
        }).toEqual({
            timeRequestCount: 5,
            firstOriginalTime: 1000,
            secondOriginalTime: 2000,
            firstName: "first",
            secondName: "second",
            offsets: [firstOffset, firstOffset, firstOffset],
        });
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close(error => (error === undefined ? resolve() : reject(error)));
        });
    }
});
