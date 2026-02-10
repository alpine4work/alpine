import {Duration, RemovalPolicy} from "aws-cdk-lib";
import {IGrantable} from "aws-cdk-lib/aws-iam";
import {BlockPublicAccess, Bucket, HttpMethods} from "aws-cdk-lib/aws-s3";
import {Construct} from "constructs";

/**
 * Construct for the import uploads S3 bucket used for Notion imports and
 * potentially other import types in the future.
 *
 * The flow is:
 * 1. App service creates a presigned PutObject URL for the client
 * 2. Client uploads the file directly to S3 via the presigned URL
 * 3. Client calls `finishedNotionImportUpload` RPC to trigger validation
 * 4. App service queues a ValidateNotionImportAndExtractMetadata job
 * 5. Job queue service reads the file from S3 for processing
 *
 * Previously this used S3 event notifications -> Lambda -> SQS, but using an
 * RPC is simpler: same code path for dev/prod, easier debugging, no Lambda
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
            // Don't allow public access. We only allow access through IAM policies
            // and presigned URLs.
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            // If this bucket is deleted from a stack, we can delete the objects within.
            // They're temporary import files which are no longer needed after processing.
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            // Delete uploaded files after 7 days. Files should be processed within
            // minutes/hours but we keep them around for a week in case of debugging needs.
            lifecycleRules: [{expiration: Duration.days(7)}],
            // CORS configuration for browser-based uploads via presigned URLs.
            cors: [
                {
                    allowedMethods: [HttpMethods.PUT],
                    allowedOrigins: ["https://alpine.inc", "https://www.alpine.inc"],
                    allowedHeaders: ["Content-Type", "Content-Length"],
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
     * Grants the grantee permissions to upload files to the bucket.
     * Used by app service for creating presigned PutObject URLs.
     */
    public grantUpload(grantee: IGrantable) {
        this._bucket.grantPut(grantee);
    }

    /**
     * Grants the grantee permissions to read files from the bucket.
     * Used by job queue service to read uploaded files for processing.
     */
    public grantRead(grantee: IGrantable) {
        this._bucket.grantRead(grantee);
    }
}
