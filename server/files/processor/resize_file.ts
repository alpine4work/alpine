import {spawn} from "child_process";
import fsSync from "fs";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {Readable as ReadableStream} from "stream";
import {finished} from "stream/promises";
import {getFileIfExistsAsUploader} from "~/server/files/data/files_table.js";
import {FileProcessorServiceActionContext} from "~/server/files/processor/file_processor_service_context.js";
import {sharpTimeoutSeconds} from "~/server/files/processor/processors/file_image_processor_base.js";
import {
    ffmpegExecutablePath,
    ffmpegThreadCount,
    parseFfmpegStderrInputCodecNames,
} from "~/server/files/processor/processors/file_video_and_audio_processor_base.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {getProcessEnvToPropagate} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {withTemporaryDirectory} from "~/server/helpers/node/with_temporary_directory.js";
import {getFileContentTypeName} from "~/shared/content/code/get_file_content_type_name.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
    UnknownError,
} from "~/shared/error/error.js";
import {
    FileContentType,
    getFileContentTypePreferredExtension,
    isFileWebSafeImageContentType,
} from "~/shared/files/file_content_type.js";
import {FileModelData} from "~/shared/files/file_model.js";
import {
    maxFilePreviewAspectRatio,
    minFilePreviewAspectRatio,
} from "~/shared/files/min_and_max_file_preview_aspect_ratio.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

/**
 * Resize a file from Cloudflare R2. You provide the `width` as a URL search
 * param and we'll maintain the file's aspect ratio. You can't upscale the file
 * so we'll ignore `width`'s larger than the file's own width. Always outputs
 * the file as AVIF. Since AVIF is our preferred format for generating preview
 * images ([source][1], [source][2]). AVIF has full browser support, provides
 * better compression than JPEG and WebP, and has alpha channel support (unlike
 * JPEG).
 *
 * ## Why not use [Cloudflare Images][3]?
 *
 * Cloudflare has an image resizing offering. We evaluated using Cloudflare
 * Images but decided against it because:
 *
 * 1. As of 2024-09-27 Cloudflare Images doesn't support AVIF as an input format
 *    ([source][4], [source][5]). Which is the format we generate preview images
 *    in.
 *
 * 2. As of 2024-09-27 Cloudflare Images doesn't directly support resizing
 *    images from Cloudflare R2 in Cloudflare Workers. It's resize API for
 *    Cloudflare Workers is on the [`cf` object passed to `fetch()`][6] which
 *    doesn't have an equivalent for the R2 workers binding. So instead, you
 *    need to use a workaround like using [`aws4fetch` instead of the
 *    Cloudflare R2 binding][7].
 *
 * 2 we can workaround, 1 we can't. We'd have create `.jpeg` preview images
 * instead which would increase our storage costs. Which isn't too big a deal
 * but is annoying.
 *
 * Cloudflare image resizing pricing didn't seem unreasonable to us but some
 * users online ([source][8]) have complained. Hopefully our own solution in
 * `FileProcessorService` saves us some money.
 *
 * Ultimately, we decided that it's not hard to extend `FileProcessorService`,
 * which is already responsible for a lot of file manipulations, to support
 * resizing. And it gives us flexibility in the future to optimize our solution
 * for cost.
 *
 * Cloudflare's image resizing product is probably faster. So it may be worth
 * considering migrating one day. The fastest possible implementation is likely
 * some Rust Cloudflare Worker that performs resizing at the edge. This is
 * probably what Cloudflare's image resizing product is doing. We could write a
 * worker that does this ourselves if we wanted to optimize our solution for
 * speed.
 *
 * ## Why use FFmpeg instead of `sharp`?
 *
 * `FileProcessorService` uses two tools which can perform image resizing.
 * FFmpeg and sharp. We use FFmpeg since it has better stream input/output
 * support. `sharp` has a stream input API but in reality that API waits for
 * the stream to complete, builds the full buffer in memory, and sends that to
 * its native libvips dependency. FFmpeg, on the other hand, is an executable
 * we can stream data into via stdin. But even better, FFmpeg supports HTTP
 * inputs which is great for when a seekable input is required! We can provide
 * a presigned Cloudflare R2 URL to FFmpeg and it'll efficiently load the data
 * it needs.
 *
 * Also `sharp` only supports still images. So to resize animated GIFs and keep
 * the animation we need to use FFmpeg.
 *
 * [1]: https://medium.com/@julienetienne/why-you-should-use-avif-over-jpeg-webp-png-and-gif-in-2024-5603ac9d8781
 * [2]: https://jakearchibald.com/2020/avif-has-landed
 * [3]: https://developers.cloudflare.com/images
 * [4]: https://developers.cloudflare.com/images/transform-images
 * [5]: https://community.cloudflare.com/t/support-avif-as-input-images/667113
 * [6]: https://developers.cloudflare.com/images/transform-images/transform-via-workers
 * [7]: https://community.cloudflare.com/t/transfrom-image-via-worker/666917/2?u=calebmeredith8
 * [8]: https://www.reddit.com/r/CloudFlare/comments/17do770/new_cloudflare_images_pricing_still_seems/
 */
