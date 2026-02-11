import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {DataLossError, UnavailableError} from "~/shared/error/error.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

/**
 * Input for a single record in a PutRecords request [1].
 *
 * [1]: https://docs.aws.amazon.com/kinesis/latest/APIReference/API_PutRecords.html#API_PutRecords_RequestParameters
 */
export type KinesisPutRecordsRequestEntry = {
    /**
     * The data blob to put into the record. Base64-encoded when serialized.
     */
    readonly data: Uint8Array;

    /**
     * Determines which shard in the stream the data record is assigned to. Partition keys are
     * Unicode strings with a maximum length of 256 characters.
     */
    readonly partitionKey: string;
};

/**
 * Output for a single record in a PutRecords response [1].
 *
 * [1]: https://docs.aws.amazon.com/kinesis/latest/APIReference/API_PutRecords.html#API_PutRecords_ResponseSyntax
 */
export type KinesisPutRecordsResultEntry = {
    /**
     * The sequence number for an individual record result.
     */
    readonly sequenceNumber?: string;

    /**
     * The shard ID for an individual record result.
     */
    readonly shardId?: string;

    /**
     * The error code [1] for an individual record result. Present if the record failed.
     *
     * [1]: https://docs.aws.amazon.com/kinesis/latest/APIReference/API_PutRecords.html#API_PutRecords_Errors
     */
    readonly errorCode?: string;

    /**
     * The error message [1] for an individual record result. Present if the record failed.
     *
     * [1]: https://docs.aws.amazon.com/kinesis/latest/APIReference/API_PutRecords.html#API_PutRecords_Errors
     */
    readonly errorMessage?: string;
};

/**
 * Output from a PutRecords request [1].
 *
 * [1]: https://docs.aws.amazon.com/kinesis/latest/APIReference/API_PutRecords.html#API_PutRecords_ResponseElements
 */
export type KinesisPutRecordsOutput = {
    /**
     * The number of unsuccessfully processed records in a PutRecords request.
     */
    readonly failedRecordCount: number;

    /**
     * An array of successfully and unsuccessfully processed record results.
     */
    readonly records: ReadonlyArray<KinesisPutRecordsResultEntry>;

    /**
     * The encryption type used on the records. Present when encryption is enabled.
     */
    readonly encryptionType?: "NONE" | "KMS";
};

/**
 * Maximum number of records that can be sent in a single PutRecords request.
 * https://docs.aws.amazon.com/kinesis/latest/APIReference/API_PutRecords.html
 */
const MAX_RECORDS_PER_PUT = 500;

/**
 * Type-safe Kinesis client that works in both AWS and Cloudflare environments.
 *
 * This client directly executes Kinesis actions using HTTP requests signed with AWS Signature
 * Version 4. It follows the same pattern as our DynamoDB client, using `aws4fetch` for signing
 * instead of the AWS SDK.
 *
 * This is necessary because the AWS SDK doesn't work in Cloudflare Workers, and we need a
 * consistent client that works in both environments.
 */
export class KinesisClient {
    private readonly _url: string;
    private readonly _streamName: string;
    private readonly _signer: AwsRequestSigner;

    // TODO(ifitzsimmons, ##local-kinesis): We don't have a local Kinesis stream at the moment,
    // so if `PutRecords` is called in a non-prod environment, we no-op. Right now, Kinesis
    // is only used to get our application logs into S3, so there's no point in replicating
    // that data pipeline in development.
    private readonly _isLocal: boolean;

    constructor(url: string, streamName: string, signer: AwsRequestSigner) {
        this._url = url;
        this._streamName = streamName;

        // Use the default AWS request signer if no signer is provided.
        this._signer = signer;

        this._isLocal = process.env.NODE_ENV !== "production";
    }

