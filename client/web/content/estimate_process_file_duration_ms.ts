import {FileContentType} from "~/shared/files/file_content_type.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/**
 * Returns the estimated processing throughput for a content type in bytes per
 * millisecond. Higher values mean faster processing.
 *
 * These values are averages from local test runs. They're rough approximations but
 * useful for progress estimation.
 *
 * @see
 * https://docs.google.com/spreadsheets/d/1RQLVSJc8_2oPTX0c1fB7vUxu1PR9Duq9zp-ElAmf_IM/edit?usp=sharing
 */
export function getFileContentTypeThroughputBytesPerMs(contentType: FileContentType): number {
    switch (contentType) {
        case "application/msword":
            return 18.09815219;
        case "application/octet-stream":
            return 93.80196523;
        case "application/pdf":
            return 177.3403432;
        case "application/vnd.ms-excel":
            return 2.743330625;
        case "application/vnd.ms-powerpoint":
            return 44.84963899;
        case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
            return 15.98706928;
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
            return 2.123474362;
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            return 21.21859109;
        case "audio/mp4":
            return 15744.46483;
        case "audio/mpeg":
            return 4439.042376;
        case "audio/ogg":
            return 1036.891891;
        case "audio/wav":
            return 12387.85636;
        case "audio/webm":
            return 2348.717498;
        case "image/apng":
            return 2756.044911;
        case "image/avif":
            return 1024.810509;
        case "image/bmp":
            return 1479.78116;
        case "image/gif":
            return 4615.565697;
        case "image/heif":
            return 116.2905182;
        case "image/ico":
            return 364.2978669;
        case "image/jpeg":
            return 1724.788421;
        case "image/png":
            return 4225.612074;
        case "image/svg+xml":
            return 125.1264459;
        case "image/tiff":
            return 475.0202789;
        case "image/webp":
            return 3118.215873;
        case "text/plain":
            return 103.9930099;
        case "text/x-haskell":
            return 85.96719202;
        case "video/mp4":
            return 874.4886418;
        case "video/mpeg":
            // NOTE(calebmer): From trying to upload actual files, seems to take FFmpeg a long
            // time to transcode videos so I added the `/ 100`.
            return 195.85926 / 100;
        case "video/quicktime":
            // NOTE(calebmer): From trying to upload actual files, seems to take FFmpeg a long
            // time to transcode videos so I added the `/ 100`.
            return 430.7018572 / 100;
        case "video/webm":
            return 684.892905;
        case "video/x-matroska":
            // NOTE(calebmer): From trying to upload actual files, seems to take FFmpeg a long
            // time to transcode videos so I added the `/ 100`.
            return 186.0862023 / 100;

        // Since this is based on our test suite I only got measurements for
        // `text/x-haskell`. Use the same time for all other code content types.
        case "text/javascript":
        case "text/html":
        case "text/css":
        case "application/sql":
        case "text/x-python":
        case "text/x-typescript":
        case "application/x-sh":
        case "text/x-java":
        case "application/json":
        case "text/markdown":
        case "text/x-csharp":
        case "text/x-c++src":
        case "text/x-csrc":
        case "application/x-httpd-php":
        case "text/x-go":
        case "application/yaml":
        case "application/x-powershell":
        case "text/rust":
        case "text/x-kotlin":
        case "application/x-ruby":
        case "text/x-lua":
        case "application/xml":
        case "application/vnd.dart":
        case "text/x-swift":
        case "text/x-asm":
        case "application/wasm":
        case "text/x-scala":
        case "text/x-r":
        case "text/x-elixir":
        case "text/x-objcsrc":
        case "text/x-perl":
        case "text/x-solidity":
        case "text/x-clojure":
        case "text/x-erlang":
        case "text/x-ocaml":
            return 85.96719202;

        default:
            throw exhaustive(contentType);
    }
}

/**
 * Estimates how long it will take to process a single file given its content type
 * and size in bytes. Returns the estimate in milliseconds.
 *
 * Uses a non-linear curve fit to `video/mp4` processing times scaled by
 * per-content-type throughput rates. Designed for single-file progress bars, not
 * aggregate estimates — use `getFileContentTypeThroughputBytesPerMs` with a linear
 * model for aggregates.
 */
export function estimateProcessFileDurationMs(
    contentType: FileContentType,
    contentLength: number,
): number {
    // This is a function I manually fit to some `video/mp4` processing times I
    // measured locally. It probably won't perfectly line up with processing times in
    // production.
    //
    // https://www.desmos.com/calculator/gt82e8u8wq
    const a = 20000;
    const b = 405000000;
    const cx = 234303;
    const cy = 315;
    const durationMs = (cy - a) * Math.exp((cx - contentLength) / b) + a;

    const contentLengthPerMs = getFileContentTypeThroughputBytesPerMs(contentType);

    // Multiply the duration from the `video/mp4` model by how long the provided
    // content type takes to process relative to `video/mp4`. For example, processing
    // `application/msword` is very slow per byte so we end up multiplying the duration
    // by ~48 (874.4886418 / 18.09815219).
    return durationMs * (874.4886418 / contentLengthPerMs);
}
