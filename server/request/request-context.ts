import {DynamoDBClient} from "@aws-sdk/client-dynamodb";
import {DynamoTransactionEntry} from "~/server/dynamo/helpers/dynamo-transaction-entry";
// The request context currently owns the DynamoDB client object.
// eslint-disable-next-line no-internal-imports
import {DynamoClient} from "~/server/dynamo/internal/dynamo-client";
import {assert} from "~/shared/helpers/control/assert";
import {Id, generateId} from "~/shared/id/id";

/**
 * Context for a single request executing against our server.
 */
export class RequestContext {
    /**
     * The client generates a unique id for every request. We use this id for
     * logging and ensuring write idempotency.
     */
    public readonly requestId: Id;

    /**
     * An internal reference to the DynamoDB client used for reading and
     * writing data.
     *
     * This should only be accessible to code in the `server/dynamo` folder! So we
     * have a `getDynamoClientFromRequestContext()` function in
     * `server/dynamo/internal` which will force this visibility.
     */
    private readonly _dynamoClient: DynamoClient;

    private constructor({requestId, dynamoClient}: {requestId: Id; dynamoClient: DynamoClient}) {
        this.requestId = requestId;
        this._dynamoClient = dynamoClient;
    }

    /**
     * Creates a new test request context. Each test request context has a
     * different request id.
     */
    public static test() {
        return new RequestContext({
            requestId: generateId(),
            dynamoClient: getDynamoClientForTest(),
        });
    }

    /**
     * Executes a transaction against DynamoDB using [`TransactWriteItems`][1].
     *
     * We pass our request context's `requestId` as the `ClientRequestToken`. That
     * way if this request is retried, DynamoDB will ensure that the transaction is
     * idempotent.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html
     */
    public executeTransaction(entries: ReadonlyArray<DynamoTransactionEntry>): Promise<void> {
        return this._dynamoClient.executeTransaction(entries, {clientRequestToken: this.requestId});
    }
}

let dynamoClientForTest: DynamoClient | null = null;

function getDynamoClientForTest(): DynamoClient {
    assert(process.env.NODE_ENV === "test");

    if (dynamoClientForTest === null) {
        assert(process.env.LOCALSTACK_EDGE_PORT);
        const localstackEdgePort = parseInt(process.env.LOCALSTACK_EDGE_PORT, 10);

        dynamoClientForTest = new DynamoClient(
            new DynamoDBClient({
                region: "us-east-1",
                endpoint: `http://localhost:${localstackEdgePort}`,
            }),
        );
    }

    return dynamoClientForTest;
}
