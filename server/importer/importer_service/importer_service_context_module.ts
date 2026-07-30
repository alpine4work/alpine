import {GetObjectCommand, S3Client} from "@aws-sdk/client-s3";
import {NodeJsClient} from "@smithy/types";
import {createWriteStream} from "fs";
import {mkdir, readdir, stat, unlink} from "fs/promises";
import {dirname} from "path";
import {pipeline} from "stream/promises";
import {ImporterServiceContextModuleBase} from "~/server/importer/importer_service_context_module_base.js";

import {unzipToDisk} from "~/server/importer/internal/unzip_to_disk.js";
import {DataLossError} from "~/shared/error/error.js";
import {importerVolumeContainerPath} from "~/shared/importer/importer_volume.js";

/**
 * Production importer service context module that reads files from S3.
 *
 * This module is used by the importer Fargate task to read uploaded import files
 * from the S3 bucket and process them on disk.
 */
export class ImporterServiceContextModule extends ImporterServiceContextModuleBase {
    private readonly _s3Client: NodeJsClient<S3Client>;
    private readonly _bucketName: string;

    constructor({s3Client, bucketName}: {s3Client: S3Client; bucketName: string}) {
        super();
        // Narrow the S3 client type to Node.js so that response `Body` is typed as
        // `Readable` instead of a union that includes browser-only types
        // (`ReadableStream | Blob`). This is safe because this module only runs on the
        // Fargate task (Node.js) and is the approach recommended by the SDK:
        // https://github.com/aws/aws-sdk-js-v3/issues/4720
        this._s3Client = s3Client as NodeJsClient<S3Client>;
        this._bucketName = bucketName;
    }

    /**
     * Downloads an import zip file from S3 and extracts it to disk.
     */
    async downloadAndUnzipImportToDisk(options: {
        importKey: string;
    }): Promise<{diskPathToUnzippedFiles: string}> {
        return await this._context.tracer.withSpan(
            "Download and unzip import to disk",
            async () => {
                const {importKey} = options;

                // Write to the mounted EBS volume, not /tmp (which is limited ephemeral storage).
                const unzipDir = `${importerVolumeContainerPath}/${importKey.replace(/\//g, "_")}`;
                const zipFilePath = `${unzipDir}.zip`;

                // Download the zip file from S3
                const getObjectResult = await this._s3Client
                    .send(new GetObjectCommand({Bucket: this._bucketName, Key: importKey}))
                    .catch(error => {
                        throw new DataLossError(`Failed to get import file`, {cause: error});
                    });

                if (!getObjectResult?.Body) {
                    throw new DataLossError(`Import file not found`);
                }

                // Stream directly to disk to avoid holding the entire file in memory
                await mkdir(dirname(zipFilePath), {recursive: true});
                await pipeline(getObjectResult.Body, createWriteStream(zipFilePath));

                // TODO: delete this log
                const zipStat = await stat(zipFilePath);
                // TODO: delete this log
                // eslint-disable-next-line no-console
                console.log(
                    `[downloadAndUnzip] Downloaded zip to ${zipFilePath} (${zipStat.size} bytes)`,
                );

                // Unzip to disk
                await mkdir(unzipDir, {recursive: true});
                await unzipToDisk(zipFilePath, unzipDir);

                // TODO: delete this log
                const extractedEntries = await readdir(unzipDir, {withFileTypes: true});
                // TODO: delete this log
                // eslint-disable-next-line no-console
                console.log(
                    `[downloadAndUnzip] Extracted to ${unzipDir}. Top-level entries: ${extractedEntries.length}`,
                );
                for (const entry of extractedEntries) {
                    const entryPath = `${unzipDir}/${entry.name}`;
                    const entrySize = await stat(entryPath)
                        .then(s => s.size)
                        .catch(() => -1);
                    // TODO: delete this log
                    // eslint-disable-next-line no-console
                    console.log(
                        `[downloadAndUnzip]   ${entry.isDirectory() ? "DIR" : "FILE"}: ${entry.name} (${entrySize} bytes)`,
                    );
                }

                // Clean up the zip file
                await unlink(zipFilePath);
                // TODO: delete this log
                // eslint-disable-next-line no-console
                console.log(`[downloadAndUnzip] Deleted original zip. Unzip dir: ${unzipDir}`);

                return {diskPathToUnzippedFiles: unzipDir};
            },
        );
    }

    fork(): ImporterServiceContextModule {
        return new ImporterServiceContextModule({
            s3Client: this._s3Client,
            bucketName: this._bucketName,
        });
    }
}
