import fsSync from "fs";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {Readable as ReadableStream} from "stream";
import {ReplayStream} from "~/server/files/upload/helpers/replay_stream.js";
import {waitForWritableStreamClose} from "~/server/files/upload/helpers/wait_for_writable_stream_close.js";
import {processPdfDocumentFile} from "~/server/files/upload/processors/file_pdf_document_processor.js";
import {FileProcessor} from "~/server/files/upload/processors/file_processor.js";
import {runProcess} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {withTemporaryDirectory} from "~/server/helpers/node/with_temporary_directory.js";
import {InternalError} from "~/shared/error/error.js";
import {
    FileContentType,
    FileMicrosoftOfficeDocumentContentType,
    getFileContentTypePreferredExtension,
} from "~/shared/files/file_content_type.js";
import {FilePreviewSize} from "~/shared/files/file_preview.js";
import {FilePreviewPlaceholder} from "~/shared/files/file_preview_placeholder.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {quote} from "~/shared/helpers/string/quote.js";

/**
 * Lookup system installed [LibreOffice][1] executable path using common
 * installation locations. If you add a path here you should also update
 * `dev test` which also needs to check if LibreOffice is installed.
 *
 * [1]: https://www.libreoffice.org
 */
const libreofficeExecutablePath = new Lazy(async () => {
    let paths: Array<string>;

    // Derived from:
    // https://github.com/elwerene/libreoffice-convert/blob/c47f41de41910fcec077dabaae6f8ed7925605b5/index.js#L20-L34
    switch (process.platform) {
        case "darwin": {
            paths = ["/Applications/LibreOffice.app/Contents/MacOS/soffice"];
            break;
        }
        case "linux": {
            paths = [
                "/usr/bin/libreoffice",
                "/usr/bin/soffice",
                "/snap/bin/libreoffice",
                "/opt/libreoffice/program/soffice",
            ];
            break;
        }
        default: {
            throw new InternalError(
                quote`Haven't implemented finding LibreOffice executable on platform ${process.platform}`,
            );
        }
    }

    const errors: Array<unknown> = [];

    for (const path of paths) {
        try {
            await fs.access(path, fs.constants.X_OK);
            return path;
        } catch (error) {
            errors.push(error);
        }
    }

    throw new InternalError(
        "Couldn't find LibreOffice executable. For features that require LibreOffice to " +
            "work (e.g. converting Microsoft Word documents to PDF) you need to install " +
            "LibreOffice on the machine running `FileUploadService`: " +
            "https://www.libreoffice.org/download/download-libreoffice",
        {cause: errors},
    );
});

