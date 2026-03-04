import {GetObjectCommand, S3Client} from "@aws-sdk/client-s3";

import {ImporterServiceContextModuleBase} from "~/server/importer/importer_service_context_module_base.js";

/**
 * Production importer service context module that reads files from S3.
 *
 * This module is used by the importer Fargate task to read uploaded import files
 * from the S3 bucket. It only supports reading operations since the app service
 * handles creating presigned URLs and spawning tasks.
 */
export class ImporterServiceContextModule extends ImporterServiceContextModuleBase {
    private readonly _s3Client: S3Client;
    private readonly _bucketName: string;

    constructor({s3Client, bucketName}: {s3Client: S3Client; bucketName: string}) {
        super();
        this._s3Client = s3Client;
        this._bucketName = bucketName;
    }

    /**
     * Checks if an uploaded import file exists.
     */
    async hasUploadedFile(importKey: string): Promise<boolean> {
        try {
            await this._s3Client.send(
                new GetObjectCommand({Bucket: this._bucketName, Key: importKey}),
            );
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Reads an uploaded import file.
     */
    async readUploadedFile(importKey: string): Promise<Uint8Array | null> {
        const getObjectResult = await this._s3Client
            .send(new GetObjectCommand({Bucket: this._bucketName, Key: importKey}))
            .catch(() => null);

        if (!getObjectResult?.Body) {
            return null;
        }

        return getObjectResult.Body.transformToByteArray();
    }

    /**
     * Deletes an uploaded import file. Files are automatically cleaned up by S3
     * lifecycle rules, so this is a no-op.
     */
    async deleteUploadedFile(): Promise<void> {
        // No need to delete manually.
    }

    fork(): ImporterServiceContextModule {
        return new ImporterServiceContextModule({
            s3Client: this._s3Client,
            bucketName: this._bucketName,
        });
    }
}
