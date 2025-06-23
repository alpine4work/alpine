import fsSync from "fs";
import fs from "fs/promises";
import {join as joinPath} from "path";
import sharp from "sharp";
import {Readable as ReadableStream} from "stream";
import {finished} from "stream/promises";
import {FileProcessorServiceActionContext} from "~/server/files/processor/file_processor_service_context.js";
import {
    processFileImagePreviewPlaceholder,
    rethrowClassifiedSharpError,
    sharpTimeoutSeconds,
} from "~/server/files/processor/processors/file_image_processor_base.js";
import {
    FileProcessor,
    FileProcessorTemplate,
} from "~/server/files/processor/processors/file_processor.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {getFileContentTypeName} from "~/shared/content/code/get_file_content_type_name.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {
    FileContentType,
    FilePdfDocumentContentType,
    getFileContentTypePreferredExtension,
} from "~/shared/files/file_content_type.js";
import {
    maxFilePreviewAspectRatio,
    minFilePreviewAspectRatio,
} from "~/shared/files/min_and_max_file_preview_aspect_ratio.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {quote} from "~/shared/helpers/string/quote.js";

/**
 * Create a file processor for PDF files. We process PDF files with `sharp`. We
 * use a [custom `sharp` build][1] that includes [PDFium from Chrome][2] to
 * render PDFs. Only the first page of the PDF is rendered.
 *
 * [1]: https://github.com/cyberworlds/sharp-libvips
 * [2]: https://pdfium.googlesource.com/pdfium
 */
export function createFilePdfDocumentProcessor(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    contentType: FilePdfDocumentContentType,
): FileProcessor {
    return {
        type: "PdfDocument",
        hasAlternative: false,
        hasPreview: {
            type: "Image",
            hasContent: true,
            hasVideoDuration: false,
        },
        process: async (
            context,
            {spaceId, fileId, signal, contentLength, withTemporaryDirectory},
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

            const inputPath = joinPath(temporaryDirectoryPath, "input.pdf");
            const inputWriteStream = fsSync.createWriteStream(inputPath);

            await finished(object.Body.pipe(inputWriteStream));

            return processPdfDocumentFile(context, inputPath, {
                signal,
                contentLength,
                temporaryDirectoryPath,
            });
        },
    };
}

export function processPdfDocumentFile(
    context: FileProcessorServiceActionContext,
    inputPath: string,
    {
        signal,
        contentLength,
        temporaryDirectoryPath,
        extractPreview,
    }: {
        signal: AbortSignal;
        contentLength: number;
        temporaryDirectoryPath: string;
        extractPreview?: sharp.Region;
    },
): Awaited<
    ReturnType<
        FileProcessorTemplate<
            false,
            {type: "Image"; hasContent: true; hasVideoDuration: false}
        >["process"]
    >