export function createFileMicrosoftOfficeDocumentProcessor(
    contentType: FileMicrosoftOfficeDocumentContentType,
): FileProcessor {
    const processorType = "MicrosoftOfficeDocument";

    return {
        type: processorType,
        hasAlternative: true,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
        process: (
            inputStream,
            signal,
            {span, fileId, contentLength, temporaryDirectoryPath: parentTemporaryDirectoryPath},
        ) => {
            const alternativePromiseResolver = createPromiseResolver<{
                contentType: FileContentType;
                data: ReadableStream;
            }>();

            const previewSizePromiseResolver = createPromiseResolver<FilePreviewSize>();

            const previewPlaceholderPromiseResolver =
                createPromiseResolver<FilePreviewPlaceholder>();

            // Create a replay stream which will replay any chunks written while we create
            // our temporary directory. This won't block the Cloudflare R2 upload which is
            // also consuming the stream in parallel.
            const inputReplayStream = inputStream.pipe(new ReplayStream());

            const previewImagePromise: Promise<{
                contentType: FileContentType;
                data: Buffer | ReadableStream;
            }> = withTemporaryDirectory(
                parentTemporaryDirectoryPath,
                `${fileId}_`,
                async temporaryDirectoryPath => {
                    const userInstallationPath = joinPath(temporaryDirectoryPath, "user");

                    const inputPath = joinPath(
                        temporaryDirectoryPath,
                        `file.${getFileContentTypePreferredExtension(contentType)}`,
                    );
                    const inputWriteStream = fsSync.createWriteStream(inputPath);

                    // See the LibreOffice documentation for more information on filters:
                    // https://help.libreoffice.org/latest/en-US/text/shared/guide/convertfilters.html
                    let outputFilter: string;
                    let shouldCropPreviewImage: boolean;
                    switch (contentType) {
                        case "application/msword":
                        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                            outputFilter = "writer_pdf_Export";
                            shouldCropPreviewImage = false;
                            break;
                        case "application/vnd.ms-excel":
                        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                            // Output the Excel sheet onto a single page. See:
                            // https://ask.libreoffice.org/t/libreoffice-xls-to-pdf-conversion-breaks-single-page-content-into-multiple-pages-on-ubuntu-18-04/49104/2
                            outputFilter =
                                'calc_pdf_Export:{"SinglePageSheets":{"type":"boolean","value":"true"}}';

                            // Spreadsheets are an infinite canvas and aren't typically restricted by any
                            // page size. So we want to crop our preview image to the top-left corner of
                            // the sheet. Otherwise the preview image could be so large as to not be
                            // particularly useful.
                            shouldCropPreviewImage = true;
                            break;
                        case "application/vnd.ms-powerpoint":
                        case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
                            outputFilter = "impress_pdf_Export";
                            shouldCropPreviewImage = false;
                            break;
                        default:
                            throw exhaustive(contentType);
                    }

                    try {
                        await span.withSpan("LibreOffice convert to PDF", async span => {
                            span.addData({
                                file: {contentType, contentLength, processorType},
                                libreoffice: {outputFilter},
                            });

                            inputReplayStream.ready();
                            inputReplayStream.pipe(inputWriteStream);

                            // Wait for us to finish writing to our file. Also listen to the abort
                            // signal. If we abort before finishing the stream we shouldn't continue.
                            await waitForWritableStreamClose(inputWriteStream, signal);

                            const executablePath = await libreofficeExecutablePath.get();

                            const startTime = span.clock.now();

                            // Pass all the same flags as `unoserver` and `libreoffice-convert`:
                            //
                            // - https://github.com/unoconv/unoserver/blob/dc4c0168d2bfa7b055fd0937071dcab5952da22e/src/unoserver/server.py#L73-L79
                            // - https://github.com/elwerene/libreoffice-convert/blob/c47f41de41910fcec077dabaae6f8ed7925605b5/index.js#L53-L59
                            await runProcess(
                                executablePath,
                                [
                                    "--headless",
                                    "--invisible",
                                    "--nocrashreport",
                                    "--nodefault",
                                    "--nologo",
                                    "--nofirststartwizard",
                                    "--norestore",
                                    `-env:UserInstallation=file://${userInstallationPath}`,
                                    ["--convert-to", `pdf:${outputFilter}`],
                                    ["--outdir", temporaryDirectoryPath],
                                    inputPath,
                                ],
                                {
                                    cwd: runfilesPath,
                                    signal,
                                },
                            );

                            const processDurationMs = span.clock.now() - startTime;

                            // Record just the process duration since waiting on the input stream depends
                            // on client network performance.
                            span.addData({common: {processDurationMs}});
                        });
                    } finally {
                        inputWriteStream.destroy();
                    }

                    const outputReadStream = fsSync.createReadStream(
                        joinPath(temporaryDirectoryPath, "file.pdf"),
                    );

                    alternativePromiseResolver.resolve({
                        contentType: "application/pdf",
                        data: outputReadStream,
                    });

                    const {previewSizePromise, previewPlaceholderPromise, previewImagePromise} =
                        processPdfDocumentFile(outputReadStream, signal, {
                            extractPreview: shouldCropPreviewImage
                                ? // Extract to the size of a default 4:3 Microsoft PowerPoint slide.
                                  {left: 0, top: 0, width: 720, height: 540}
                                : undefined,
                        });

                    previewSizePromise.then(
                        previewSizePromiseResolver.resolve,
                        previewSizePromiseResolver.reject,
                    );

                    previewPlaceholderPromise.then(
                        previewPlaceholderPromiseResolver.resolve,
                        previewPlaceholderPromiseResolver.reject,
                    );

                    const [image] = await runAllPromises([
                        previewImagePromise,
                        // Wait for these promises before returning even though we don't use their data
                        // so we only cleanup our temporary directory after all promises have been
                        // resolved.
                        previewSizePromise,
                        previewPlaceholderPromise,
                    ]);

                    return image;
                },
            ).catch(error => {
                alternativePromiseResolver.reject(error);
                previewSizePromiseResolver.reject(error);
                previewPlaceholderPromiseResolver.reject(error);
                throw error;
            });

            return {
                alternativePromise: alternativePromiseResolver.promise,
                previewSizePromise: previewSizePromiseResolver.promise,
                previewPlaceholderPromise: previewPlaceholderPromiseResolver.promise,
                previewImagePromise,
            };
        },
    };
}
