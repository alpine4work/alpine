import {
    DeleteObjectCommandInput,
    DeleteObjectCommandOutput,
    GetObjectCommandInput,
    GetObjectCommandOutput,
    HeadObjectCommandInput,
    HeadObjectCommandOutput,
    PutObjectCommandInput,
    PutObjectCommandOutput,
} from "@aws-sdk/client-s3";
import {CloudflareR2ClientBase} from "~/server/cloudflare/r2/cloudflare_r2_client.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";

export class CloudflareR2ContextModule
    extends ContextModuleBase<{tracer: TracerContextModule}>
    implements ForkableContextModuleBase
{
    private readonly _client: CloudflareR2ClientBase;

    constructor(client: CloudflareR2ClientBase) {
        super();
        this._client = client;
    }

    public isMiniflare() {
        return this._client.isMiniflare();
    }

    public isEmptyForTest() {
        return this._client.isEmptyForTest();
    }

    /**
     * S3 [`GetObject`][1] action. See [Cloudflare R2 S3 API compatibility notes][2].
     *
     * [1]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
     * [2]: https://developers.cloudflare.com/r2/api/s3/api/
     */
    public GetObject(
        input: GetObjectCommandInput,
        options?: {signal?: AbortSignal},
    ): Promise<GetObjectCommandOutput> {
        return this._client.GetObject(this._context.tracer.getTracer(), input, options);
    }

    /**
     * S3 [`HeadObject`][1] action. See [Cloudflare R2 S3 API compatibility notes][2].
     *
     * [1]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html
     * [2]: https://developers.cloudflare.com/r2/api/s3/api/
     */
    public HeadObject(input: HeadObjectCommandInput): Promise<HeadObjectCommandOutput> {
        return this._client.HeadObject(this._context.tracer.getTracer(), input);
    }

    /**
     * S3 [`PutObject`][1] action. See [Cloudflare R2 S3 API compatibility notes][2].
     *
     * [1]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html
     * [2]: https://developers.cloudflare.com/r2/api/s3/api/
     */
    public PutObject(
        input: PutObjectCommandInput,
        options?: {signal?: AbortSignal},
    ): Promise<PutObjectCommandOutput> {
        return this._client.PutObject(this._context.tracer.getTracer(), input, options);
    }

    /**
     * S3 [`DeleteObject`][1] action. See [Cloudflare R2 S3 API compatibility
     * notes][2].
     *
     * [1]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html
     * [2]: https://developers.cloudflare.com/r2/api/s3/api/
     */
    public DeleteObject(input: DeleteObjectCommandInput): Promise<DeleteObjectCommandOutput> {
        return this._client.DeleteObject(this._context.tracer.getTracer(), input);
    }

    /**
     * Get a [pre-signed URL][1] for the S3 [`GetObject`][2] action that'll expire at
     * the provided expiration time.
     *
     * [1]:
     *     https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html
     * [2]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
     */
    public getGetObjectSignedUrl(expirationTime: Date, input: GetObjectCommandInput) {
        return this._client.getGetObjectSignedUrl(
            this._context.tracer.getTracer(),
            expirationTime,
            input,
        );
    }

    public fork() {
        return new CloudflareR2ContextModule(this._client);
    }
}