    /**
     * Kinesis [`PutRecords`][1] action.
     *
     * Writes multiple data records into a Kinesis data stream in a single call. Each record
     * consists of a partition key and data blob.
     *
     * Records are automatically chunked into batches of 500 (the Kinesis limit) and sent
     * sequentially. Results are aggregated across all batches.
     *
     * [1]: https://docs.aws.amazon.com/kinesis/latest/APIReference/API_PutRecords.html
     */
    public async PutRecords(
        tracer: TracerBase,
        records: ReadonlyArray<KinesisPutRecordsRequestEntry>,
    ): Promise<KinesisPutRecordsOutput> {
        if (this._isLocal) return {failedRecordCount: 0, records: []};

        // Chunk records into batches of MAX_RECORDS_PER_PUT.
        const chunks: Array<ReadonlyArray<KinesisPutRecordsRequestEntry>> = [];
        for (let i = 0; i < records.length; i += MAX_RECORDS_PER_PUT) {
            chunks.push(records.slice(i, i + MAX_RECORDS_PER_PUT));
        }

        // Process chunks sequentially to avoid overwhelming Kinesis.
        let failedRecordCount = 0;
        const allRecords: Array<KinesisPutRecordsResultEntry> = [];
        let encryptionType: "NONE" | "KMS" | undefined;

        for (const chunk of chunks) {
            // A shard can handle up to 1000 writes per second. By serializing these
            // requests and running within `retryWithExponentialBackoff`, we should
            // ensure that we don't throttle the shard.
            const result = await this._putRecordsChunk(tracer, chunk);
            failedRecordCount += result.failedRecordCount;
            allRecords.push(...result.records);
            encryptionType = result.encryptionType ?? encryptionType;
        }

        return {failedRecordCount, records: allRecords, encryptionType};
    }

    /**
     * Sends a single chunk of records to Kinesis. The chunk must be at most 500 records.
     */
    private _putRecordsChunk(
        tracer: TracerBase,
        records: ReadonlyArray<KinesisPutRecordsRequestEntry>,
    ): Promise<KinesisPutRecordsOutput> {
        return retryWithExponentialBackoff(retry => {
            const spanName = `Kinesis PutRecords ${this._streamName}`;

            return tracer.withSpan(spanName, async span => {
                // Convert records to the format expected by the Kinesis API.
                // Data must be base64-encoded.
                const apiRecords = records.map(record => ({
                    Data: encodeBase64(record.data),
                    PartitionKey: record.partitionKey,
                }));

                let request = new Request(this._url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-amz-json-1.1",
                        "X-Amz-Target": "Kinesis_20131202.PutRecords",
                    },
                    body: JSON.stringify({
                        StreamName: this._streamName,
                        Records: apiRecords,
                    }),
                });

                request = await this._signer.sign(request, span);

                let response;

                try {
                    // eslint-disable-next-line cyberworlds/no-global-fetch
                    response = await fetch(request).catch(error => {
                        // Classify network errors as unavailable.
                        throw new UnavailableError(
                            error instanceof Error ? error.message : String(error),
                        );
                    });
                } catch (error) {
                    throw retry(error);
                }

                // API Response elements
                // https://docs.aws.amazon.com/kinesis/latest/APIReference/API_PutRecords.html#API_PutRecords_ResponseElements
                const output: {
                    FailedRecordCount?: number;
                    Records?: Array<{
                        SequenceNumber?: string;
                        ShardId?: string;
                        ErrorCode?: string;
                        ErrorMessage?: string;
                    }>;
                    EncryptionType?: "NONE" | "KMS";
                    __type?: string;
                    message?: string;
                } = await response.json();

                if (response.status !== 200) {
                    // Extract error type from response.
                    let errorType = output.__type;
                    if (typeof errorType === "string" && errorType.includes("#")) {
                        errorType = errorType.split("#")[1];
                    }

                    const error = new DataLossError(
                        `Kinesis PutRecords failed: ${errorType ?? "Unknown"} - ${output.message ?? "No message"}`,
                    );

                    // Retry on 5xx errors or throttling.
                    if (
                        response.status >= 500 ||
                        errorType === "ProvisionedThroughputExceededException" ||
                        errorType === "KMSThrottlingException"
                    ) {
                        throw retry(error);
                    }

                    throw error;
                }

                return {
                    failedRecordCount: output.FailedRecordCount ?? 0,
                    records: (output.Records ?? []).map(record => ({
                        sequenceNumber: record.SequenceNumber,
                        shardId: record.ShardId,
                        errorCode: record.ErrorCode,
                        errorMessage: record.ErrorMessage,
                    })),
                    encryptionType: output.EncryptionType,
                };
            });
        });
    }
}
