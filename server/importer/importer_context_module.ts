import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";
import {
    ImporterContextModuleBase,
    PresignedUploadUrlResult,
} from "~/server/importer/importer_context_module_base.js";

/**
 * Production importer context module that uses AWS S3 for file storage.
 *
 * ## S3 Bucket Setup
 *
 * The bucket is created by the CDK stack in
 * `admin/aws/internal/aws_import_uploads.ts`. It has:
 *
 * - 7-day lifecycle rule for automatic cleanup
 * - CORS configured for browser uploads
 * - SSL enforcement
 *
 * ## IAM Permissions
 *
 * - App service needs `s3:PutObject` for creating presigned upload URLs
 * - Job queue service needs `s3:GetObject` for reading uploaded files
 *
 * These permissions are granted in `admin/aws/internal/aws_app_service.ts` and
 * `admin/aws/internal/aws_job_queue_service.ts`.
 */
export class ImporterContextModule extends ImporterContextModuleBase {
    private readonly _s3Client: S3Client;
    private readonly _bucketName: string;

    constructor({s3Client, bucketName}: {s3Client: S3Client; bucketName: string}) {
        super();
        this._s3Client = s3Client;
        this._bucketName = bucketName;
    }

    async createPresignedUploadUrl({
        importKey,
        contentType,
        contentLength,
    }: {
        importKey: string;
        contentType: string;
        contentLength: number;
    }): Promise<PresignedUploadUrlResult> {
        const presignedUploadUrl = await getSignedUrl(
            this._s3Client,
            new PutObjectCommand({
                Bucket: this._bucketName,
                Key: importKey,
                ContentType: contentType,
                ContentLength: contentLength,
            }),
            {expiresIn: 24 * 60 * 60},
        );

        return {presignedUploadUrl, importKey};
    }

    async hasUploadedFile(importKey: string): Promise<boolean> {
        try {
            await this._s3Client.send(
                new HeadObjectCommand({Bucket: this._bucketName, Key: importKey}),
            );
            return true;
        } catch {
            return false;
        }
    }

    // TODO: Stream this file to disk before reading it
    // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/75j9w76k2chdpbnv04pa4sg8qw
    async readUploadedFile(importKey: string): Promise<Uint8Array | null> {
        const getObjectResult = await this._s3Client
            .send(new GetObjectCommand({Bucket: this._bucketName, Key: importKey}))
            .catch(() => null);

        if (!getObjectResult?.Body) {
            return null;
        }

        return getObjectResult.Body.transformToByteArray();
    }

    async deleteUploadedFile(importKey: string): Promise<void> {
        await this._s3Client.send(
            new DeleteObjectCommand({Bucket: this._bucketName, Key: importKey}),
        );
    }

    fork(): ImporterContextModule {
        return new ImporterContextModule({
            s3Client: this._s3Client,
            bucketName: this._bucketName,
        });
    }
}