export async function resizeFile(
    context: FileProcessorServiceActionContext,
    parentSpan: TracerSpan,
    {
        url,
        request,
        spaceId,
        fileId,
        temporaryDirectoryPath: parentTemporaryDirectoryPath,
        withFiber,
    }: {
        url: URL;
        request: Request;
        spaceId: SpaceId;
        fileId: FileId;
        temporaryDirectoryPath: string;
        // TODO(ifitzsimmons, #file-processor-service-migration): Remove this
        // parameter once we've migrated to the new service. We will no longer need
        // to worry about process fibers when this hosted only on AWS Lambda
        withFiber: <Modules extends {tracer: TracerContextModule}, Value>(
            context: Context<Modules>,
            action: () => Promise<Value>,
        ) => Promise<Value>;
    },
): Promise<Response> {
    parentSpan.addPropagatedData({context: {fileId}});

    if (request.method !== "GET") throw new InvalidArgumentError("Invalid HTTP request method");

    // Make sure we've been proxied through `EdgeService` when uploading a file. We
    // don't support resizing from other services like `JobQueueService`.
    if (context.actor.serviceName !== "EdgeService")
        throw new PermissionDeniedError("Only `EdgeService` can resize a file");

    // Make sure `EdgeService` is using a system action to resize. That way we
    // don't have to authenticate file access through attachments.
    context.actor.authorizeSystem();

    const widthString = url.searchParams.get("width");
    if (!widthString) throw new InvalidArgumentError("Missing required `width` URL search param");

    const width = parseInt(widthString, 10);
    if (!/^\d+$/.test(widthString) || !Number.isInteger(width) || width <= 0)
        throw new InvalidArgumentError("`width` URL search param must be a positive integer");

    const variant = url.searchParams.get("variant");
    if (variant !== null && variant !== "preview" && variant !== "alternative") {
        throw new InvalidArgumentError(`Search param \`variant\` is not a valid file variant`);
    }

    parentSpan.addData({common: {width}});

    // To use resources more efficiently we run our resize in a `JobQueueConsumer`
    // fiber. That way if our CPU is busy processing files from the job queue we
    // wait to resize until that's done. Also if multiple resize requests come in
    // at once we'll throttle processing to a rate our machine can handle.
    return withFiber(context, () =>
        withTemporaryDirectory(parentTemporaryDirectoryPath, `${fileId}_${width}_`, run),
    );

    async function run(temporaryDirectoryPath: string) {
        // If while waiting on a fiber the request was aborted then throw. Don't
        // process the request.
        if (request.signal.aborted) throw request.signal.reason;

        const outputPath = joinPath(temporaryDirectoryPath, "output.avif");

        const file = await getFileIfExistsAsUploader(context, spaceId, fileId);

        if (!file) {
            return new Response("404 Not Found", {
                status: 404,
                headers: {"content-type": "text/plain"},
            });
        }

        const fileData = file.initialData;
        let contentType: FileContentType;

        if (variant === "preview") {
            if (fileData.preview?.type !== "Image") {
                throw new FailedPreconditionError(
                    "File preview variants only exist for files with an image preview",
                );
            }

            if (fileData.preview.content === undefined) {
                throw new FailedPreconditionError("File preview variant doesn’t exist");
            }

            if (typeof fileData.preview.content === "string") {
                throw new FailedPreconditionError(
                    quote`File preview variant isn’t accessible because image preview is in ${fileData.preview.content} state`,
                );
            }

            contentType = fileData.preview.content.contentType;
        } else if (variant === "alternative") {
            if (fileData.alternative === null) {
                throw new FailedPreconditionError("File alternative variant doesn’t exist");
            }

            if (fileData.alternative.isProcessing) {
                throw new FailedPreconditionError(
                    "File alternative variant isn’t accessible because it’s processing",
                );
            }

            if (!fileData.alternative.ok) {
                throw new FailedPreconditionError(
                    "File alternative variant isn’t accessible because it failed to process",
                );
            }

            // A Cloudflare object won't exist with the suffix `-alternative` if the file's
            // alternative is backed by image preview content.
            if (fileData.alternative.isImagePreviewContent) {
                throw new FailedPreconditionError(
                    "File alternative is stored as the file’s image preview content, you must use a variant of `preview` instead",
                );
            }

            contentType = fileData.alternative.contentType;
        } else {
            contentType = file.contentType;
        }

        parentSpan.addData({file: getTracerEventFileData(fileData)});

        if (!isFileWebSafeImageContentType(contentType)) {
            throw new FailedPreconditionError(
                quote`Can only resize web safe image but instead got content type ${contentType}`,
            );
        }

        if (contentType === "image/svg+xml") {
            throw new FailedPreconditionError(
                quote`Content type ${contentType} is a vector format, resizing is pointless`,
            );
        }

        let isDefinitelyMissingAlphaChannel = false;

        if (contentType === "image/jpeg") {
            isDefinitelyMissingAlphaChannel = true;
        } else if (contentType === "image/png" || contentType === "image/apng") {
            if (fileData.preview?.type !== "Image" || typeof fileData.preview.size === "string") {
                throw new FailedPreconditionError("Preview size has not finished processing");
            }

            isDefinitelyMissingAlphaChannel = !fileData.preview.size.hasAlpha;
        }

        const object = await context.r2.GetObject({
            Bucket: filesBucketName,
            Key: `${spaceId}/${fileId}${variant !== null ? `-${variant}` : ""}`,
        });

        assert(object.Body instanceof ReadableStream);

        const inputPath = joinPath(
            temporaryDirectoryPath,
            `input.${getFileContentTypePreferredExtension(file.contentType)}`,
        );

        const inputWriteStream = fsSync.createWriteStream(inputPath);

        await finished(object.Body.pipe(inputWriteStream));

        await parentSpan.withSpan(
            `FFmpeg resize ${getFileContentTypeName(contentType)} as ${getFileContentTypeName(
                "image/avif",
            )}`,
            async span => {
                span.addData({
                    file: {contentType, contentLength: file.contentLength},
                    common: {width},
                });

                const filter = [
                    // Crop the image so it doesn't exceed our min/max aspect ratio. We render the
                    // resized image in a preview so generating extra image that won't be displayed
                    // in the preview box is wasteful since we'd need to send those bytes to the
                    // client only to crop them out.
                    //
                    // We position the cropped image as if `object-position: center top` is set.
                    //
                    // https://ffmpeg.org/ffmpeg-filters.html#crop
                    //
                    // eslint-disable-next-line string-quotes
                    `crop='h=min(ih,iw/${minFilePreviewAspectRatio})':'w=min(iw,ih*${maxFilePreviewAspectRatio})':y=0:x=iw/2-ow/2`,
                    // Actually perform the resize! Some notes:
                    //
                    // - Maintain the aspect ratio by setting -1 for height
                    // - Avoid upscaling with the `min()` expression
                    //
                    // https://trac.ffmpeg.org/wiki/Scaling
                    //
                    // eslint-disable-next-line string-quotes
                    `scale='min(${width},iw)':-1`,
                ].join(",");

                const subprocess = spawn(
                    ffmpegExecutablePath,
                    [
                        // We download the file from Cloudflare R2 to our temporary directory since
                        // we've seen some bugs when FFmpeg is provided a URL (which puts it in
                        // streaming mode).
                        //
                        // See:
                        // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/cxpqqg6pcz846nda3fxthwn0pw
                        "-i",
                        inputPath,
                        // Limit the number of threads for FFmpeg to reduce resource contention
                        // in `FileProcessorService`.
                        "-threads",
                        String(ffmpegThreadCount),
                        // Dealing with the `.avif` format in FFmpeg is annoying. A transparent `.avif`
                        // image has two streams, a grayscale alpha channel stream and an color
                        // stream. Whereas a transparent `.png` image has just one RGBA color stream.
                        //
                        // So for any transparent image we need to make sure we have two streams that
                        // go into the `.avif` encoder. The first being the color stream and the second
                        // being the alpha stream.
                        //
                        // - `.jpeg` files don't have transparency so we apply the filter to the one
                        //   stream and that's it
                        //
                        // - `.avif` files with transparency have two streams. The first is their alpha
                        //   grayscale stream and the second is their color stream. We need to flip the
                        //   order of these streams before passing them into our `.avif` encoder.
                        //
                        // - Any file type that's not `.avif` (e.g. `.png`) we create a second stream
                        //   with the `alphaextract` filter to just get the alpha part of the image.
                        //   Then we pass those two streams to our `.avif` encoder.
                        //
                        //
                        // NOTE(calebmer, 2024-10-04): Animated AVIF files I've found have four
                        // streams. The first two streams appear to be still screenshots and the second
                        // two streams are the animated grayscale/color streams. So I'm not sure if
                        // non-animated AVIFs are consistently 2 streams in the order grayscale, color
                        // in FFmpeg or just what I've tested with. Likewise I'm not sure if animated
                        // AVIFs are consistently 4 streams in a predictable order. Hopefully, FFmpeg
                        // always returns AVIF streams in a consistent order. If not we'll need to use
                        // `ffprobe` to figure out the right streams to use. But that's annoying since
                        // we don't have the input file data available in memory.
                        ...(isDefinitelyMissingAlphaChannel
                            ? ["-vf", filter]
                            : contentType === "image/avif"
                            ? ["-map", "0:v:1?", "-map", "0:v:0", "-vf", filter]
                            : [
                                  "-filter_complex",
                                  `[0:v]${filter}[out];[0:v]alphaextract,${filter}[out_alpha]`,
                                  "-map",
                                  "[out]",
                                  "-map",
                                  "[out_alpha]",
                              ]),
                        // Output file is in `.avif` format.
                        //
                        // AVIF is our preferred format for generating preview images ([source][1],
                        // [source][2]). AVIF has full browser support, provides better compression
                        // than JPEG and WebP, and has alpha channel support (unlike JPEG).
                        //
                        // [1]: https://medium.com/@julienetienne/why-you-should-use-avif-over-jpeg-webp-png-and-gif-in-2024-5603ac9d8781
                        // [2]: https://jakearchibald.com/2020/avif-has-landed
                        "-f",
                        "avif",
                        // Should control quality. Quality is between 0 and 63 where 0 is the best
                        // quality (lossless). We want relatively high quality preview images while
                        // still getting some compression.
                        //
                        // https://trac.ffmpeg.org/wiki/Encode/AV1#ConstantQuality
                        "-crf",
                        "10",
                        // Prefer faster encoding and less efficient compression. The default is
                        // 1 which is heavily balanced towards preferring slower encoding and more
                        // efficient compression.
                        //
                        // Since users may be waiting on our resize operation to view a file (in case
                        // of cache miss) we want to respond quickly without sacrificing too much
                        // compression.
                        //
                        // https://trac.ffmpeg.org/wiki/Encode/AV1#ControllingSpeedQuality
                        "-cpu-used",
                        "6",
                        // We must output to a file. We can't output to stdout when taking a screenshot
                        // or else we get the error "[avif] muxer does not support non seekable
                        // output".
                        //
                        // Ideally we'd pipe `subprocess.stdout` to `res` so we don't have to create a
                        // temporary file on disk but AVIF doesn't support this unfortunately.
                        outputPath,
                    ],
                    {
                        cwd: runfilesPath,
                        env: getProcessEnvToPropagate(),
                        stdio: ["ignore", "pipe", "pipe"],
                        timeout: sharpTimeoutSeconds * 1000,
                    },
                );

                let stderr = "";

                subprocess.stderr.on("data", (chunk: Buffer) => {
                    const string = chunk.toString("utf8");
                    stderr += string;
                });

                await waitForProcessExit(subprocess).catch(error => {
                    const ErrorConstructor =
                        /^\[in#0 [^\]]*\] Error opening input: Server returned 404 Not Found/m.test(
                            stderr,
                        )
                            ? NotFoundError
                            : UnknownError;

                    // We include the stderr in error messages even in production since it shouldn't
                    // contain sensitive user data. It may contain the file's duration and other
                    // metadata but it shouldn't be harmful for a developer to read that.
                    //
                    // However, including the stderr will really help us debug any issues.
                    throw new ErrorConstructor(
                        `${
                            error instanceof Error ? error.message : String(error)
                        }\n\nstderr:\n${stderr.trim()}`,
                        {
                            cause: error instanceof Error ? error.cause : undefined,
                        },
                    );
                });

                span.addData({
                    ffmpeg: {
                        codecs: parseFfmpegStderrInputCodecNames(stderr),
                    },
                });
            },
        );

        return new Response(
            ReadableStream.toWeb(
                fsSync.createReadStream(outputPath),
            ) as globalThis.ReadableStream<Uint8Array>,
            {
                status: 200,
                // We need to return the same headers between here and `fetchFile()` in
                // `server/edge`. If you add a header here you should also add a header there.
                headers: {
                    "content-type": "image/avif",
                    "content-length": String((await fs.stat(outputPath)).size),
                    // After resizing, the result should be cached.
                    //
                    // - `private`: A user can only see files they have access to. Don't store
                    //   files in a shared cache since an attacker may be able to see a file they
                    //   don't have access to.
                    //
                    // - `immutable`: Files are immutable after they've been uploaded. While
                    //   hitting this route will resize the file on demand causing the bytes to not
                    //   be strictly the same over time, the perceived result to the end user will
                    //   never change so it's safe to cache this response as an immutable value.
                    //
                    // - `max-age`: Keep our response cached for 30 days. It's fine to get rid of
                    //   the file after that and request again if needed.
                    "cache-control": `private, immutable, max-age=${60 * 60 * 24 * 30}`,
                },
            },
        );
    }
}

