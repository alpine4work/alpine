import {Readable as ReadableStream} from "stream";
import {FileProcessorActionContext} from "~/server/files/data/file_processor_context.js";
import {FileCodePreviewContent} from "~/shared/files/file_code_preview_content.js";
import {FileContentType} from "~/shared/files/file_content_type.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {
    FileAudioPreviewMetadata,
    FileHasPreview,
    FileImagePreviewSize,
} from "~/shared/files/file_preview.js";
import {If} from "~/shared/helpers/types/if.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * File processor object.
 *
 * Currently file processing generates the file's preview and an alternative
 * file if the original file format can't be rendered by web browsers.
 * Ideally, all files have a preview that's relevant to their contents. Opaque
 * binary data doesn't have a preview. If the file has a preview `hasPreview`
 * will be an object with more information about what the preview includes.
 *
 * The processor object has a `process()` function that performs file
 * processing. The file data is accessible in the Cloudflare R2 bucket
 * `cyberworlds-files` (use the variable `filesBucketName`) under the key
 * `${spaceId}/${fileId}`. Each processor may load the file differently. Most
 * files load the file with `context.r2.GetObject()` and save the file to a
 * temporary directory on disk. Some processors generate a signed URL with
 * `context.r2.getGetObjectSignedUrl()` and pass that to another tool which can
 * load from an HTTP endpoint. For example, that's how we use FFmpeg. Since
 * FFmpeg will stream videos/audios using HTTP `Range` requests when passed a
 * URL.
 *
 * Some processors load the file into memory but this isn't recommended! Files
 * can be up to 1 GB in size. We risk OOM exceptions if we load too many large
 * files into memory. Instead, prefer writing files to disk or making HTTP
 * `Range` requests.
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

export type FileProcessorTemplate<
    HasAlternative extends boolean | "ImagePreviewContent",
    HasPreview extends FileHasPreview | null,
> = {
    readonly type:
        | "WebSafeImage"
        | "WebUnsafeImage"
        | "IcoImage"
        | "PdfDocument"
        | "MicrosoftOfficeDocument"
        | "WebSafeVideo"
        | "WebUnsafeVideo"
        | "Mp4Video"
        | "WebSafeAudio"
        | "WebUnsafeAudio"
        | "Mp4Audio"
        | "Code";
    readonly hasAlternative: HasAlternative;
    readonly hasPreview: HasPreview;

    process(
        context: FileProcessorActionContext,
        options: {
            spaceId: SpaceId;
            fileId: FileId;
            signal: AbortSignal;
            contentLength: number;
            parentTemporaryDirectoryPath: string;
            withTemporaryDirectory: () => Promise<string>;
        },
    ): MaybePromise<
        FileProcessorTemplateResultPromises<FileProcessorTemplateResult<HasAlternative, HasPreview>>
    >;
};

type FileProcessorTemplateResultPromises<Result extends {[key: string]: unknown}> = {
    [Key in keyof Result as `${Key & string}Promise`]: Result[Key] extends undefined
        ? undefined
        : Promise<Result[Key]>;
};

type FileProcessorTemplateResult<
    HasAlternative extends boolean | "ImagePreviewContent",
    HasPreview extends FileHasPreview | null,
> = MergeObjectIntersection<
    (HasAlternative extends "ImagePreviewContent"
        ? {
              imagePreviewContent: {
                  contentType: FileContentType;
                  contentLength: number;
                  data: Buffer | ReadableStream;
              };
              alternative?: undefined;
          }
        : If<
              HasAlternative & boolean,
              {
                  alternative: {
                      contentType: FileContentType;
                      contentLength: number;
                      data: Buffer | ReadableStream;
                  } | null;
              },
              {alternative?: undefined}
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
    imagePreviewSize: FileImagePreviewSize &
        If<HasPreview["hasVideoDuration"], {videoDuration?: number}, {videoDuration?: undefined}>;
    imagePreviewPlaceholder: FileImagePreviewPlaceholder;
} & If<
    HasPreview["hasContent"],
    {
        imagePreviewContent: {
            contentType: FileContentType;
            contentLength: number;
            data: Buffer | ReadableStream;
        };
    },
    {imagePreviewContent?: undefined}
> &
    If<
        HasPreview["hasVideoDuration"],
        {imagePreviewVideoDuration: number},
        {imagePreviewVideoDuration?: undefined}
    > & {
        audioPreviewDuration?: undefined;
        audioPreviewMetadata?: undefined;
        codePreviewContent?: undefined;
    };

type FileProcessorTemplateResultFromHasAudioPreview = {
    audioPreviewDuration: number;
    audioPreviewMetadata: FileAudioPreviewMetadata;
    imagePreviewSize?: undefined;
    imagePreviewPlaceholder?: undefined;
    imagePreviewContent?: undefined;
    imagePreviewVideoDuration?: undefined;
    codePreviewContent?: undefined;
};

type FileProcessorTemplateResultFromHasCodePreview = {
    codePreviewContent: FileCodePreviewContent;
    imagePreviewSize?: undefined;
    imagePreviewPlaceholder?: undefined;
    imagePreviewContent?: undefined;
    imagePreviewVideoDuration?: undefined;
    audioPreviewDuration?: undefined;
    audioPreviewMetadata?: undefined;
};

export const fileNoopProcessor: FileProcessor = {
    type: "Noop",
    hasAlternative: false,
    hasPreview: null,
};
