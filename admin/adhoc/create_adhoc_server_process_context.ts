import {join as joinPath} from "path";
import {createAdhocDynamoContext} from "~/admin/adhoc/create_adhoc_dynamo_context.js";
import {devEnvPaths} from "~/admin/helpers/dev_env_paths.js";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {Session} from "~/server/accounts/accounts_table.js";
import {
    DynamoSessionActorContextModule,
    DynamoSystemActorContextModule,
} from "~/server/accounts/dynamo_actor_context_module.js";
import {
    ServerSessionActionContextModules,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {JobSender} from "~/server/jobs/core/job_sender.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {OpensearchClient} from "~/server/opensearch/opensearch_client.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {NotFoundError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SessionId, SpaceId} from "~/shared/id/types/id_types.js";

const env = parseDotenv();

export type AdhocServerExtraContextModules = {
    opensearch: OpensearchContextModule;
};

export type AdhocServerProcessContextModules = ServerProcessContextModules &
    AdhocServerExtraContextModules;

export type AdhocServerProcessContext = Context<AdhocServerProcessContextModules>;

export type AdhocServerSessionActionContextModules = ServerProcessContextModules &
    AdhocServerExtraContextModules;

export type AdhocServerSessionActionContext = Context<AdhocServerSessionActionContextModules>;

export type AdhocServerSystemActionContextModules = ServerProcessContextModules &
    AdhocServerExtraContextModules;

export type AdhocServerSystemActionContext = Context<AdhocServerSystemActionContextModules>;

/**
 * Create a `ServerProcessContext` for writing adhoc scripts against production data.
 */
export async function createAdhocServerProcessContext({
    awsProfile,
}: {
    awsProfile?: string;
} = {}): Promise<
    AdhocServerProcessContext & {
        systemAction: (spaceId: SpaceId) => AdhocServerSystemActionContext;
        impersonateSessionAction: (
            sessionId: SessionId,
        ) => Promise<AdhocServerSessionActionContext>;
    }
> {
    const baseContext = await createAdhocDynamoContext({awsProfile});

    const context = baseContext.clone<
        Omit<AdhocServerProcessContextModules, keyof DynamoContextModules>
    >({
        process: new ProcessContextModule({
            // Node.js automatically waits for all promises to finish before exiting
            // the process.
            waitUntil: promise => {
                promise.catch(error => {
                    // eslint-disable-next-line no-console
                    console.error(error);
                });
            },
        }),
        opensearch: OpensearchContextModule.new(
            new OpensearchClient({
                url:
                    awsProfile !== "local"
                        ? // Hardcode our production OpenSearch domain URL. This URL is not a secret. The
                          // OpenSearch domain lives in a VPC so you must have VPC access to read/write
                          // to the domain.
                          "https://vpc-cyberworlds-search-xxztfs5jrcb7zbymxuhi5lblsi.us-east-1.es.amazonaws.com"
                        : (() => {
                              const url = `http://localhost:${parseInt(
                                  assertExists(
                                      env.OPENSEARCH_LOCAL_PORT,
                                      "OpenSearch local port must be provided when running OpenSearch locally",
                                  ),
                                  10,
                              )}`;

                              return url;
                          })(),
                signer: baseContext.getAwsSigner(),
                ensureLocalCachePath:
                    awsProfile === "local"
                        ? joinPath(devEnvPaths.cache, "ensure/opensearch")
                        : null,
            }),
        ),
        jobs: JobsContextModule.new(
            new JobSender({
                region: "us-east-1",
                queueUrl:
                    awsProfile !== "local"
                        ? // Hard code our production SQS queue URL. This URL is not a secret. The SQS
                          // queue is protected by AWS IAM. You must have appropriate credentials to
                          // send/receive messages.
                          "https://sqs.us-east-1.amazonaws.com/989696362649/CyberworldsStack-SqsJobQueue62388F96-wPfW5zN0HinU"
                        : `http://localhost:${parseInt(
                              assertExists(
                                  env.SQS_LOCAL_PORT,
                                  "SQS local port must be provided when running SQS locally",
                              ),
                              10,
                          )}/local/JobQueue`,
                fileProcessorQueueUrl:
                    awsProfile !== "local"
                        ? // Hard code our production SQS queue URL. This URL is not a secret. The SQS
                          // queue is protected by AWS IAM. You must have appropriate credentials to
                          // send/receive messages.
                          "https://sqs.us-east-1.amazonaws.com/989696362649/CyberworldsStack-SqsFileProcessorJobQueue551DBCF8-SOLGZvxawVmH"
                        : `http://localhost:${parseInt(
                              assertExists(
                                  env.SQS_LOCAL_PORT,
                                  "SQS local port must be provided when running SQS locally",
                              ),
                              10,
                          )}/local/FileProcessorJobQueue`,
            }),
        ),
    });

    return Object.assign(context, {
        systemAction: (spaceId: SpaceId) => {
            const actionContext = context.clone<
                Omit<ServerSystemActionContextModules, keyof ServerProcessContextModules>
            >({
                cache: CacheContextModule.new(),
                batch: BatchContextModule.new(),
                actor: DynamoSystemActorContextModule.dangerouslyNew("Adhoc", spaceId),
            });

            return actionContext;
        },
        impersonateSessionAction: async (sessionId: SessionId) => {
            const session = await Session.getIfExists(context, sessionId, null);
            if (!session) throw new NotFoundError("Session not found");

            const actionContext = context.clone<
                Omit<ServerSessionActionContextModules, keyof ServerProcessContextModules>
            >({
                cache: CacheContextModule.new(),
                batch: BatchContextModule.new(),
                actor: DynamoSessionActorContextModule.dangerouslyNew("Adhoc", session),
            });

            return actionContext;
        },
    });
}
