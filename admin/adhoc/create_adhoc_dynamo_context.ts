import {join as joinPath} from "path";
import {createAdhocAwsRequestSigner} from "~/admin/adhoc/create_adhoc_aws_request_signer.js";
import {createAdhocTracer} from "~/admin/adhoc/create_adhoc_tracer.js";
import {devEnvPaths} from "~/admin/helpers/dev_env_paths.js";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

const env = parseDotenv();

/**
 * Create a `DynamoContext` for writing adhoc scripts against production data.
 */
export async function createAdhocDynamoContext({
    awsProfile,
}: {
    awsProfile?: string;
} = {}): Promise<DynamoContext & {getAwsSigner: () => AwsRequestSigner}> {
    const tracer = createAdhocTracer();

    const awsSigner = await createAdhocAwsRequestSigner({profile: awsProfile});

    const context = Context.new({
        tracer: new TracerContextModule(tracer),
        dynamo: DynamoContextModule.new({
            url:
                awsProfile !== "local"
                    ? "https://dynamodb.us-east-1.amazonaws.com"
                    : `http://localhost:${parseInt(
                          assertExists(
                              env.DYNAMO_LOCAL_PORT,
                              "DynamoDB local port must be provided when running DynamoDB locally",
                          ),
                          10,
                      )}`,
            signer: awsSigner,
            ensureLocalCachePath:
                awsProfile === "local" ? joinPath(devEnvPaths.cache, "ensure/dynamo") : null,
        }),
    });

    return Object.assign(context, {getAwsSigner: () => awsSigner});
}
