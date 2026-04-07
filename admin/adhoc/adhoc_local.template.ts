import {createAdhocDynamoContext} from "~/admin/adhoc/create_adhoc_dynamo_context.js";
// eslint-disable-next-line cyberworlds/no-internal-imports
import {getDynamoClient} from "~/server/dynamo/core/internal/get_dynamo_client.js";

export const description = "TODO: describe what this script does";

export async function run() {
    const context = await createAdhocDynamoContext({awsProfile: "local"});
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const client = getDynamoClient(context).getInternalClient();

    // Add your script here...
}
