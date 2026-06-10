import {availableParallelism} from "os";
import {join as joinPath} from "path";
import {FileProcessorActionContext} from "~/server/files/data/file_processor_context.js";
import {runProcess} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {getFileContentTypeName} from "~/shared/content/code/get_file_content_type_name.js";
import {InternalError} from "~/shared/error/error.js";
import {
    FileContentType,
    FileMp4AudioContentType,
    FileWebSafeAudioContentType,
    FileWebUnsafeAudioContentType,
} from "~/shared/files/file_content_type.js";
import {FileAudioPreviewMetadata, FileImagePreviewSize} from "~/shared/files/file_preview.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {quote} from "~/shared/helpers/string/quote.js";

export const ffmpegExecutablePath = joinPath(runfilesPath, "ffmpeg/install/bin/ffmpeg");
export const ffprobeExecutablePath = joinPath(runfilesPath, "ffmpeg/install/bin/ffprobe");

export const ffmpegImagePreviewContentOutputExtension = "avif";
export const ffmpegImagePreviewContentOutputContentType: FileContentType = "image/avif";

/**
 * The maximum number of threads for FFmpeg to use. We set this limit to avoid
 * resource contention. In unit tests we only use 1 thread since we'll be running
 * many tests in parallel.
 */
export const ffmpegThreadCount = import.meta.jest ? 1 : availableParallelism();

/**
 * What FFmpeg video codecs supported by MP4 files are web safe? We don't have to
 * transcode an alternative video file if an MP4 is only comprised of these codecs.
 */
export const ffmpegWebSafeMp4VideoCodecNames = new Set([
    "av1",
    "libaom-av1",
    "h264",
    "vp9",
    "libx-vp9",
]);

/**
 * What FFmpeg audio codecs supported by MP4 files are web safe? We don't have to
 * transcode an alternative video file if an MP4 is only comprised of these codecs.
 */
export const ffmpegWebSafeMp4AudioCodecNames = new Set([
    "flac",
    "mp3",
    "mp3float",
    "opus",
    "libopus",
    "aac",
    "aac_fixed",
    "aac_at",
]);

const ffmpegImagePreviewContentOutputOptionsBase = [
    // Only get one frame from the video.
    "-frames:v",
    "1",
    // Output file is in `.avif` format.
    //
    // AVIF is our preferred format for generating preview images ([source][1],
    // [source][2]). AVIF has full browser support, provides better compression than
    // JPEG and WebP, and has alpha channel support (unlike JPEG).
    //
    // [1]:
    //     https://medium.com/@julienetienne/why-you-should-use-avif-over-jpeg-webp-png-and-gif-in-2024-5603ac9d8781
    // [2]: https://jakearchibald.com/2020/avif-has-landed
    "-f",
    "avif",
    // Should control quality. Quality is between 0 and 63 where 0 is the best quality
    // (lossless). We want relatively high quality preview images while still getting
    // some compression.
    //
    // https://trac.ffmpeg.org/wiki/Encode/AV1#ConstantQuality
    "-crf",
    "10",
    // NOTE(ifitzsimmons, 2025-07-25) For 1920x1080 max resolution for previews, see
    // document on File Processing Benchmarks.
    // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/documents/mmcg93qv2zvzmnmqt3ec6vtexm
    // https://trac.ffmpeg.org/wiki/Scaling#fit
    "-vf",
    // eslint-disable-next-line cyberworlds/string-quotes
    "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease",
];

/**
 * Options to generate a thumbnail. Should go after any inputs. After these options
 * you need to provide an output path. The output path should use the file
 * extension `ffmpegThumbnailOutputExtension`.
 */
export const getFfmpegImagePreviewContentOutputOptions = ({
    output1Path,
    output2Path,
    output3Path,
}: {
    output1Path: string;
    output2Path: string;
    output3Path: string;
}) => [
    // Take our screenshot at 10s into the video. At 10s we're most likely to get an
    // interesting frame. The first second may be transitioning in. The optimal
    // solution is to capture a couple images and use a machine learning model to pick
    // the best one. [A 2015 blog post from YouTube describing there technique][1].
    //
    // [1]:
    //     https://research.google/blog/improving-youtube-video-thumbnails-with-deep-neural-nets
    "-ss",
    "00:00:10.000",
    ...ffmpegImagePreviewContentOutputOptionsBase,
    output1Path,

    // If the video is less than 10s long then try taking a screenshot at 1s instead.
    "-ss",
    "00:00:01.000",
    ...ffmpegImagePreviewContentOutputOptionsBase,
    output2Path,

    // If the video is less than 1s long then try taking a screenshot at the very
    // beginning.
    "-ss",
    "00:00:00.000",
    ...ffmpegImagePreviewContentOutputOptionsBase,
    output3Path,
];