function getTracerEventFileData(file: FileModelData): NonNullable<TracerEventData["file"]> {
    let preview: NonNullable<TracerEventData["file"]>["preview"];
    let alternative: NonNullable<TracerEventData["file"]>["alternative"];

    if (file.alternative && !file.alternative.isProcessing && file.alternative.ok) {
        alternative = {
            contentType: file.alternative.contentType,
            contentLength: file.alternative.contentLength,
            contentLengthRatio: file.alternative.contentLength / file.contentLength,
        };
    }

    if (file.preview && !file.preview.isProcessing && file.preview.ok) {
        preview = {
            contentType:
                file.preview.type === "Image" && file.preview.content
                    ? file.preview.content.contentType
                    : undefined,
            contentLength:
                file.preview.type === "Image" && file.preview.content
                    ? file.preview.content.contentLength
                    : undefined,
            contentLengthRatio:
                file.preview.type === "Image" && file.preview.content
                    ? file.preview.content.contentLength / file.contentLength
                    : undefined,
            imageWidth: file.preview.type === "Image" ? file.preview.size.width : undefined,
            imageHeight: file.preview.type === "Image" ? file.preview.size.height : undefined,
            imageScale: file.preview.type === "Image" ? file.preview.size.scale : undefined,
            imageHasAlpha: file.preview.type === "Image" ? file.preview.size.hasAlpha : undefined,
            imageVideoDurationMs:
                file.preview.type === "Image" ? file.preview.videoDuration : undefined,
            audioDurationMs: file.preview.type === "Audio" ? file.preview.duration : undefined,
            codeContentLength:
                file.preview.type === "Code" ? file.preview.content.serialize().length : undefined,
        };
    }

    return {
        contentType: file.contentType,
        contentLength: file.contentLength,
        alternative,
        preview,
    };
}
