import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {NotionImportId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Base context module for import operations. Provides an abstraction over file
 * upload storage that works differently in development vs production.
 *
 * ## Production (`ImporterContextModule`)
 *
 * Uses AWS S3 with the `cyberworlds-import-uploads` bucket. Multipart uploads
 * allow clients to upload large files directly to S3 in chunks without going
 * through our servers.
 *
 * ## Development (`ImporterContextModuleDevelopment`)
 *
 * Uses a local endpoint that writes files to the Bazel workspace directory at
 * `dev-data/import-uploads/`. This avoids needing AWS credentials in development
 * and allows easy inspection of uploaded files.
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
     * Initiates a multipart upload for an import file.
     *
     * @returns The upload ID and import key needed for subsequent part uploads.
     */
    abstract createMultipartUpload(options: {
        importKey: string;
        contentType: string;
        contentLength: number;
    }): Promise<{uploadId: string; importKey: string}>;

    /**
     * Creates presigned URLs for uploading individual parts of a multipart upload.
     *
     * @returns An array of part numbers and their corresponding presigned URLs.
     */
    abstract createPresignedPartUploadUrls(options: {
        importKey: string;
        uploadId: string;
        partCount: number;
    }): Promise<Array<{partNumber: number; presignedUrl: string}>>;

    /**
     * Completes a multipart upload by assembling all uploaded parts into the final
     * object.
     */
    abstract completeMultipartUpload(options: {
        importKey: string;
        uploadId: string;
        parts: ReadonlyArray<{partNumber: number; etag: string}>;
    }): Promise<void>;

    /**
     * Aborts a multipart upload, cleaning up any uploaded parts.
     */
    abstract abortMultipartUpload(options: {importKey: string; uploadId: string}): Promise<void>;

    /**
     * Checks if an uploaded import file exists.
     *
     * @param importKey - The key returned from `createMultipartUpload` @returns True
     * if the file exists, false otherwise
     */
    abstract hasUploadedFile(importKey: string): Promise<boolean>;

    /**
     * Reads an uploaded import file.
     *
     * @param importKey - The key returned from `createMultipartUpload` @returns The
     * file contents as a Uint8Array, or null if not found
     */
    abstract readUploadedFile(importKey: string): Promise<Uint8Array | null>;

    /**
     * Deletes an uploaded import file.
     *
     * @param importKey - The key of the file to delete
     */
    abstract deleteUploadedFile(importKey: string): Promise<void>;

    /**
     * Starts the validation process for a Notion import.
     *
     * In development: Runs the validation directly in the current process. In
     * production: Spawns an ECS task to handle the validation.
     *
     * @param spaceId - The space ID the import belongs to @param notionImportId - The
     * ID of the import to validate @param importZipSize - Size of the zip file in
     * bytes, used to provision ephemeral storage for the ECS task
     */
    abstract startValidateNotionImport(options: {
        spaceId: SpaceId;
        notionImportId: NotionImportId;
        importZipSize: number;
    }): Promise<void>;

    /**
     * Starts processing a Notion import.
     *
     * In development: Runs the import processing directly in the current process. In
     * production: Spawns an ECS task to handle the import.
     *
     * @param spaceId - The space ID the import belongs to @param notionImportId - The
     * ID of the import to process @param importZipSize - Size of the zip file in
     * bytes, used to provision ephemeral storage for the ECS task
     */
    abstract startNotionImport(options: {
        spaceId: SpaceId;
        notionImportId: NotionImportId;
        importZipSize: number;
    }): Promise<void>;

    abstract fork(): ForkableContextModuleBase;
}
