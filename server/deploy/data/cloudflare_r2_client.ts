import {
    GetObjectCommand,
    GetObjectCommandInput,
    GetObjectCommandOutput,
    PutObjectCommand,
    PutObjectCommandInput,
    PutObjectCommandOutput,
    S3Client,
} from "@aws-sdk/client-s3";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

/**
 * Client to [Cloudflare's R2 object storage service][1].
 *
 * Our client class provides automatic tracing for Cloudflare actions. The API
 * style is similar to `DynamoClientInternal`.
 *
 * [1]: https://developers.cloudflare.com/r2/
 */
export class CloudflareR2Client {
    // We use an AWS S3 client for accessing Cloudflare R2 (which is API compatible
    // with S3) because the S3 client is well known and well maintained. Cloudflare
    // does not provide their own client for Node.js besides the [client available
    // in Cloudflare Workers][1].
    //
    // Directly making HTTP requests with `aws4fetch` isn't convenient since [HTTP
    // responses from Cloudflare R2 are in XML][2].
    //
    // [1]: https://developers.cloudflare.com/r2/api/workers/workers-api-usage/
    // [2]: https://developers.cloudflare.com/r2/examples/aws/aws4fetch/
    private readonly _client: S3Client;

    constructor({
        accountId,
        accessKeyId,
        secretAccessKey,
    }: {
        accountId: string;
        accessKeyId: string;
        secretAccessKey: string;
    }) {
        this._client = new S3Client({
            region: "auto",
            endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId,
                secretAccessKey,
            },
        });
    }

    /**
     * S3 [`GetObject`][1] action. See [Cloudflare R2 S3 API compatibility
     * notes][2].
     *
     * [1]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
     * [2]: https://developers.cloudflare.com/r2/api/s3/api/
     */
    public GetObject(
        tracer: TracerBase,
        input: GetObjectCommandInput,
    ): Promise<GetObjectCommandOutput> {
        let spanName = "Cloudflare R2 GetObject";

        if (input.Bucket !== undefined) {
            spanName += ` ${input.Bucket}`;
        }

        return tracer.withSpan(spanName, span => {
            span.addData({
                cloudflare: {
                    r2: {
                        action: "GetObject",
                        bucket: input.Bucket,
                        objectKey: input.Key,
                    },
                },
            });

            return this._client.send(new GetObjectCommand(input));
        });
    }

    /**
     * S3 [`PutObject`][1] action. See [Cloudflare R2 S3 API compatibility
     * notes][2].
     *
     * [1]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html
     * [2]: https://developers.cloudflare.com/r2/api/s3/api/
     */
    public PutObject(
        tracer: TracerBase,
        input: PutObjectCommandInput,
    ): Promise<PutObjectCommandOutput> {
        let spanName = "Cloudflare R2 PutObject";

        if (input.Bucket !== undefined) {
            spanName += ` ${input.Bucket}`;
        }

        return tracer.withSpan(spanName, span => {
            span.addData({
                cloudflare: {
                    r2: {
                        action: "PutObject",
                        bucket: input.Bucket,
                        objectKey: input.Key,
                    },
                },
            });

            return this._client.send(new PutObjectCommand(input));
        });
    }
}
