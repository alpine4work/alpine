import fsSync from "fs";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {Readable as ReadableStream} from "stream";
import {finished} from "stream/promises";
import {processPdfDocumentFile} from "~/server/files/processor/processors/file_pdf_document_processor.js";
import {FileProcessor} from "~/server/files/processor/processors/file_processor.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {runProcess} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {getFileContentTypeName} from "~/shared/content/code/get_file_content_type_name.js";
import {InternalError} from "~/shared/error/error.js";
import {
    FileMicrosoftOfficeDocumentContentType,
    getFileContentTypePreferredExtension,
} from "~/shared/files/file_content_type.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {quote} from "~/shared/helpers/string/quote.js";

/**
 * Lookup system installed [LibreOffice][1] executable path using common
 * installation locations. If you add a path here you should also update `dev test`
 * which also needs to check if LibreOffice is installed.
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
                quote`Haven\u2019t implemented finding LibreOffice executable on platform ${process.platform}`,
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
        "Couldn\u2019t find LibreOffice executable. For features that require LibreOffice to " +
            "work (e.g. converting Microsoft Word documents to PDF) you need to install " +
            "LibreOffice on the machine running `FileProcessorService`: " +
            "https://www.libreoffice.org/download/download-libreoffice",
        {cause: errors},
    );
});

export function createFileMicrosoftOfficeDocumentProcessor(
    contentType: FileMicrosoftOfficeDocumentContentType,
): FileProcessor {
    return {
        type: "MicrosoftOfficeDocument",
        hasAlternative: true,
        hasAnalysis: false,
        hasPreview: {
            type: "Image",
            hasContent: true,
            hasVideoDuration: false,
        },
        hasTranscript: false,
        process: async (
            context,
            {
                spaceId,
                fileId,
                signal,
                contentLength,
                parentTemporaryDirectoryPath,
                withTemporaryDirectory,
            },
        ) => {
            const [temporaryDirectoryPath, object] = await runAllPromises([
                withTemporaryDirectory(),
                context.r2.GetObject(
                    {
                        Bucket: filesBucketName,
                        Key: `${spaceId}/${fileId}`,
                    },
                    {signal},
                ),
            ]);
            assert(object.Body instanceof ReadableStream);

            const userInstallationPath = joinPath(temporaryDirectoryPath, "user");

            const inputPath = joinPath(
                temporaryDirectoryPath,
                `file.${getFileContentTypePreferredExtension(contentType)}`,
            );

            const inputWriteStream = fsSync.createWriteStream(inputPath);
            await finished(object.Body.pipe(inputWriteStream));

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
                        // eslint-disable-next-line cyberworlds/string-quotes
                        'calc_pdf_Export:{"SinglePageSheets":{"type":"boolean","value":"true"}}';

                    // Spreadsheets are an infinite canvas and aren't typically restricted by any page
                    // size. So we want to crop our preview image to the top-left corner of the sheet.
                    // Otherwise the preview image could be so large as to not be particularly useful.
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

            await context.tracer.withSpan(
                `LibreOffice convert ${getFileContentTypeName(
                    contentType,
                )} to ${getFileContentTypeName("application/pdf")}`,
                async (context, span) => {
                    span.addData({
                        file: {contentType, contentLength},
                        libreoffice: {outputFilter},
                    });

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
                            env: {
                                // In production, the `www-data` user's `$HOME` (`/var/www`) won't be writable. So
                                // `dconf` logs a warning telling us the cache directory can't be created. Set
                                // `XDG_CACHE_HOME` to a writable directory so `dconf` can work.
                                XDG_CACHE_HOME: joinPath(parentTemporaryDirectoryPath, ".cache"),
                            },
                        },
                    );

                    const processDurationMs = span.clock.now() - startTime;

                    // Record just the process duration since waiting on the input stream depends on
                    // client network performance.
                    span.addData({common: {processDurationMs}});
                },
            );

            const outputPath = joinPath(temporaryDirectoryPath, "file.pdf");
            const outputContentLength = (await fs.stat(outputPath)).size;
            const outputReadStream = fsSync.createReadStream(outputPath);

            const {
                imagePreviewSizePromise,
                imagePreviewPlaceholderPromise,
                imagePreviewContentPromise,
            } = processPdfDocumentFile(context, outputPath, {
                signal,
                contentLength: outputContentLength,
                temporaryDirectoryPath,
                extractPreview: shouldCropPreviewImage
                    ? // Extract to the size of a default 4:3 Microsoft PowerPoint slide.
                      {left: 0, top: 0, width: 720, height: 540}
                    : undefined,
            });

            return {
                alternativePromise: Promise.resolve({
                    contentType: "application/pdf",
                    contentLength: outputContentLength,
                    data: outputReadStream,
                }),
                imagePreviewSizePromise,
                imagePreviewPlaceholderPromise,
                imagePreviewContentPromise,
            };
        },
    };
}