/**
 * Parse the duration and width/height of the first input to FFmpeg. A regular
 * expression does all the heavy lifting for this function.
 *
 * An example FFmpeg output looks like the following. We're trying to parse our
 * metadata from the "Input #0" block. To avoid parsing anything outside of the
 * "Input #0" block we check that each line in between the "Duration:" and "Stream"
 * lines starts with at least two spaces.
 *
 * ```
 * ffmpeg version 7.0.git Copyright (c) 2000-2024 the FFmpeg developers
 *   built with Apple clang version 15.0.0 (clang-1500.1.0.2.5)
 *   configuration: --prefix=${bazel_sandbox}/bazel-out/darwin_arm64-fastbuild/bin/external/ffmpeg/install --pkg-config=${bazel_sandbox}/bazel-out/darwin_arm64-fastbuild/bin/external/ffmpeg/../pkg_config/install/bin/pkg-config --pkg-config-flags=--static --enable-static --disable-shared --disable-autodetect --disable-ffplay --disable-doc --disable-htmlpages --disable-manpages --disable-podpages --disable-txtpages --enable-libaom --enable-libvpx
 *   libavutil      59. 35.100 / 59. 35.100
 *   libavcodec     61. 11.100 / 61. 11.100
 *   libavformat    61.  5.101 / 61.  5.101
 *   libavdevice    61.  2.100 / 61.  2.100
 *   libavfilter    10.  2.102 / 10.  2.102
 *   libswscale      8.  2.100 /  8.  2.100
 *   libswresample   5.  2.100 /  5.  2.100
 * Input #0, matroska,webm, from 'pipe:0':
 *   Metadata:
 *     ENCODER         : Lavf61.5.101
 *   Duration: 00:00:07.61, start: 0.000000, bitrate: N/A
 *   Stream #0:0(eng): Video: vp9 (Profile 0), yuv420p(tv, bt470bg/unknown/unknown, progressive), 240x135, SAR 1:1 DAR 16:9, 23.98 fps, 23.98 tbr, 1k tbn (default)
 *       Metadata:
 *         ENCODER         : Lavc61.11.100 libvpx-vp9
 *         DURATION        : 00:00:07.591000000
 *   Stream #0:1(eng): Audio: vorbis, 48000 Hz, stereo, fltp (default)
 *       Metadata:
 *         DURATION        : 00:00:07.609000000
 * Stream mapping:
 *   Stream #0:0 -> #0:0 (vp9 (native) -> av1 (libaom-av1))
 * [libaom-av1 @ 0x12d806d80] v3.9.1
 * Output #0, avif, to '...':
 *   Metadata:
 *     encoder         : Lavf61.5.101
 *   Stream #0:0(eng): Video: av1 (av01 / 0x31307661), yuv420p(tv, bt470bg/unknown/unknown, progressive), 240x135 [SAR 1:1 DAR 16:9], q=2-31, 23.98 fps, 24k tbn (default)
 *       Metadata:
 *         DURATION        : 00:00:07.591000000
 *         encoder         : Lavc61.11.100 libaom-av1
 *       Side data:
 *         cpb: bitrate max/min/avg: 0/0/0 buffer size: 0 vbv_delay: N/A
 * [out#0/avif @ 0x600003168000] video:8KiB audio:0KiB subtitle:0KiB other streams:0KiB global headers:0KiB muxing overhead: 3.524067%
 * frame=    1 fps=0.0 q=0.0 Lsize=       8KiB time=00:00:00.04 bitrate=1617.1kbits/s speed=0.135x
 * ```
 */
