import {createAdhocAwsRequestSigner} from "~/admin/adhoc/create_adhoc_aws_request_signer.js";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const env = parseDotenv();

/**
 * Create a `DynamoContext` for writing adhoc scripts against production data.
 */
export async function createAdhocDynamoContext({
    awsProfile,
}: {
    awsProfile?: string;
} = {}): Promise<DynamoContext & {getAwsSigner: () => AwsRequestSigner}> {
    const tracer = createServerTracer({
        serviceName: "Adhoc",
        jsHost: "Node",
        // TODO(calebmer): If we are running an adhoc script against our production
        // database then events should go to our production Honeycomb environment?
        honeycombApiKey: env.HONEYCOMB_API_KEY,
        // Node.js automatically waits for all promises to finish before exiting
        // the process.
        waitUntil: promise => {
            promise.catch(error => {
                // eslint-disable-next-line no-console
                console.error(error);
            });
        },
    });

    const awsSigner = await createAdhocAwsRequestSigner({profile: awsProfile});

    const context = Context.new({
        tracer: new TracerContextModule(tracer),
        dynamo: DynamoContextModule.new(
            awsProfile !== "local"
                ? "https://dynamodb.us-east-1.amazonaws.com"
                : `http://localhost:${parseInt(
                      assertExists(
                          env.DYNAMO_LOCAL_PORT,
                          "DynamoDB local port must be provided when running DynamoDB locally",
                      ),
                      10,
                  )}`,
            awsSigner,
        ),
    });

    return Object.assign(context, {getAwsSigner: () => awsSigner});
}
