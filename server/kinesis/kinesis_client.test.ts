import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {KinesisClient, KinesisPutRecordsRequestEntry} from "~/server/kinesis/kinesis_client.js";

// Store original fetch and NODE_ENV
const originalFetch = globalThis.fetch;
const originalNodeEnv = process.env.NODE_ENV;

// Mock signer that passes through requests unchanged
function createMockSigner(): AwsRequestSigner {
    return {
        sign: async (request: Request) => request,
    } as unknown as AwsRequestSigner;
}

// Helper to create test records
function createTestRecords(count: number): Array<KinesisPutRecordsRequestEntry> {
    return Array.from({length: count}, (_, i) => ({
        data: {record: `record-${i}`},
        partitionKey: `partition-${i}`,
    }));
}

// Helper to create a mock Kinesis response
function createKinesisResponse(
    records: Array<{
        SequenceNumber?: string;
        ShardId?: string;
        ErrorCode?: string;
        ErrorMessage?: string;
    }>,
): Response {
    const failedRecordCount = records.filter(r => r.ErrorCode).length;
    return new Response(
        JSON.stringify({
            FailedRecordCount: failedRecordCount,
            Records: records,
            EncryptionType: "NONE",
        }),
        {status: 200, headers: {"Content-Type": "application/json"}},
    );
}

beforeEach(() => {
    // Force production mode so \_isLocal is false
    process.env.NODE_ENV = "production";
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.NODE_ENV = originalNodeEnv;
});

test("PutRecords succeeds when all records succeed", async () => {
    const fetchCalls: Array<Request> = [];

    globalThis.fetch = async (input: RequestInfo | URL) => {
        const request = input as Request;
        fetchCalls.push(request);

        return createKinesisResponse([
            {SequenceNumber: "seq-0", ShardId: "shard-0"},
            {SequenceNumber: "seq-1", ShardId: "shard-0"},
        ]);
    };

    const client = new KinesisClient(
        "https://kinesis.us-east-1.amazonaws.com",
        "test-stream",
        createMockSigner(),
    );

    const result = await client.PutRecords(createTestRecords(2));

    expect(fetchCalls.length).toEqual(1);
    expect(result.failedRecordCount).toEqual(0);
    expect(result.records.length).toEqual(2);
    expect(result.records[0]).toMatchObject({sequenceNumber: "seq-0", shardId: "shard-0"});
});

test("PutRecords retries on 5xx error", async () => {
    let attemptCount = 0;

    globalThis.fetch = async () => {
        attemptCount++;

        if (attemptCount === 1) {
            return new Response(
                JSON.stringify({__type: "ServiceUnavailable", message: "Service unavailable"}),
                {status: 503},
            );
        }

        return createKinesisResponse([{SequenceNumber: "seq-0", ShardId: "shard-0"}]);
    };

    const client = new KinesisClient(
        "https://kinesis.us-east-1.amazonaws.com",
        "test-stream",
        createMockSigner(),
    );

    const result = await client.PutRecords(createTestRecords(1));

    expect(attemptCount).toEqual(2);
    expect(result.failedRecordCount).toEqual(0);
    expect(result.records.length).toEqual(1);
});

test("PutRecords retries only failed records on partial throttling failure", async () => {
    let attemptCount = 0;
    const requestBodies: Array<{Records: Array<{PartitionKey: string}>}> = [];

    globalThis.fetch = async (input: RequestInfo | URL) => {
        attemptCount++;
        const request = input as Request;
        const body = await request.clone().json();
        requestBodies.push(body);

        if (attemptCount === 1) {
            // First attempt: records 0 and 2 succeed, record 1 is throttled
            return createKinesisResponse([
                {SequenceNumber: "seq-0", ShardId: "shard-0"},
                {
                    ErrorCode: "ProvisionedThroughputExceededException",
                    ErrorMessage: "Rate exceeded",
                },
                {SequenceNumber: "seq-2", ShardId: "shard-0"},
            ]);
        }

        // Second attempt: only the throttled record should be retried
        return createKinesisResponse([{SequenceNumber: "seq-1", ShardId: "shard-0"}]);
    };

    const client = new KinesisClient(
        "https://kinesis.us-east-1.amazonaws.com",
        "test-stream",
        createMockSigner(),
    );

    const result = await client.PutRecords(createTestRecords(3));

    expect(attemptCount).toEqual(2);

    // First request should have all 3 records
    expect(requestBodies[0]!.Records.length).toEqual(3);

    // Second request should only have the failed record (partition-1)
    expect(requestBodies[1]!.Records.length).toEqual(1);
    expect(requestBodies[1]!.Records[0]!.PartitionKey).toEqual("partition-1");

    // All records should eventually succeed
    expect(result.failedRecordCount).toEqual(0);
    expect(result.records.length).toEqual(3);
});