export function parseFileImagePreviewSizeAndVideoDurationIfPossibleFromFfmpegStderr(
    stderr: string,
    hasAlpha: boolean,
): (FileImagePreviewSize & {videoDuration?: number}) | null {
    const match = stderr.match(
        // Notes:
        //
        // - If there is no duration metadata then we'll see "Duration: N/A". We need to
        //   parse this as `videoDuration: undefined`.
        //
        // - There may be multiple lines between "Input #0", "Duration", and "Stream". To
        //   make sure "Duration" and "Stream" are under "Input #0" we only skip over lines
        //   that start with two spaces. So we know we're indented under "Input #0". That's
        //   what `(?:  .*\n)*?` is doing.
        //
        // - Our dimension capture group is written as `([1-9][0-9]*x[1-9][0-9]*)` so we
        //   don't parse strings that start with "0x" (representing a hex code) as
        //   dimensions. For example we've seen strings that include "Video: mpeg2video
        //   (Main) (m2v1 / 0x3176326D), ..." where "0x3176326" (without the "D") was being
        //   interpreted as dimensions.
        //
        // `parseFileAudioPreviewDurationIfPossibleFromFfmpegStderr()` has a modified
        // version of this regular expression. If you make an update here you may also need
        // to make it there.
        /(?:^|\n)Input #0\D.*\n(?:  .*\n)*?  Duration: *(N\/A|\d\d:\d\d:\d\d(?:\.\d+)?).*\n(?:  .*\n)*?  Stream #0:.*?: Video: .*?([1-9][0-9]*x[1-9][0-9]*)/,
    );
    if (!match) return null;

    const dimensionsString = match[2] ?? "";
    const [widthString = "", heightString = ""] = dimensionsString.split("x", 2);

    const width = parseInt(widthString, 10);
    const height = parseInt(heightString, 10);

    assert(!isNaN(width));
    assert(!isNaN(height));
    assert(Number.isSafeInteger(width));
    assert(Number.isSafeInteger(height));

    const durationString = match[1] ?? "";
    let duration: number | undefined;
    if (durationString !== "N/A") {
        duration = parseFfmpegStderrDuration(durationString);
    }

    return {
        width,
        height,
        scale: 1,
        hasAlpha,
        videoDuration: duration,
    };
}

/**
 * Parse the duration of the first input to FFmpeg. A regular expression does all
 * the heavy lifting for this function.
 *
 * This is a simpler version of
 * `parseFileImagePreviewSizeAndVideoDurationIfPossibleFromFfmpegStderr()` since
 * for audio we only need the duration. There aren't dimensions we need to parse as
 * well.
 */
export function parseFileAudioPreviewDurationIfPossibleFromFfmpegStderr(
    stderr: string,
): number | null {
    const match = stderr.match(
        // A modified version of
        // `parseFileImagePreviewSizeAndVideoDurationIfPossibleFromFfmpegStderr()`'s
        // regular expression that only looks for duration. If you make a change to this
        // regular expression you should change that one as well.
        /(?:^|\n)Input #0\D.*\n(?:  .*\n)*?  Duration: *(N\/A|\d\d:\d\d:\d\d(?:\.\d+)?)/,
    );
    if (!match) return null;

    const durationString = match[1] ?? "";
    let duration: number | null = null;
    if (durationString !== "N/A") {
        duration = parseFfmpegStderrDuration(durationString);
    }

    return duration;
}

/**
 * The duration string must match the regular expression `\d\d:\d\d:\d\d(?:\.\d+)?`
 * or else you'll get assertion failures.
 */
export function parseFfmpegStderrDuration(durationString: string): number {
    const [durationHoursString = "", durationMinutesString = "", durationSecondsString = ""] =
        durationString.split(":", 3);

    const durationHours = parseInt(durationHoursString, 10);
    const durationMinutes = parseInt(durationMinutesString, 10);
    const durationSeconds = parseFloat(durationSecondsString);

    assert(!isNaN(durationHours));
    assert(!isNaN(durationMinutes));
    assert(!isNaN(durationSeconds));
    assert(Number.isSafeInteger(durationHours));
    assert(Number.isSafeInteger(durationMinutes));
    assert(Number.isFinite(durationSeconds));

    return Math.ceil(((durationHours * 60 + durationMinutes) * 60 + durationSeconds) * 1000);
}

const ffmpegStderrCodecNameRegExpExpression =
    "(?:  .*\\n)*?(?:  Stream #.* (?:Video|Audio): +([a-zA-Z0-9-_]+).*\\n)";

// Only parses up to 4 codec names.
const ffmpegStderrInputCodecNamesRegExp = new RegExp(
    `(?:^|\\n)Input #.*\\n${ffmpegStderrCodecNameRegExpExpression}(?:${ffmpegStderrCodecNameRegExpExpression})?(?:${ffmpegStderrCodecNameRegExpExpression})?(?:${ffmpegStderrCodecNameRegExpExpression})?`,
);

/**
 * Parse codec names included in the first input in the provided FFmpeg stderr
 * output.
 */
export function parseFfmpegStderrInputCodecNames(stderr: string): string | undefined {
    const match = stderr.match(ffmpegStderrInputCodecNamesRegExp);
    if (!match) return undefined;

    const codecNames = Array.from(match.slice(1))
        .filter(codecName => typeof codecName === "string" && codecName.length > 0)
        .join("/");

    return codecNames;
}

