import sharp from "sharp";
import {Readable as ReadableStream} from "stream";
import {waitForReadableStreamBuffer} from "~/server/files/upload/helpers/wait_for_readable_stream_buffer.js";
import {
    pdfPasswordRequiredErrorDisplayMessage,
    processFileImagePreviewPlaceholder,
    rethrowClassifiedSharpError,
    sharpTimeoutSeconds,
} from "~/server/files/upload/processors/file_image_processor_base.js";
import {
    FileProcessor,
    FileProcessorTemplate,
} from "~/server/files/upload/processors/file_processor.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {FileContentType, FilePdfDocumentContentType} from "~/shared/files/file_content_type.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
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

        // If the PDF is password protected then it's ok to finish the upload. We won't
        // be able to render the PDF but the user should still be able to download it
        // and view the PDF on their local machine.
        acceptError: error => error.displayMessage === pdfPasswordRequiredErrorDisplayMessage,

        process: (stream, signal) => processPdfDocumentFile(stream, signal),
    };
}

export function processPdfDocumentFile(
    stream: ReadableStream,
    signal: AbortSignal,
    {extractPreview}: {extractPreview?: sharp.Region} = {},
): ReturnType<
    FileProcessorTemplate<
        false,
        {type: "Image"; hasContent: true; hasVideoDuration: false}
    >["process"]
> {
    // Unfortunately, `sharp` doesn't support efficient stream processing so it's
    // more efficient to await `dataPromise` than to use `stream`. See our comment
    // on `FileProcessor`.
    const dataPromise = waitForReadableStreamBuffer(stream, signal);

    const previewSizeWithoutExtractPromise = (async () => {
        const data = await dataPromise;

        let retryCount = 0;

        while (true) {
            retryCount++;

            try {
                const metadata = await sharp(data, {pages: 1})
                    .timeout({seconds: sharpTimeoutSeconds})
                    .metadata()
                    .catch(rethrowClassifiedSharpError);

                const expectedFormat = "pdf";
                if (metadata.format !== expectedFormat) {
                    throw new InvalidArgumentError(
                        quote`Expected file in ${expectedFormat} format but received file in ${metadata.format} format`,
                    );
                }

                if (metadata.width === undefined || metadata.height === undefined) {
                    throw new InternalError('Couldn\'t find "width" or "height" of image file');
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

    const previewContentPromise = (async (): Promise<{
        contentType: FileContentType;
        data: Buffer;
    }> => {
        const [{width, height, scale}, inputData] = await runAllPromises([
            previewSizeWithoutExtractPromise,
            dataPromise,
        ]);

        let sharpInstance = sharp(inputData, {pages: 1})
            .timeout({seconds: sharpTimeoutSeconds})
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
            .toFormat("avif", {quality: 80})
            .resize(width, height);

        if (extractPreview) {
            const extractLeft = clamp(0, extractPreview.left * scale, width);
            const extractTop = clamp(0, extractPreview.top * scale, height);

            sharpInstance = sharpInstance.extract({
                left: extractLeft,
                width: clamp(0, extractPreview.width * scale, width - extractLeft),
                top: extractTop,
                height: clamp(0, extractPreview.height * scale, height - extractTop),
            });
        }

        const outputData = await sharpInstance.toBuffer().catch(rethrowClassifiedSharpError);

        return {contentType: "image/avif", data: outputData};
    })();

    const previewPlaceholderPromise = (async () => {
        if (extractPreview) {
            const {data} = await previewContentPromise;
            return processFileImagePreviewPlaceholder(data);
        } else {
            const data = await dataPromise;
            return processFileImagePreviewPlaceholder(data);
        }
    })();

    const previewSizePromise = extractPreview
        ? previewSizeWithoutExtractPromise.then(({width, height, scale, hasAlpha}) => ({
              width: clamp(0, width, extractPreview.width * scale),
              height: clamp(0, height, extractPreview.height * scale),
              scale,
              hasAlpha,
          }))
        : previewSizeWithoutExtractPromise;

    return {
        imagePreviewSizePromise: previewSizePromise,
        imagePreviewPlaceholderPromise: previewPlaceholderPromise,
        imagePreviewContentPromise: previewContentPromise,
    };
}