test("PutRecords retries only failed records on InternalFailureException", async () => {
    let attemptCount = 0;
    const requestBodies: Array<{Records: Array<{PartitionKey: string}>}> = [];

    globalThis.fetch = async (input: RequestInfo | URL) => {
        attemptCount++;
        const request = input as Request;
        const body = await request.clone().json();
        requestBodies.push(body);

        if (attemptCount === 1) {
            return createKinesisResponse([
                {SequenceNumber: "seq-0", ShardId: "shard-0"},
                {ErrorCode: "InternalFailureException", ErrorMessage: "Internal error"},
            ]);
        }

        return createKinesisResponse([{SequenceNumber: "seq-1", ShardId: "shard-0"}]);
    };

    const client = new KinesisClient(
        "https://kinesis.us-east-1.amazonaws.com",
        "test-stream",
        createMockSigner(),
    );

    const result = await client.PutRecords(createTestRecords(2));

    expect(attemptCount).toEqual(2);
    expect(requestBodies[1]!.Records.length).toEqual(1);
    expect(requestBodies[1]!.Records[0]!.PartitionKey).toEqual("partition-1");
    expect(result.failedRecordCount).toEqual(0);
});

test("PutRecords does not retry non-retryable record errors", async () => {
    let attemptCount = 0;

    globalThis.fetch = async () => {
        attemptCount++;

        return createKinesisResponse([
            {SequenceNumber: "seq-0", ShardId: "shard-0"},
            {ErrorCode: "ValidationError", ErrorMessage: "Invalid data"},
        ]);
    };

    const client = new KinesisClient(
        "https://kinesis.us-east-1.amazonaws.com",
        "test-stream",
        createMockSigner(),
    );

    const result = await client.PutRecords(createTestRecords(2));

    // Should not retry since ValidationError is not retryable
    expect(attemptCount).toEqual(1);
    expect(result.failedRecordCount).toEqual(1);
    expect(result.records.length).toEqual(2);
    expect(result.records[1]).toMatchObject({
        errorCode: "ValidationError",
        errorMessage: "Invalid data",
    });
});

test("PutRecords handles multiple retry rounds", async () => {
    let attemptCount = 0;
    const requestBodies: Array<{Records: Array<{PartitionKey: string}>}> = [];

    globalThis.fetch = async (input: RequestInfo | URL) => {
        attemptCount++;
        const request = input as Request;
        const body = await request.clone().json();
        requestBodies.push(body);

        if (attemptCount === 1) {
            // First attempt: 2 out of 4 are throttled
            return createKinesisResponse([
                {SequenceNumber: "seq-0", ShardId: "shard-0"},
                {
                    ErrorCode: "ProvisionedThroughputExceededException",
                    ErrorMessage: "Rate exceeded",
                },
                {SequenceNumber: "seq-2", ShardId: "shard-0"},
                {
                    ErrorCode: "ProvisionedThroughputExceededException",
                    ErrorMessage: "Rate exceeded",
                },
            ]);
        }

        if (attemptCount === 2) {
            // Second attempt: 1 still throttled
            return createKinesisResponse([
                {SequenceNumber: "seq-1", ShardId: "shard-0"},
                {
                    ErrorCode: "ProvisionedThroughputExceededException",
                    ErrorMessage: "Rate exceeded",
                },
            ]);
        }

        // Third attempt: all succeed
        return createKinesisResponse([{SequenceNumber: "seq-3", ShardId: "shard-0"}]);
    };

    const client = new KinesisClient(
        "https://kinesis.us-east-1.amazonaws.com",
        "test-stream",
        createMockSigner(),
    );

    const result = await client.PutRecords(createTestRecords(4));

    expect(attemptCount).toEqual(3);
    expect(requestBodies[0]!.Records.length).toEqual(4);
    expect(requestBodies[1]!.Records.length).toEqual(2);
    expect(requestBodies[2]!.Records.length).toEqual(1);
    expect(result.failedRecordCount).toEqual(0);
    expect(result.records.length).toEqual(4);
});

