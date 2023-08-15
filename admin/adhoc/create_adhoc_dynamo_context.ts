import {createAdhocAwsClient} from "~/admin/adhoc/create_adhoc_aws_client.js";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";

const env = parseDotenv();

/**
 * Create a `DynamoContext` for writing adhoc scripts against production data.
 */
export async function createAdhocDynamoContext({
    awsProfile,
}: {
    awsProfile?: string;
} = {}): Promise<DynamoContext> {
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

    const awsHttpClient = await createAdhocAwsClient({profile: awsProfile});

    return Context.new({
        tracer: new TracerContextModule(tracer),
        dynamo: DynamoContextModule.new({
            getAwsHttpClient: async () => awsHttpClient,
            awsDynamoUrl: "https://dynamodb.us-east-1.amazonaws.com",
        }),
    });
}
