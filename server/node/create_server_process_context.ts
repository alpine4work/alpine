import {EdgeServiceContextModule} from "~/server/context/edge_service_context_module.js";
import {
    ServerProcessContext,
    ServerProcessContextModules,
} from "~/server/context/server_process_context.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {NoopEmailContextModule} from "~/server/emails/noop_email_context_module.js";
import {SesEmailContextModule} from "~/server/emails/ses_email_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {JobSender} from "~/server/jobs/core/job_sender.js";
import {JobsContextModuleWithoutAuthorization} from "~/server/jobs/core/jobs_context_module_without_authorization.js";
import {registerShutdownWaitUntilPromise} from "~/server/node/shutdown_manager.js";
import {OpensearchClient} from "~/server/opensearch/opensearch_client.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

export const serverProcessContextParseOptions = {
    dynamoLocalPort: {type: "string"},
    opensearchLocalPort: {type: "string"},
    opensearchHost: {type: "string"},
    jobQueueUrl: {type: "string"},
    edgeServiceUrl: {type: "string"},
} as const;

/**
 * Create a `ServerProcessContext`. You should run this at the root of your
 * service. Probably in a `runService()` call.
 *
 * Requires some parameters we expect to come from the command line.
 * `serverProcessContextParseOptions` is an object defining the args you can
 * pass into `parseArgs()`.
 */
export function createServerProcessContext({
    tracer,
    tokenAgent,
    awsSigner,
    options,
}: {
    tracer: TracerRoot;
    tokenAgent: TokenAgent | "Unimplemented";
    awsSigner: AwsRequestSigner;
    options: {
        dynamoLocalPort?: string;
        opensearchLocalPort?: string;
        opensearchHost?: string;
        jobQueueUrl?: string;
        edgeServiceUrl?: string;
    };
}): ServerProcessContext {
    return Context.new<ServerProcessContextModules>({
        process: new ProcessContextModule({
            waitUntil: promise => {
                registerShutdownWaitUntilPromise(
                    promise.catch(error => {
                        tracer.logUncaughtException("Uncaught exception from `waitUntil()`", error);
                    }),
                );
            },
        }),
        tracer: new TracerContextModule(tracer),
        dynamo: DynamoContextModule.new(
            process.env.NODE_ENV === "production"
                ? "https://dynamodb.us-east-1.amazonaws.com"
                : `http://localhost:${parseInt(
                      assertExists(
                          options.dynamoLocalPort,
                          "DynamoDB local port must be provided when running DynamoDB locally",
                      ),
                      10,
                  )}`,
            awsSigner,
        ),
        email:
            process.env.NODE_ENV === "production"
                ? new SesEmailContextModule("https://email.us-east-1.amazonaws.com", awsSigner)
                : new NoopEmailContextModule(),
        opensearch: OpensearchContextModule.new(
            new OpensearchClient(
                process.env.NODE_ENV === "production"
                    ? `https://${assertExists(
                          options.opensearchHost,
                          "`opensearchHost` option is required in production",
                      )}`
                    : `http://localhost:${parseInt(
                          assertExists(
                              options.opensearchLocalPort,
                              "OpenSearch local port must be provided when running OpenSearch locally",
                          ),
                          10,
                      )}`,
                awsSigner,
            ),
        ),
        jobs: JobsContextModuleWithoutAuthorization.new(
            new JobSender({
                region: "us-east-1",
                queueUrl: assertExists(options.jobQueueUrl, "Missing `jobQueueUrl` option"),
            }),
        ),
        edge: new EdgeServiceContextModule({
            edgeServiceUrl: assertExists(options.edgeServiceUrl, "Missing `edgeServiceUrl` option"),
            tokenAgent,
        }),
    });
}
