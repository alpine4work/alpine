import fs from "fs/promises";
import {IncomingMessage, ServerResponse} from "http";
import {join as joinPath} from "path";
import {ApiPathsBase} from "~/server/api/internal/shared/api_paths_type.js";
import {createApiServiceRequestListener} from "~/server/api/internal/shared/api_service_server.js";
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestTokenAgents} from "~/server/dynamo/test_helpers/create_test_token_agent.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TokenAgentJobQueueServicePrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllObjectPromises} from "~/shared/helpers/async/run_all_promises.js";

export function createTestApiServer(
    context: TestContext,
    paths: ApiPathsBase,
): {
    (req: IncomingMessage, res: ServerResponse<IncomingMessage>): void;
    readonly jobQueueTokenAgent: TokenAgent<TokenAgentJobQueueServicePrivateSide>;
    readonly apiTokenAgent: TokenAgent;
} {
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
            edgeServiceUrl: "https://test.alpine.inc",
            tokenAgent: apiTokenAgent,
        });
    });

    const actualServer = (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => {
        if (server === undefined) throw new InternalError("`beforeAll()` hook hasn’t run");
        server(req, res);
    };

    Object.defineProperty(actualServer, "jobQueueTokenAgent", {
        get: () => {
            if (jobQueueTokenAgent === undefined)
                throw new InternalError("`beforeAll()` hook hasn’t run");
            return jobQueueTokenAgent;
        },
    });

    Object.defineProperty(actualServer, "apiTokenAgent", {
        get: () => {
            if (apiTokenAgent === undefined)
                throw new InternalError("`beforeAll()` hook hasn’t run");
            return apiTokenAgent;
        },
    });

    return actualServer as any;
}
