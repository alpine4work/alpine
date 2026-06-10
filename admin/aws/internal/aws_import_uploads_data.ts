import {Duration, RemovalPolicy} from "aws-cdk-lib";
import {Grant, IGrantable} from "aws-cdk-lib/aws-iam";
import {BlockPublicAccess, Bucket, HttpMethods} from "aws-cdk-lib/aws-s3";
import {Construct} from "constructs";
import {notionImportFileRetentionDays} from "~/shared/importer/notion/notion_import_file_retention.js";

/**
 * Construct for the import uploads S3 bucket used for Notion imports and
 * potentially other import types in the future.
 *
 * The flow is:
 *
 * 1. App service creates a presigned PutObject URL for the client
 * 2. Client uploads the file directly to S3 via the presigned URL
 * 3. Client calls `finishedNotionImportUpload` RPC to trigger validation
 * 4. App service queues a ValidateNotionImportAndExtractMetadata job
 * 5. Job queue service reads the file from S3 for processing
 *
 * Previously this used S3 event notifications -> Lambda -> SQS, but using an RPC
 * is simpler: same code path for dev/prod, easier debugging, no Lambda
 * infrastructure needed.
 */
export class AwsImportUploadsData extends Construct {
    private readonly _bucket: Bucket;

    constructor(parentConstruct: Construct) {
        super(parentConstruct, "ImportUploads");

        this._bucket = new Bucket(this, "Bucket", {
            bucketName: "cyberworlds-import-uploads",
            enforceSSL: true,
            minimumTLSVersion: 1.2,
            // Don't allow public access. We only allow access through IAM policies and
            // presigned URLs.
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            // If this bucket is deleted from a stack, we can delete the objects within.
            // They're temporary import files which are no longer needed after processing.
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            // Delete uploaded files after 7 days. Files should be processed within
            // minutes/hours but we keep them around for a week in case of debugging needs.
            // Also clean up incomplete multipart uploads after 7 days.
            lifecycleRules: [
                {
                    expiration: Duration.days(notionImportFileRetentionDays),
                    abortIncompleteMultipartUploadAfter: Duration.days(
                        notionImportFileRetentionDays,
                    ),
                },
            ],
            // CORS configuration for browser-based multipart uploads via presigned URLs.
            // `exposedHeaders` includes `ETag` so the browser can read it from S3 part upload
            // responses (needed for completing multipart uploads).
            cors: [
                {
                    allowedMethods: [HttpMethods.PUT],
                    allowedOrigins: ["https://alpine.inc", "https://www.alpine.inc"],
                    allowedHeaders: ["Content-Type", "Content-Length"],
                    exposedHeaders: ["ETag"],
                    maxAge: 3600,
                },
            ],
        });
    }

    /**
     * Returns the bucket name for use in command line arguments.
     */
    public get bucketName(): string {
        return this._bucket.bucketName;
    }

    /**
     * Grants the grantee permissions to upload files to the bucket. Used by app
     * service for creating presigned PutObject URLs.
     */
    public grantUpload(grantee: IGrantable) {
        this._bucket.grantPut(grantee);
    }

    /**
     * Grants the grantee only `s3:GetObject` permission, which covers HeadObject for
     * verifying uploads exist. We don't want to grant a blanket read (`s3:GetObject*`,
     * `s3:GetBucket*`, `s3:List*`) when only a single action is needed.
     */
    public grantGetObject(grantee: IGrantable) {
        Grant.addToPrincipal({
            grantee,
            actions: ["s3:GetObject"],
            resourceArns: [this._bucket.arnForObjects("*")],
        });
    }

    /**
     * Grants the grantee `s3:DeleteObject` permission for cleaning up uploaded files
     * after import completion or cancellation.
     */
    public grantDeleteObject(grantee: IGrantable) {
        Grant.addToPrincipal({
            grantee,
            actions: ["s3:DeleteObject"],
            resourceArns: [this._bucket.arnForObjects("*")],
        });
    }

    /**
     * Grants the grantee permissions to read files from the bucket. Used by job queue
     * service to read uploaded files for processing.
     */
    public grantRead(grantee: IGrantable) {
        this._bucket.grantRead(grantee);
    }
}
