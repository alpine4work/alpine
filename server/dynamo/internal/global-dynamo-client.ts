import {DynamoDBClient} from "@aws-sdk/client-dynamodb";
import {DynamoClient} from "~/server/dynamo/internal/dynamo-client";
import {assert} from "~/shared/helpers/control/assert";

assert(process.env.LOCALSTACK_EDGE_PORT);
const localstackEdgePort = parseInt(process.env.LOCALSTACK_EDGE_PORT, 10);

export const globalDynamoClient = new DynamoClient(
    new DynamoDBClient({
        region: "us-east-1",
        endpoint: `http://localhost:${localstackEdgePort}`,
    }),
);
