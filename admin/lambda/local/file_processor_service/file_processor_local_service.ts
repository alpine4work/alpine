import {startLambdaLocal} from "~/admin/lambda/local/start_lambda_local.js";
import {handleResizeFileRequest} from "~/server/files/processor/lambda/request_handlers/handle_resize_file_request.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {
    createLambdaActionContext,
    lambdaActionContextOptions,
} from "~/server/lambda/helpers/lambda_action_context.js";
import {createServiceTokenAgent} from "~/server/node/create_service_token_agent.js";
import {ServiceOptions} from "~/server/node/run_service.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

type Options = ServiceOptions<typeof options>;
export const options = {
    port: {type: "string"},
    ...lambdaActionContextOptions,
    honeycombApiKey: {type: "string", optional: true},
    sqsLocalPort: {type: "string"},
} as const;

export async function run({
    options,
    tracer,
    shutdownManager,
}: {
    options: Options;
    tracer: TracerRoot;
    shutdownManager: ShutdownManager;
}) {
    const port = assertExists(options.port);
    const fileProcessorLambdaServiceUrl = `http://localhost:${port}`;

    const tokenAgent = await createServiceTokenAgent({
        serviceName: "FileProcessorService",
        options,
    });

    const promiseWaiter = new PromiseWaiter();
    const actionContext = createLambdaActionContext({
        options,
        awsSigner: new AwsRequestSigner(),
        tokenAgent,
        tracer,
        promiseWaiter,
        fileProcessorServiceUrl: fileProcessorLambdaServiceUrl,
    });

    shutdownManager.registerWaitUntilPromise(promiseWaiter.wait());

    startLambdaLocal(actionContext, shutdownManager, tokenAgent, parseInt(port, 10), {
        routes: [
            {
                path: "/{spaceId}/resize/{fileId}",
                handler: handleResizeFileRequest,
                functionName: "ResizeFile",
                timeoutMs: 30000, // 30 seconds
            },
        ],
    });
}
