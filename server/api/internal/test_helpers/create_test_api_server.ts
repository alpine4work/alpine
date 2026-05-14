import fs from "fs/promises";
import {IncomingMessage, ServerResponse} from "http";
import {join as joinPath} from "path";
import supertest from "supertest";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {ApiPathsBase} from "~/server/api/internal/shared/api_paths_type.js";
import {createApiServiceRequestListener} from "~/server/api/internal/shared/api_service_server.js";
import {createTestTokenAgents} from "~/server/dynamo/test_helpers/create_test_token_agent.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TokenAgentJobQueueServicePrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllObjectPromises} from "~/shared/helpers/async/run_all_promises.js";

type TestApiServerRequest = (
    path: string,
    options?: TestApiServerRequestOptions,
) => Promise<TestApiServerResponse>;

type TestApiServerRequestOptions = {
    headers?: Record<string, string>;
    body?: unknown;
    unsetHeaders?: Array<string>;
};

type TestApiServerResponse = {
    status: number;
    headers: Record<string, string>;
    body: any;
};

export type TestApiServer = {
    readonly GET: TestApiServerRequest;
    readonly POST: TestApiServerRequest;
    readonly PUT: TestApiServerRequest;
    readonly PATCH: TestApiServerRequest;
    readonly jobQueueTokenAgent: TokenAgent<TokenAgentJobQueueServicePrivateSide>;
    readonly apiTokenAgent: TokenAgent;
};

export function createTestApiServer(
    context: TestActualContext,
    paths: ApiPathsBase,
): TestApiServer {
    let jobQueueTokenAgent: TokenAgent<TokenAgentJobQueueServicePrivateSide> | undefined;
    let apiTokenAgent: TokenAgent | undefined;
    let server: ((req: IncomingMessage, res: ServerResponse<IncomingMessage>) => void) | undefined;

    beforeAll(async () => {
        let temporaryJobQueueTokenAgent: TokenAgent;

        [apiTokenAgent, temporaryJobQueueTokenAgent] = await createTestTokenAgents(context, [
            "ApiService",
            "JobQueueService",
        ]);

        const keysDirectoryPath = joinPath(context.getTemporaryDirectoryPath(), "keys");

        jobQueueTokenAgent = {
            publicSide: temporaryJobQueueTokenAgent.publicSide,
            privateSide: await TokenAgentJobQueueServicePrivateSide.new(
                await runAllObjectPromises({
                    serviceName: "JobQueueService",
                    servicePrivateKey: fs.readFile(
                        joinPath(keysDirectoryPath, "job_queue_service_rsa"),
                        "utf8",
                    ),
                    secret: fs.readFile(joinPath(keysDirectoryPath, "token_agent_secret"), "utf8"),
                }),
            ),
        };

        server = await createApiServiceRequestListener(context, paths, {
            edgeServiceUrl: "https://test.cyberworlds.dev",
            resourceServiceUrl: "https://resources.cyberworlds.dev",
            tokenAgent: apiTokenAgent,
        });
    });

    async function testRequest(
        method: "GET" | "POST" | "PUT" | "PATCH",
        path: string,
        options?: TestApiServerRequestOptions,
    ): Promise<TestApiServerResponse> {
        if (server === undefined) throw new InternalError("`beforeAll()` hook hasn\u2019t run");

        let request;

        switch (method) {
            case "GET":
                request = supertest(server).get(path);
                break;
            case "POST":
                request = supertest(server).post(path);
                break;
            case "PUT":
                request = supertest(server).put(path);
                break;
            case "PATCH":
                request = supertest(server).patch(path);
                break;
        }

        for (const [key, value] of Object.entries(options?.headers ?? {})) {
            request = request.set(key, value);
        }

        for (const header of options?.unsetHeaders ?? []) {
            request = request.unset(header);
        }

        if (options?.body) {
            request = request.send(options.body);
        }

        const response = await request;

        return {
            status: response.status,
            headers: response.headers,
            body:
                response.headers["content-type"] === "application/json"
                    ? response.body
                    : response.text,
        };
    }

    return {
        GET: (path, options) => testRequest("GET", path, options),
        POST: (path, options) => testRequest("POST", path, options),
        PUT: (path, options) => testRequest("PUT", path, options),
        PATCH: (path, options) => testRequest("PATCH", path, options),

        get jobQueueTokenAgent() {
            if (jobQueueTokenAgent === undefined)
                throw new InternalError("`beforeAll()` hook hasn\u2019t run");
            return jobQueueTokenAgent;
        },
        get apiTokenAgent() {
            if (apiTokenAgent === undefined)
                throw new InternalError("`beforeAll()` hook hasn\u2019t run");
            return apiTokenAgent;
        },
    };
}
