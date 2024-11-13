import {Readable as ReadableStream} from "stream";
import {ErrorBase} from "~/shared/error/error.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {FileCodePreviewContent} from "~/shared/files/file_code_preview_content.js";
import {FileContentType} from "~/shared/files/file_content_type.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {
    FileAudioPreviewMetadata,
    FileHasPreview,
    FileImagePreviewSize,
} from "~/shared/files/file_preview.js";
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
 * image then `hasPreview.hasContent` will be true.
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
    | FileProcessorTemplate<
          false,
          {readonly type: "Image"; readonly hasContent: false; readonly hasVideoDuration: false}
      >
    | FileProcessorTemplate<
          false,
          {readonly type: "Image"; readonly hasContent: true; readonly hasVideoDuration: false}
      >
    | FileProcessorTemplate<
          true,
          {readonly type: "Image"; readonly hasContent: true; readonly hasVideoDuration: false}
      >
    | FileProcessorTemplate<
          false,
          {readonly type: "Image"; readonly hasContent: true; readonly hasVideoDuration: true}
      >
    | FileProcessorTemplate<
          true,
          {readonly type: "Image"; readonly hasContent: true; readonly hasVideoDuration: true}
      >
    | FileProcessorTemplate<
          "ImagePreviewContent",
          {readonly type: "Image"; readonly hasContent: true; readonly hasVideoDuration: false}
      >
    | FileProcessorTemplate<false, {readonly type: "Audio"}>
    | FileProcessorTemplate<true, {readonly type: "Audio"}>
    | FileProcessorTemplate<false, {readonly type: "Code"}>;

export interface NoopFileProcessor {
    readonly type: "Noop";
    readonly hasAlternative: false;
    readonly hasPreview: null;
}

export interface FileProcessorTemplate<
    HasAlternative extends boolean | "ImagePreviewContent",
    HasPreview extends FileHasPreview | null,
> {
    readonly type:
        | "WebSafeImage"
        | "WebUnsafeImage"
        | "IcoImage"
        | "PdfDocument"
        | "MicrosoftOfficeDocument"
        | "WebSafeVideo"
        | "WebUnsafeVideo"
        | "WebSafeAudio"
        | "WebUnsafeAudio"
        | "Code";
    readonly hasAlternative: HasAlternative;
    readonly hasPreview: HasPreview;

    process(
        stream: ReadableStream,
        signal: AbortSignal,
        options: {
            span: TracerSpan;
            fileId: FileId;
            contentLength: number;
            temporaryDirectoryPath: string;
        },
    ): FileProcessorTemplateResult<HasAlternative, HasPreview>;

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

type FileProcessorTemplateResult<
    HasAlternative extends boolean | "ImagePreviewContent",
    HasPreview extends FileHasPreview | null,
> = MergeObjectIntersection<
    {
        extraPromise?: Promise<void>;
    } & (HasAlternative extends "ImagePreviewContent"
        ? {
              imagePreviewContentPromise: Promise<{
                  contentType: FileContentType;
                  data: Buffer | ReadableStream;
              }>;
              alternativePromise?: undefined;
          }
        : If<
              HasAlternative & boolean,
              {
                  alternativePromise: Promise<{
                      contentType: FileContentType;
                      data: Buffer | ReadableStream;
                  }>;
              },
              {alternativePromise?: undefined}
          >) &
        FileProcessorTemplateResultFromHasPreview<HasPreview>
>;

type FileProcessorTemplateResultFromHasPreview<HasPreview extends FileHasPreview | null> =
    HasPreview extends null
        ? {}
        : HasPreview extends {type: "Image"}
        ? FileProcessorTemplateResultFromHasImagePreview<Exclude<HasPreview, null>>
        : HasPreview extends {type: "Audio"}
        ? FileProcessorTemplateResultFromHasAudioPreview
        : HasPreview extends {type: "Code"}
        ? FileProcessorTemplateResultFromHasCodePreview
        : never;

type FileProcessorTemplateResultFromHasImagePreview<
    HasPreview extends FileHasPreview & {type: "Image"},
> = {
    imagePreviewSizePromise: Promise<
        FileImagePreviewSize &
            If<
                HasPreview["hasVideoDuration"],
                {videoDuration?: number},
                {videoDuration?: undefined}
            >
    >;
    imagePreviewPlaceholderPromise: Promise<FileImagePreviewPlaceholder>;
} & If<
    HasPreview["hasContent"],
    {
        imagePreviewContentPromise: Promise<{
            contentType: FileContentType;
            data: Buffer | ReadableStream;
        }>;
    },
    {imagePreviewContentPromise?: undefined}
> &
    If<
        HasPreview["hasVideoDuration"],
        {imagePreviewVideoDurationPromise: Promise<number>},
        {imagePreviewVideoDurationPromise?: undefined}
    > & {
        audioPreviewDurationPromise?: undefined;
        audioPreviewMetadataPromise?: undefined;
        codePreviewContentPromise?: undefined;
    };

type FileProcessorTemplateResultFromHasAudioPreview = {
    audioPreviewDurationPromise: Promise<number>;
    audioPreviewMetadataPromise: Promise<FileAudioPreviewMetadata>;
    imagePreviewSizePromise?: undefined;
    imagePreviewPlaceholderPromise?: undefined;
    imagePreviewContentPromise?: undefined;
    imagePreviewVideoDurationPromise?: undefined;
    codePreviewContentPromise?: undefined;
};

type FileProcessorTemplateResultFromHasCodePreview = {
    codePreviewContentPromise?: Promise<FileCodePreviewContent>;
    imagePreviewSizePromise?: undefined;
    imagePreviewPlaceholderPromise?: undefined;
    imagePreviewContentPromise?: undefined;
    imagePreviewVideoDurationPromise?: undefined;
    audioPreviewDurationPromise?: undefined;
    audioPreviewMetadataPromise?: undefined;
};

export const fileNoopProcessor: FileProcessor = {
    type: "Noop",
    hasAlternative: false,
    hasPreview: null,
};