test("PutRecords handles mix of retryable and non-retryable errors", async () => {
    let attemptCount = 0;
    const requestBodies: Array<{Records: Array<{PartitionKey: string}>}> = [];

    globalThis.fetch = async (input: RequestInfo | URL) => {
        attemptCount++;
        const request = input as Request;
        const body = await request.clone().json();
        requestBodies.push(body);

        if (attemptCount === 1) {
            return createKinesisResponse([
                {SequenceNumber: "seq-0", ShardId: "shard-0"},
                {
                    ErrorCode: "ProvisionedThroughputExceededException",
                    ErrorMessage: "Rate exceeded",
                },
                {ErrorCode: "ValidationError", ErrorMessage: "Invalid data"},
            ]);
        }

        // Only the throttled record should be retried
        return createKinesisResponse([{SequenceNumber: "seq-1", ShardId: "shard-0"}]);
    };

    const client = new KinesisClient(
        "https://kinesis.us-east-1.amazonaws.com",
        "test-stream",
        createMockSigner(),
    );

    const result = await client.PutRecords(createTestRecords(3));

    expect(attemptCount).toEqual(2);
    expect(requestBodies[1]!.Records.length).toEqual(1);
    expect(requestBodies[1]!.Records[0]!.PartitionKey).toEqual("partition-1");

    // 1 non-retryable error should remain
    expect(result.failedRecordCount).toEqual(1);
    expect(result.records.length).toEqual(3);
});

test("PutRecords returns partial results with original error codes when retries exhausted", async () => {
    let attemptCount = 0;

    globalThis.fetch = async (input: RequestInfo | URL) => {
        attemptCount++;
        const request = input as Request;
        const body = await request.clone().json();
        const recordCount = body.Records.length;

        if (attemptCount === 1) {
            // First attempt: first record succeeds, second throttled
            return createKinesisResponse([
                {SequenceNumber: "seq-0", ShardId: "shard-0"},
                {
                    ErrorCode: "ProvisionedThroughputExceededException",
                    ErrorMessage: "Rate exceeded",
                },
            ]);
        }

        // Subsequent attempts: only the failed record is retried, and it keeps failing
        return createKinesisResponse(
            Array.from({length: recordCount}, () => ({
                ErrorCode: "ProvisionedThroughputExceededException",
                ErrorMessage: "Rate exceeded",
            })),
        );
    };

    const client = new KinesisClient(
        "https://kinesis.us-east-1.amazonaws.com",
        "test-stream",
        createMockSigner(),
    );

    // Use maxRetryAttemptCount=2 so we exhaust retries quickly
    const result = await client.PutRecords(createTestRecords(2), 2);

    // Should have attempted twice then given up
    expect(attemptCount).toEqual(2);

    // Should return both records - one success, one failure with original error
    expect(result.records.length).toEqual(2);
    expect(result.failedRecordCount).toEqual(1);

    // First record succeeded
    expect(result.records[0]).toMatchObject({sequenceNumber: "seq-0", shardId: "shard-0"});

    // Second record failed with the original Kinesis error code (not a generic error)
    expect(result.records[1]).toMatchObject({
        errorCode: "ProvisionedThroughputExceededException",
        errorMessage: "Rate exceeded",
    });
});

test("PutRecords no-ops in local environment", async () => {
    process.env.NODE_ENV = "development";
    let fetchCalled = false;

    globalThis.fetch = async () => {
        fetchCalled = true;
        return createKinesisResponse([]);
    };

    const client = new KinesisClient(
        "https://kinesis.us-east-1.amazonaws.com",
        "test-stream",
        createMockSigner(),
    );

    const result = await client.PutRecords(createTestRecords(2));

    expect(fetchCalled).toEqual(false);
    expect(result.failedRecordCount).toEqual(0);
    expect(result.records.length).toEqual(0);
});