const defaultFileAudioPreviewMetadata: FileAudioPreviewMetadata = {
    title: null,
    artist: null,
    album: null,
};

export function getFileAudioPreviewMetadataFromFfprobeMetadata(
    metadata: unknown,
): FileAudioPreviewMetadata {
    if (!isObject(metadata)) return defaultFileAudioPreviewMetadata;
    if (!isObject(metadata.format)) return defaultFileAudioPreviewMetadata;
    if (!isObject(metadata.format.tags)) return defaultFileAudioPreviewMetadata;

    return {
        title:
            typeof metadata.format.tags.title === "string"
                ? metadata.format.tags.title
                : typeof metadata.format.tags.TITLE === "string"
                  ? metadata.format.tags.TITLE
                  : null,
        artist:
            typeof metadata.format.tags.artist === "string"
                ? metadata.format.tags.artist
                : typeof metadata.format.tags.ARTIST === "string"
                  ? metadata.format.tags.ARTIST
                  : null,
        album:
            typeof metadata.format.tags.album === "string"
                ? metadata.format.tags.album
                : typeof metadata.format.tags.ALBUM === "string"
                  ? metadata.format.tags.ALBUM
                  : null,
    };
}

/**
 * Run `ffprobe` to get the audio file's metadata. The metadata is then typically
 * passed into `getFileAudioPreviewMetadataFromFfprobeMetadata()`.
 */
export function getFfprobeMetadata(
    context: FileProcessorActionContext,
    inputUrl: string,
    {
        signal,
        contentType,
        contentLength,
    }: {
        signal: AbortSignal;
        contentType:
            | FileWebSafeAudioContentType
            | FileMp4AudioContentType
            | FileWebUnsafeAudioContentType;
        contentLength: number;
    },
) {
    return retryWithExponentialBackoff(async retry => {
        let shouldRetry = false;

        try {
            // Even though technically we're using the FFprobe executable we still name the
            // span "FFmpeg ..." which'll make it easier for us to search for spans that call
            // one of the FFmpeg tools.
            const metadata = await context.tracer.withSpan(
                `FFmpeg get ${getFileContentTypeName(contentType)} metadata`,
                async (context, span) => {
                    span.addData({
                        file: {contentType, contentLength},
                    });

                    let stderr = "";

                    const metadataString = await runProcess(
                        ffprobeExecutablePath,
                        [["-print_format", "json"], "-show_streams", "-show_format", inputUrl],
                        {
                            cwd: runfilesPath,
                            signal,
                            onStderrData: string => {
                                stderr += string;
                            },
                        },
                    );

                    let metadata: unknown;
                    try {
                        metadata = JSON.parse(metadataString);
                    } catch (error) {
                        // If `runProcess()` exited with code zero but didn't return JSON then retry. We've
                        // found this `ffprobe` call is flaky in CI.
                        shouldRetry = true;

                        if (!(error instanceof Error)) throw error;

                        // We're observing some flaky errors in unit tests where `metadataString` fails to
                        // parse as JSON. So if we're running a unit test log the string to help us debug.
                        throw new InternalError(
                            !import.meta.jest
                                ? error.message
                                : `${error.message}\n\nstring: ${quote(
                                      metadataString,
                                  )}\n\nstderr:\n${stderr.trim()}`,
                        );
                    }

                    return metadata;
                },
            );

            return metadata;
        } catch (error) {
            if (shouldRetry) {
                // NOTE(calebmer): I don't know why this is flaky in CI. Perhaps there's a network
                // issue given we're providing an HTTP URL to `ffprobe`. When I added this retry we
                // weren't logging the `stderr`. There may be information in the `stderr` which
                // helps us write a better fix. So if we're retrying, log a message to the console
                // asking a future developer to remove this retry and make a proper fix using
                // information from stderr.
                //
                // If there's no information in stderr and `ffprobe` is just...flaky, then you can
                // remove these logs.
                if (import.meta.jest) {
                    // eslint-disable-next-line no-console
                    console.warn(
                        "Retrying `ffprobe` call that returned invalid JSON, we know this `ffprobe` call\n" +
                            "is flaky in CI but don\u2019t know why it\u2019s flaky. If you see this message, look at\n" +
                            "the stderr included in the error message and determine if there\u2019s a better fix\n" +
                            "than retrying.\n\n" +
                            (error instanceof Error ? error.stack : String(error)),
                    );
                }

                throw retry(error);
            }

            throw error;
        }
    });
}
