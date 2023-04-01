import {createAdhocAwsClient} from "~/admin/adhoc/create_adhoc_aws_client";
import {parseDotenv} from "~/admin/helpers/parse_dotenv";
import {DynamoContext} from "~/server/dynamo/context/dynamo_context";
import {DynamoContextModule} from "~/server/dynamo/dynamo_context_module";
import {createServerTracer} from "~/server/tracer/server_tracer";
import {Context} from "~/shared/context/context";
import {TracerContextModule} from "~/shared/context/tracer_context_module";

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
        // TODO(calebmer): If we are running an adhoc script against our production
        // database then events should go to our production Honeycomb environment?
        env,
        // Node.js automatically waits for all promises to finish before exiting
        // the process.
        waitUntil: promise => {
            promise.catch(error => {
                // eslint-disable-next-line no-console
                console.error(error);
            });
        },
    });

    const awsClient = await createAdhocAwsClient({profile: awsProfile});

    return Context.new({
        tracer: new TracerContextModule(tracer),
        dynamo: DynamoContextModule.new(awsClient, "https://dynamodb.us-east-1.amazonaws.com"),
    });
}
