import {join as joinPath} from "path";
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
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {createServerProcessContextModule} from "~/server/node/create_server_process_context_module.js";
import {ShutdownManager, ShutdownManagerBase} from "~/server/node/shutdown_manager.js";
import {OpensearchClient} from "~/server/opensearch/opensearch_client.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

export const serverProcessContextParseOptions = {
    ensureLocalCachePath: {type: "string"},
    dynamoLocalPort: {type: "string"},
    opensearchLocalPort: {type: "string"},
    opensearchHost: {type: "string"},
    jobQueueUrl: {type: "string"},
    edgeServiceUrl: {type: "string"},
} as const;

export type ServerProcessContextOptions = {
    readonly ensureLocalCachePath?: string;
    readonly dynamoLocalPort?: string;
    readonly opensearchLocalPort?: string;
    readonly opensearchHost?: string;
    readonly jobQueueUrl?: string;
    readonly edgeServiceUrl?: string;
};

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
    shutdownManager,
    tokenAgent,
    awsSigner,
    options,
}: {
    tracer: TracerRoot;
    shutdownManager: ShutdownManagerBase;
    tokenAgent: TokenAgent | "Unimplemented";
    awsSigner: AwsRequestSigner;
    options: ServerProcessContextOptions;
}): ServerProcessContext {
    return Context.new<ServerProcessContextModules>({
        process: createServerProcessContextModule({tracer, shutdownManager}),
        tracer: new TracerContextModule(tracer),
        dynamo: DynamoContextModule.new({
            url:
                process.env.NODE_ENV === "production"
                    ? "https://dynamodb.us-east-1.amazonaws.com"
                    : `http://localhost:${parseInt(
                          assertExists(
                              options.dynamoLocalPort,
                              "`dynamoLocalPort` option is required in development",
                          ),
                          10,
                      )}`,
            signer: awsSigner,
            ensureLocalCachePath:
                process.env.NODE_ENV !== "production"
                    ? joinPath(
                          assertExists(
                              options.ensureLocalCachePath,
                              "`ensureLocalCachePath` option is required in development",
                          ),
                          "dynamo",
                      )
                    : null,
        }),
        email:
            process.env.NODE_ENV === "production"
                ? new SesEmailContextModule("https://email.us-east-1.amazonaws.com", awsSigner)
                : new NoopEmailContextModule(),
        opensearch: OpensearchContextModule.new(
            new OpensearchClient({
                url:
                    process.env.NODE_ENV === "production"
                        ? `https://${assertExists(
                              options.opensearchHost,
                              "`opensearchHost` option is required in production",
                          )}`
                        : `http://localhost:${parseInt(
                              assertExists(
                                  options.opensearchLocalPort,
                                  "`opensearchLocalPort` option is required in development",
                              ),
                              10,
                          )}`,
                signer: awsSigner,
                ensureLocalCachePath:
                    process.env.NODE_ENV !== "production"
                        ? joinPath(
                              assertExists(
                                  options.ensureLocalCachePath,
                                  "`ensureLocalCachePath` option is required in development",
                              ),
                              "opensearch",
                          )
                        : null,
            }),
        ),
        jobs: JobsContextModule.new(
            new JobSender({
                region: "us-east-1",
                queueUrl: assertExists(options.jobQueueUrl, "`jobQueueUrl` option is required"),
            }),
        ),
        edge: new EdgeServiceContextModule({
            edgeServiceUrl: assertExists(
                options.edgeServiceUrl,
                "`edgeServiceUrl` option is required",
            ),
            tokenAgent,
        }),
    });
}
