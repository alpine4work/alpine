import {DynamoDBClient} from "@aws-sdk/client-dynamodb";
import {localstackEdgePort} from "~/server/aws/localstack-edge-port";
import {DynamoClient} from "~/server/dynamo/internal/dynamo-client";
import {awsRegion} from "~/server/env/env-variables";

export const globalDynamoClient = new DynamoClient(
    new DynamoDBClient({
        region: awsRegion,
        endpoint: `http://localhost:${localstackEdgePort}`,
    }),
);
