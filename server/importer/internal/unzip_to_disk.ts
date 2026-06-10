import {createWriteStream} from "fs";
import {mkdir} from "fs/promises";
import {dirname, join as joinPath} from "path";
import {pipeline} from "stream/promises";
import * as yauzl from "yauzl";
import {InternalError} from "~/shared/error/error.js";

/**
 * Extracts a zip file to a directory on disk using true streaming.
 *
 * This function provides consistent cross-platform unzipping behavior, unlike
 * system commands which vary between macOS (ditto) and Linux (unzip). It handles
 * Unicode filenames correctly on all platforms.
 *
 * Uses yauzl for true streaming decompression - the zip file is read incrementally
 * and each extracted file is streamed directly to disk without holding the entire
 * archive or extracted contents in memory.
 *
 * @param zipFilePath - Absolute path to the zip file to extract @param
 * destinationDirectory - Absolute path to the destination directory (must exist)
 */
export async function unzipToDisk(
    zipFilePath: string,
    destinationDirectory: string,
): Promise<void> {
    // TODO: delete this log
    // eslint-disable-next-line no-console
    console.log(`[unzipToDisk] Opening zip: ${zipFilePath}`);
    // TODO: delete this log
    // eslint-disable-next-line no-console
    console.log(`[unzipToDisk] Destination: ${destinationDirectory}`);

    // Without `lazyEntries` yauzl emits every entry as fast as it can read the zip's
    // directory, meaning all files could be decompressed and written to disk in
    // parallel. That opens an unbounded number of file buffers with decompressed data
    // in memory for all of them at once. With `lazyEntries: true` entries are only
    // emitted when we call `readEntry()`, so we extract one file at a time: decompress
    // → write to disk → call `readEntry()` for the next one.
    const zipFile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
        yauzl.open(zipFilePath, {lazyEntries: true}, (error, zf) => {
            if (error) reject(error);
            else if (!zf) reject(new InternalError("Failed to open zip file"));
            else resolve(zf);
        });
    });

    // TODO: delete this log
    // eslint-disable-next-line no-console
    console.log(`[unzipToDisk] Zip opened. Entry count: ${zipFile.entryCount}`);

    // Extract all entries
    await new Promise<void>((resolve, reject) => {
        let hasError = false;
        let pendingWrites = 0;
        let entriesExhausted = false;
        let entryCount = 0;
        let fileCount = 0;
        let dirSkipCount = 0;

        const checkComplete = (): void => {
            if (entriesExhausted && pendingWrites === 0 && !hasError) {
                // TODO: delete this log
                // eslint-disable-next-line no-console
                console.log(
                    `[unzipToDisk] Complete. Entries seen: ${entryCount}, files written: ${fileCount}, dirs skipped: ${dirSkipCount}`,
                );
                zipFile.close();
                resolve();
            }
        };

        const handleError = (err: Error): void => {
            if (hasError) return;
            hasError = true;
            zipFile.close();
            reject(new InternalError("Failed to unzip zip file", {cause: err}));
        };

        zipFile.on("error", handleError);

        zipFile.on("entry", (entry: yauzl.Entry) => {
            if (hasError) return;
            entryCount++;

            // Skip directory entries
            if (entry.fileName.endsWith("/")) {
                dirSkipCount++;
                zipFile.readEntry();
                return;
            }

            fileCount++;
            if (fileCount <= 10 || fileCount % 1000 === 0) {
                // TODO: delete this log
                // eslint-disable-next-line no-console
                console.log(
                    `[unzipToDisk] Extracting file #${fileCount}: ${entry.fileName} (${entry.uncompressedSize} bytes)`,
                );
            }

            const destinationPath = joinPath(destinationDirectory, entry.fileName);
            const destinationDirectoryPath = dirname(destinationPath);

            pendingWrites++;

            mkdir(destinationDirectoryPath, {recursive: true})
                .then(() => {
                    if (hasError) return;

                    zipFile.openReadStream(entry, (err, readStream) => {
                        if (hasError) return;
                        if (err) {
                            handleError(err);
                            return;
                        }
                        if (!readStream) {
                            handleError(new InternalError(`No stream for ${entry.fileName}`));
                            return;
                        }

                        const writeStream = createWriteStream(destinationPath);
                        pipeline(readStream, writeStream)
                            .then(() => {
                                pendingWrites--;
                                if (!hasError) {
                                    zipFile.readEntry();
                                    checkComplete();
                                }
                            })
                            .catch(handleError);
                    });
                })
                .catch(err => {
                    handleError(err instanceof Error ? err : new InternalError(String(err)));
                });
        });

        zipFile.on("end", () => {
            entriesExhausted = true;
            checkComplete();
        });

        zipFile.readEntry();
    });
}
