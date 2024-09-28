import {spawn} from "child_process";
import addMinutes from "date-fns/addMinutes/index.js";
import fsSync from "fs";
import fs from "fs/promises";
import {IncomingMessage, ServerResponse} from "http";
import {join as joinPath} from "path";
import {finished} from "stream/promises";
import {FileUploadServiceActionContext} from "~/server/files/upload/file_upload_service_context.js";
import {
    ffmpegExecutablePath,
    parseFfmpegStderrInputCodecNames,
} from "~/server/files/upload/processors/file_video_and_audio_processor_base.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {getProcessEnvToPropagate} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {withTemporaryDirectory} from "~/server/helpers/node/with_temporary_directory.js";
import {InvalidArgumentError, PermissionDeniedError, UnknownError} from "~/shared/error/error.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

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
 * `FileUploadService` saves us some money.
 *
 * Ultimately, we decided that it's not hard to extend `FileUploadService`,
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
 * `FileUploadService` uses two tools which can perform image resizing. FFmpeg
 * and sharp. We use FFmpeg since it has better stream input/output support.
 * `sharp` has a stream input API but in reality that API waits for the stream
 * to complete, builds the full buffer in memory, and sends that to its native
 * libvips dependency. FFmpeg, on the other hand, is an executable we can
 * stream data into via stdin. But even better, FFmpeg supports HTTP inputs
 * which is great for when a seekable input is required! We can provide a
 * presigned Cloudflare R2 URL to FFmpeg and it'll efficiently load the data
 * it needs.
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
    context: FileUploadServiceActionContext,
    parentSpan: TracerSpan,
    req: IncomingMessage,
    res: ServerResponse<IncomingMessage>,
    {
        url,
        spaceId,
        fileId,
        variant,
        temporaryDirectoryPath: parentTemporaryDirectoryPath,
    }: {
        url: URL;
        spaceId: SpaceId;
        fileId: FileId;
        variant: "preview" | undefined;
        temporaryDirectoryPath: string;
    },
): Promise<void> {
    parentSpan.addPropagatedData({context: {fileId}});

    if (req.method !== "GET") throw new InvalidArgumentError("Invalid HTTP request method");

    // Make sure we've been proxied through `EdgeService` when uploading a file. We
    // don't support resizing from other services like `JobQueueService`.
    if (context.actor.serviceName !== "EdgeService")
        throw new PermissionDeniedError("Only `EdgeService` can resize a file");

    // Make sure `EdgeService` is using a system action to resize. That way we
    // don't have to authenticate file access through attachments.
    context.actor.authorizeSystem();

    const widthString = url.searchParams.get("width");
    if (!widthString) throw new InvalidArgumentError('Missing required "width" URL search param');

    const width = parseInt(widthString, 10);
    if (!/^\d+$/.test(widthString) || !Number.isInteger(width) || width <= 0)
        throw new InvalidArgumentError('"width" URL search param must be a positive integer');

    parentSpan.addData({common: {width}});

    await withTemporaryDirectory(
        parentTemporaryDirectoryPath,
        `${fileId}_${width}_`,
        async temporaryDirectoryPath => {
            const outputPath = joinPath(temporaryDirectoryPath, "output.avif");

            const inputUrl = await context.r2.getGetObjectSignedUrl(addMinutes(new Date(), 10), {
                Bucket: filesBucketName,
                Key: `${spaceId}/${fileId}${variant ? `-${variant}` : ""}`,
            });

            await parentSpan.withSpan("FFmpeg resize image", async span => {
                span.addData({common: {width}});

                const subprocess = spawn(
                    ffmpegExecutablePath,
                    [
                        // Input is coming directly from Cloudflare R2. It'll be streamed into FFmpeg
                        // and if FFmpeg needs to seek it can issue a subsequent range HTTP request.
                        "-i",
                        inputUrl,
                        // Only use up to 2 threads for FFmpeg to avoid resource contention
                        // in `FileUploadService`.
                        "-threads",
                        "2",
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
                        // Actually perform the resize! Some notes:
                        //
                        // - Maintain the aspect ratio by setting -1 for height
                        // - Avoid upscaling with the `min()` expression
                        //
                        // https://trac.ffmpeg.org/wiki/Scaling
                        "-vf",
                        `scale='min(${width},iw)':-1`,
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
                    },
                );

                let stderr = "";

                subprocess.stderr.on("data", (chunk: Buffer) => {
                    const string = chunk.toString("utf8");
                    stderr += string;
                });

                await waitForProcessExit(subprocess).catch(error => {
                    // We include the stderr in error messages even in production since it shouldn't
                    // contain sensitive user data. It may contain the file's duration and other
                    // metadata but it shouldn't be harmful for a developer to read that.
                    //
                    // However, including the stderr will really help us debug any issues.
                    throw new UnknownError(
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
            });

            res.writeHead(200, {
                "content-type": "image/avif",
                "content-length": (await fs.stat(outputPath)).size,
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
            });
            await finished(fsSync.createReadStream(outputPath).pipe(res));
        },
    );
}
