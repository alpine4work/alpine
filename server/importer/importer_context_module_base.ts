import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";

/**
 * Presigned upload URL result containing the URL to upload to and the key
 * that identifies the uploaded file.
 */
export type PresignedUploadUrlResult = {
    /**
     * The presigned URL the client should upload their file to via PUT request.
     *
     * In production, this is an S3 presigned URL for the `cyberworlds-import-uploads`
     * bucket. In development, this is a local endpoint that writes to the filesystem.
     */
    presignedUploadUrl: string;
    /**
     * The key that identifies this upload. Use this key when processing the import
     * to retrieve the uploaded file.
     */
    importKey: string;
};

/**
 * Base context module for import operations. Provides an abstraction over
 * file upload storage that works differently in development vs production.
 *
 * ## Production (`ImporterContextModule`)
 * Uses AWS S3 with the `cyberworlds-import-uploads` bucket. Presigned URLs
 * allow clients to upload directly to S3 without going through our servers.
 * The job queue service reads from S3 when processing imports.
 *
 * ## Development (`ImporterContextModuleDevelopment`)
 * Uses a local endpoint that writes files to the Bazel workspace directory
 * at `dev-data/import-uploads/`. This avoids needing AWS credentials in
 * development and allows easy inspection of uploaded files.
 *
 * The dev endpoint is served by the app service at `/dev/import-upload/:key`.
 */
export abstract class ImporterContextModuleBase<
    Modules extends {
        tracer: TracerContextModule;
    } = {
        tracer: TracerContextModule;
    },
> extends ContextModuleBase<Modules> {
    /**
     * Creates a presigned URL for uploading an import file.
     *
     * @param importKey - The unique key identifying this import (typically
     *   `{spaceId}/{importId}`)
     * @param contentType - The MIME type of the file being uploaded
     * @param contentLength - The size of the file in bytes
     * @returns A presigned URL and the import key
     */
    abstract createPresignedUploadUrl(options: {
        importKey: string;
        contentType: string;
        contentLength: number;
    }): Promise<PresignedUploadUrlResult>;

    /**
     * Checks if an uploaded import file exists.
     *
     * @param importKey - The key returned from `createPresignedUploadUrl`
     * @returns True if the file exists, false otherwise
     */
    abstract hasUploadedFile(importKey: string): Promise<boolean>;

    /**
     * Reads an uploaded import file.
     *
     * @param importKey - The key returned from `createPresignedUploadUrl`
     * @returns The file contents as a Uint8Array, or null if not found
     */
    abstract readUploadedFile(importKey: string): Promise<Uint8Array | null>;

    /**
     * Deletes an uploaded import file.
     *
     * @param importKey - The key of the file to delete
     */
    abstract deleteUploadedFile(importKey: string): Promise<void>;

    abstract fork(): ForkableContextModuleBase;
}