> {
    // All processing done in this function is with `sharp()` which doesn't support
    // an `AbortSignal` but does support a timeout. `sharp()` will abort itself
    // after our 20s timeout which is fine.
    //
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    signal;

    const previewSizeWithoutModification = (async () => {
        let retryCount = 0;

        while (true) {
            retryCount++;

            try {
                const metadata = await context.tracer.withSpan(
                    `sharp get ${getFileContentTypeName("application/pdf")} metadata`,
                    async (context, span) => {
                        span.addData({
                            file: {
                                contentType: "application/pdf",
                                contentLength,
                            },
                        });

                        const metadata = await sharp(inputPath, {pages: 1})
                            .timeout({seconds: sharpTimeoutSeconds})
                            .metadata()
                            .catch(rethrowClassifiedSharpError);

                        const expectedFormat = "pdf";
                        if (metadata.format !== expectedFormat) {
                            throw new InvalidArgumentError(
                                quote`Expected file in ${expectedFormat} format but received file in ${metadata.format} format`,
                            );
                        }

                        return metadata;
                    },
                );

                if (metadata.width === undefined || metadata.height === undefined) {
                    throw new InternalError("Couldn’t find `width` or `height` of image file");
                }

                // We produce a JPEG preview image that's 2x bigger than the source PDF. This
                // is so when viewing the preview image on a retina display with a scale factor
                // of 2 it looks the same as if we directly rendered the document. Zooming in
                // on the preview image won't look good since fundamentally we're taking a
                // vector format (PDF) and converting it to a raster format (JPEG).
                const scale = 2;

                return {
                    width: metadata.width * scale,
                    height: metadata.height * scale,
                    scale,
                    hasAlpha: metadata.hasAlpha ?? false,
                };
            } catch (error) {
                // NOTE(calebmer, 2024-11-13): `sharp` is flaky when it comes to returning an
                // error message for password protected PDFs. Our
                // `py_pdf_sample_libreoffice_write_password.pdf` test in
                // `file_processor_content_types.test.ts` observes occasional failures where we
                // get the truncated error message "Input buffer has corrupt header: " instead
                // of the full "Input buffer has corrupt header: pdfload: password required or
                // incorrect password". So when we detect a truncated error message from
                // `sharp` let's retry the `metadata()` call up to 10 times until we get a real
                // error message.
                //
                // `previewContentPromise`'s `sharp` call is also flaky in this regard. We
                // don't add a retry there because if we throw a proper `PermissionDeniedError`
                // here (with a display message) and `previewContentPromise` throws a flaky
                // `InvalidArgumentError` then `getAggregateErrorPriority()` will pick the
                // `PermissionDeniedError` as the error to throw since it has a
                // `displayMessage`.
                //
                // Code in `sharp` where this error message is created:
                // https://github.com/lovell/sharp/blob/1533bf995acda779313fc178d2b9d46791349961/src/common.cc#L417
                if (
                    retryCount <= 10 &&
                    error instanceof Error &&
                    /^Input buffer has corrupt header: *$/.test(error.message)
                ) {
                    await wait(100);
                    continue;
                }

                throw error;
            }
        }
    })();

    const previewContentPath = joinPath(
        temporaryDirectoryPath,
        `preview.${getFileContentTypePreferredExtension("image/avif")}`,
    );

    const previewContentPromise = (async (): Promise<{
        contentType: FileContentType;
        contentLength: number;
        data: ReadableStream;
    }> => {
        const {
            width: actualWidth,
            height: actualHeight,
            scale,
        } = await previewSizeWithoutModification;

        await context.tracer.withSpan(
            `sharp reformat ${getFileContentTypeName(
                "application/pdf",
            )} to ${getFileContentTypeName("image/avif")}`,
            async (context, span) => {
                span.addData({
                    file: {
                        contentType: "application/pdf",
                        contentLength,
                    },
                });

                let sharpInstance = sharp(inputPath, {pages: 1}).timeout({
                    seconds: sharpTimeoutSeconds,
                });

                const aspectRatio = actualWidth / actualHeight;
                let previewWidth: number;
                let previewHeight: number;

                // If the PDF is beyond our min/max aspect ratio bounds then we crop the PDF
                // preview to a valid size.
                if (aspectRatio <= minFilePreviewAspectRatio) {
                    previewWidth = actualWidth;
                    previewHeight = Math.round(actualWidth / minFilePreviewAspectRatio);

                    sharpInstance = sharpInstance.resize({
                        width: previewWidth,
                        height: previewHeight,
                        fit: "cover",
                        position: "top",
                    });
                } else if (aspectRatio >= maxFilePreviewAspectRatio) {
                    previewWidth = Math.round(actualHeight * maxFilePreviewAspectRatio);
                    previewHeight = actualHeight;

                    sharpInstance = sharpInstance.resize({
                        width: previewWidth,
                        height: previewHeight,
                        fit: "cover",
                        position: "centre",
                    });
                } else {
                    previewWidth = actualWidth;
                    previewHeight = actualHeight;

                    sharpInstance = sharpInstance.resize({
                        width: previewWidth,
                        height: previewHeight,
                    });
                }

                sharpInstance = sharpInstance
                    // AVIF is our preferred format for generating preview images ([source][1],
                    // [source][2]). AVIF has full browser support, provides better compression
                    // than JPEG and WebP, and has alpha channel support (unlike JPEG).
                    //
                    // Quality 80 since:
                    //
                    // - The preview's dimensions are already 2x the original file's
                    // - We only use this when previewing the file, when viewing the file we use a
                    //   full PDF renderer
                    //
                    // We want some compression since the extra storage cost of the preview file is
                    // bourne by us.
                    //
                    // If we need lossless images we should use WebP instead since [AVIF is worse
                    // at lossless compression][3].
                    //
                    // [1]: https://medium.com/@julienetienne/why-you-should-use-avif-over-jpeg-webp-png-and-gif-in-2024-5603ac9d8781
                    // [2]: https://jakearchibald.com/2020/avif-has-landed
                    // [3]: https://github.com/AOMediaCodec/av1-avif/issues/111#issuecomment-717710961
                    .toFormat("avif", {quality: 80});

                if (extractPreview) {
                    const extractLeft = clamp(0, extractPreview.left * scale, previewWidth);
                    const extractTop = clamp(0, extractPreview.top * scale, previewHeight);

                    sharpInstance = sharpInstance.extract({
                        left: extractLeft,
                        width: clamp(0, extractPreview.width * scale, previewWidth - extractLeft),
                        top: extractTop,
                        height: clamp(0, extractPreview.height * scale, previewHeight - extractTop),
                    });
                }

                return sharpInstance.toFile(previewContentPath).catch(rethrowClassifiedSharpError);
            },
        );

        return {
            contentType: "image/avif",
            contentLength: (await fs.stat(previewContentPath)).size,
            data: fsSync.createReadStream(previewContentPath),
        };
    })();

    const previewPlaceholderPromise = (async () => {
        if (extractPreview) {
            const previewContent = await previewContentPromise;

            return processFileImagePreviewPlaceholder(context, previewContentPath, {
                contentType: previewContent.contentType,
                contentLength: previewContent.contentLength,
            });
        } else {
            return processFileImagePreviewPlaceholder(context, inputPath, {
                contentType: "application/pdf",
                contentLength,
            });
        }
    })();

    let previewSizePromise = previewSizeWithoutModification.then(previewSize => {
        const aspectRatio = previewSize.width / previewSize.height;

        // If the PDF is beyond our min/max aspect ratio bounds then we crop the PDF
        // preview to a valid size.
        if (aspectRatio <= minFilePreviewAspectRatio) {
            return {
                ...previewSize,
                width: previewSize.width,
                height: Math.round(previewSize.width / minFilePreviewAspectRatio),
            };
        } else if (aspectRatio >= maxFilePreviewAspectRatio) {
            return {
                ...previewSize,
                width: Math.round(previewSize.height * maxFilePreviewAspectRatio),
                height: previewSize.height,
            };
        } else {
            return previewSize;
        }
    });

    if (extractPreview) {
        previewSizePromise = previewSizeWithoutModification.then(
            ({width, height, scale, hasAlpha}) => ({
                width: clamp(0, width, extractPreview.width * scale),
                height: clamp(0, height, extractPreview.height * scale),
                scale,
                hasAlpha,
            }),
        );
    }

    return {
        imagePreviewSizePromise: previewSizePromise,
        imagePreviewPlaceholderPromise: previewPlaceholderPromise,
        imagePreviewContentPromise: previewContentPromise,
    };
}
