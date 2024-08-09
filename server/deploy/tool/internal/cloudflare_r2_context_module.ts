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
import {CloudflareR2Client} from "~/server/deploy/tool/internal/cloudflare_r2_client.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";

export class CloudflareR2ContextModule extends ContextModuleBase<{tracer: TracerContextModule}> {
    private readonly _client: CloudflareR2Client;

    constructor(client: CloudflareR2Client) {
        super();
        this._client = client;
    }

    /**
     * S3 [`GetObject`][1] action. See [Cloudflare R2 S3 API compatibility
     * notes][2].
     *
     * [1]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
     * [2]: https://developers.cloudflare.com/r2/api/s3/api/
     */
    public GetObject(input: GetObjectCommandInput): Promise<GetObjectCommandOutput> {
        return this._client.GetObject(this._context.tracer.getTracer(), input);
    }

    /**
     * S3 [`HeadObject`][1] action. See [Cloudflare R2 S3 API compatibility
     * notes][2].
     *
     * [1]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html
     * [2]: https://developers.cloudflare.com/r2/api/s3/api/
     */
    public HeadObject(input: HeadObjectCommandInput): Promise<HeadObjectCommandOutput> {
        return this._client.HeadObject(this._context.tracer.getTracer(), input);
    }

    /**
     * S3 [`PutObject`][1] action. See [Cloudflare R2 S3 API compatibility
     * notes][2].
     *
     * [1]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html
     * [2]: https://developers.cloudflare.com/r2/api/s3/api/
     */
    public PutObject(input: PutObjectCommandInput): Promise<PutObjectCommandOutput> {
        return this._client.PutObject(this._context.tracer.getTracer(), input);
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
}
