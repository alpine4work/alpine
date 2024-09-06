import {Readable as ReadableStream} from "stream";
import {ErrorBase} from "~/shared/error/error.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {FileContentType} from "~/shared/files/file_content_type.js";
import {FilePreviewPlaceholder} from "~/shared/files/file_preview_placeholder.js";
import {If} from "~/shared/helpers/types/if.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * File processor object.
 *
 * Currently file processing only generates the file's preview. Basically all
 * files have a preview (except audio files or opaque binary data). Any file
 * that's not a web safe image will generate a preview image. If the file has
 * a preview `hasPreview` will be true and if the file generates a preview
 * image then `hasPreviewImage` will be true.
 *
 * The `process` function actually performs the file processing. It takes
 * `stream` which provides file data. You must synchronously start listening to
 * the `stream` or you may miss data! You may use `waitForReadableStreamData()`
 * to wait until we've received all data from the readable stream.
 *
 * Make sure to cancel your stream processing if the upload is aborted (see
 * `signal`). Since `stream` may not end after an abort! e.g. When the
 * connection times out.
 *
 * ## Sharp and stream processing
 *
 * Unfortunately, `sharp` (which we use for processing many of our files) does
 * not support efficient stream processing despite having a stream API. `sharp`
 * in stream mode [waits for the stream to finish][1] instead of pushing data
 * to `libvips` as it becomes available. So it makes no difference whether we
 * use `const sharpInstance = sharp(); stream.pipe(sharpInstance)` or
 * `sharp(await dataPromise)`. If anything `sharp(await dataPromise)` is more
 * efficient since we only need to call `Buffer.concat()` to create the final
 * file data once.
 *
 * Ideally `sharp` would take advantage of streaming when processing metadata
 * since all it needs is the file header in most cases (though it's unclear if
 * `libvips` itself can handle file streaming). We'll upgrade our
 * implementation to use streaming if `sharp`'s implementation changes.
 *
 * [1]: https://github.com/lovell/sharp/blob/fc32e0bd3f9111b80cf078df7b0cfc355695674e/lib/input.js#L489-L500
 */
export type FileProcessor =
    | NoopFileProcessor
    | FileProcessorTemplate<false, false>
    | FileProcessorTemplate<true, false>
    | FileProcessorTemplate<true, true>
    | FileProcessorTemplate<true, "PreviewImage">;

export interface NoopFileProcessor {
    readonly type: "Noop";
    readonly hasPreview: false;
    readonly hasPreviewImage: false;
    readonly hasAlternative: false;
}

export interface FileProcessorTemplate<
    HasPreviewImage extends boolean,
    HasAlternative extends boolean | "PreviewImage",
> {
    readonly type:
        | "WebSafeImage"
        | "WebUnsafeImage"
        | "IcoImage"
        | "PdfDocument"
        | "MicrosoftOfficeDocument";
    readonly hasPreview: true;
    readonly hasPreviewImage: HasPreviewImage;
    readonly hasAlternative: HasAlternative;

    process(
        stream: ReadableStream,
        abortSignal: AbortSignal,
        options: {
            span: TracerSpan;
            fileId: FileId;
            contentLength: number;
            temporaryDirectoryPath: string;
        },
    ): MergeObjectIntersection<
        {
            previewSizePromise: Promise<{width: number; height: number; scale: number}>;
            previewPlaceholderPromise: Promise<FilePreviewPlaceholder>;
        } & If<
            HasPreviewImage,
            {previewImagePromise: Promise<{contentType: FileContentType; data: Buffer}>},
            {previewImagePromise?: undefined}
        > &
            (HasAlternative extends "PreviewImage"
                ? {
                      previewImagePromise: Promise<{contentType: FileContentType; data: Buffer}>;
                      alternativePromise?: undefined;
                  }
                : If<
                      HasAlternative & boolean,
                      {
                          alternativePromise: Promise<{
                              contentType: FileContentType;
                              stream: ReadableStream;
                          }>;
                      },
                      {alternativePromise?: undefined}
                  >)
    >;

    /**
     * If `acceptError` is implemented and you return true for an error we won't
     * cancel the file upload when processing throws but instead save the provided
     * error's `displayMessage` in the database. Then when the user tries to
     * view the preview we'll show them the error message. So the upload will be
     * successful but the user won't be able to preview the file. `acceptError`
     * will only be called for errors with a `displayMessage`.
     */
    acceptError?(error: ErrorBase, displayMessage: ErrorDisplayMessage): boolean | undefined;
}

export const fileNoopProcessor: FileProcessor = {
    type: "Noop",
    hasPreview: false,
    hasPreviewImage: false,
    hasAlternative: false,
};
