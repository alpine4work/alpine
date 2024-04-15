import {createAdhocDynamoContext} from "~/admin/adhoc/create_adhoc_dynamo_context.js";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {DynamoSystemActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {EdgeServiceContextModule} from "~/server/context/edge_service_context_module.js";
import {
    ServerSystemActionContext,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {
    ServerProcessContext,
    ServerProcessContextModules,
} from "~/server/context/server_process_context.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoBatchContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {NoopEmailContextModule} from "~/server/emails/noop_email_context_module.js";
import {JobSender} from "~/server/jobs/core/job_sender.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {OpensearchClient} from "~/server/opensearch/opensearch_client.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

const env = parseDotenv();

/**
 * Create a `ServerProcessContext` for writing adhoc scripts against production data.
 */
export async function createAdhocServerProcessContext({
    awsProfile,
}: {
    awsProfile?: string;
} = {}): Promise<
    ServerProcessContext & {systemAction: (spaceId: SpaceId) => ServerSystemActionContext}
> {
    const baseContext = await createAdhocDynamoContext({awsProfile});

    const context = baseContext.clone<
        Omit<ServerProcessContextModules, keyof DynamoContextModules>
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
        email: new NoopEmailContextModule(),
        opensearch: OpensearchContextModule.new(
            new OpensearchClient(
                awsProfile !== "local"
                    ? // Hardcode our production OpenSearch domain URL. This URL is not a secret.
                      "https://vpc-opensearchdomai-gw0hdmljxxtp-seltlzvgr54vwz2hynm5c4djiy.us-east-1.es.amazonaws.com"
                    : `http://localhost:${parseInt(
                          assertExists(
                              env.OPENSEARCH_LOCAL_PORT,
                              "OpenSearch local port must be provided when running OpenSearch locally",
                          ),
                          10,
                      )}`,
                baseContext.getAwsSigner(),
            ),
        ),
        jobs: JobsContextModule.new(
            new JobSender({
                region: "us-east-1",
                queueUrl:
                    awsProfile !== "local"
                        ? ((): never => {
                              throw new UnimplementedError("Production job queue URL");
                          })()
                        : `http://localhost:${parseInt(
                              assertExists(
                                  env.SQS_LOCAL_PORT,
                                  "SQS local port must be provided when running SQS locally",
                              ),
                              10,
                          )}/local/JobQueue`,
            }),
        ),
        edge: new EdgeServiceContextModule({
            edgeServiceUrl:
                awsProfile !== "local"
                    ? "https://cyberworlds.dev"
                    : `http://localhost:${parseInt(
                          assertExists(
                              env.EDGE_DEV_PORT,
                              "SQS local port must be provided when running SQS locally",
                          ),
                          10,
                      )}`,
            tokenAgent: "Unimplemented",
        }),
    });

    return Object.assign(context, {
        systemAction: (spaceId: SpaceId) => {
            const actionContext = context.clone<
                Omit<ServerSystemActionContextModules, keyof ServerProcessContextModules>
            >({
                cache: new CacheContextModule(),
                dynamoBatchContext: new DynamoBatchContextModule(),
                actor: DynamoSystemActorContextModule.dangerouslyNew("Adhoc", spaceId),
            });

            return actionContext;
        },
    });
}
