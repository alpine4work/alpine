import {
    LambdaLocalRoute,
    createLambdaLocalHttpServer,
} from "~/admin/lambda/local/create_lambda_local_http_server.js";
import {
    LambdaLocalSqsConsumerOptions,
    createLambdaLocalJobQueueConsumer,
} from "~/admin/lambda/local/create_lambda_local_job_queue_consumer.js";
import {LambdaActionContext} from "~/server/lambda/helpers/lambda_action_context.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

export type LambdaRuntimeServerOptions = {
    /**
     * Array of Lambda routes to handle
     */
    routes: Array<LambdaLocalRoute>;

    /**
     * Array of Lambda subscribers to handle
     */
    subscribers?: Array<LambdaLocalSqsConsumerOptions>;
};

/**
 * Single Lambda runtime server that can handle multiple Lambda functions with
 * routing. Routes requests to appropriate Lambda handlers based on URL path
 * patterns.
 */
export function startLambdaLocal(
    processContext: LambdaActionContext,
    shutdownManager: ShutdownManager,
    tokenAgent: TokenAgent,
    port: number,
    {routes, subscribers = []}: LambdaRuntimeServerOptions,
) {
    const server = createLambdaLocalHttpServer(processContext, {
        port,
        shutdownManager,
        routes,
        tokenAgent,
    });
    const sqsConsumers = subscribers.map(subscriber =>
        createLambdaLocalJobQueueConsumer(processContext, shutdownManager, subscriber),
    );

    return {
        server,
        port,
        stop: async () => {
            return new Promise<void>(resolve => {
                runAllPromises(sqsConsumers.map(consumer => consumer.stop()))
                    .then(() => {
                        resolve();
                    })
                    .catch(error => {
                        // eslint-disable-next-line no-console
                        console.error("Error stopping Lambda runtime server:", error);
                        resolve();
                    });
            });
        },
    };
}
