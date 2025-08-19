import sharp from "sharp";
import {Readable as ReadableStream} from "stream";
import {FileProcessorServiceActionContext} from "~/server/files/processor/context/file_processor_service_context.js";
import {rethrowClassifiedSharpError} from "~/server/files/processor/sharp/rethrow_classified_sharp_error.js";
import {sharpTimeoutSeconds} from "~/server/files/processor/sharp/sharp_timeout_seconds.js";
import {avatarsBucketName} from "~/server/helpers/avatars_cloudflare_r2_bucket_name.js";
import {waitForNodeReadableStreamUint8Array} from "~/server/helpers/node/wait_for_node_readable_stream_uint8_array.js";
import {AvatarEntityPath} from "~/shared/avatar/avatar_entity_path.js";
import {ResizeAvatarForUploadResponseSchema} from "~/shared/avatar/protocol/resize_avatar_for_upload_response_schema.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {AvatarId} from "~/shared/id/types/id_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * Resize an avatar from any image type using Sharp.
 * - Extracts first frame for animated inputs
 * - Center-crops to square, resizes to `size`
 * - Encodes to AVIF
 */
export async function resizeAvatar(
    context: FileProcessorServiceActionContext,
    span: TracerSpan,
    {
        requestSignal,
        avatarEntityPath,
        avatarId,
        size,
        maxContentLength,
    }: {
        requestSignal: AbortSignal;
        avatarEntityPath: AvatarEntityPath;
        avatarId: AvatarId;
        size: number;
        maxContentLength: number;
    },
): Promise<Response> {
    try {
        if (requestSignal.aborted) throw requestSignal.reason;

        const object = await context.r2.GetObject({
            Bucket: avatarsBucketName,
            Key: `${avatarEntityPath}/original/${avatarId}`,
        });
        assert(object.Body instanceof ReadableStream);
        const inputBytes = await waitForNodeReadableStreamUint8Array(object.Body);

        const result = await resizeAvatarAttempt({
            inputBytes,
            size,
            targetBytes: maxContentLength,
            span,
        });

        if (!result) {
            throw new InternalError("Failed to resize avatar", {
                displayMessage: errorDisplayMessage`We couldn’t upload your avatar. Please try again or use a different image.`,
            });
        }

        const {data, quality} = result;
        span.addData({
            file: {
                avatar: {
                    resize: {
                        quality,
                        resizedContentLength: data.byteLength,
                        resizedToOriginalContentLengthRatio:
                            data.byteLength / inputBytes.byteLength,
                    },
                },
            },
        });

        return new Response(
            JSON.stringify(
                ResizeAvatarForUploadResponseSchema.serialize({
                    ok: true,
                    content: new Uint8Array(data),
                }),
            ),
            {
                status: 200,
                headers: {"content-type": "application/json"},
            },
        );
    } catch (error) {
        span.addException(error);
        return new Response(
            JSON.stringify(
                ResizeAvatarForUploadResponseSchema.serialize({
                    ok: false,
                    error: ErrorSchema.serialize(error),
                }),
            ),
            {
                status: isSystemError(error) ? 500 : 400,
                headers: {"content-type": "application/json"},
            },
        );
    }
}

/**
 * Encodes a square AVIF avatar with Sharp.
 * - Always extracts frame 0 (works for animated stills: GIF/WebP/HEIC/AVIF)
 * - Center-crops and resizes to a square `size` x `size`
 * - Iteratively reduces quality until the file size is less than or equal to `targetBytes`
 * - Returns chosen quality, and the data.
 */
async function resizeAvatarAttempt({
    inputBytes,
    size,
    targetBytes,
    // NOTE(ifitzsimmons, 2025-08-13): I found that quality above 80 is almost never below 3kb
    // https://sharp.pixelplumbing.com/api-output/#avif
    // 1 - 100 where 100 is highest quality. Default is normally 50 for avif
    qualityRange = [20, 80],
    // 0 - 9 effort range where 0 is fastest and 9 is slowest and most efficient
    effort = 9,
    span,
}: {
    inputBytes: Uint8Array;
    size: number;
    targetBytes: number;
    qualityRange?: [number, number];
    effort?: number; // 0..9
    span: TracerSpan;
}): Promise<{data: Buffer; quality: number} | null> {
    const inputContentLength = inputBytes.byteLength;
    const base = sharp(inputBytes, {
        // Start at the first "page" (frame) and extract 1 page (in case it's animated)
        page: 0,
        pages: 1,
    })
        .rotate() // auto-orient using EXIF Orientation from metadata
        .resize(size, size, {
            // https://sharp.pixelplumbing.com/api-resize/#resize
            // from doc - "focus on the region with the highest Shannon entropy"
            //
            // NOTE(ifitzsimmons, 2025-08-18): I tested with many different photo types (wide shots,
            // family photos, full body shots, head shots, etc) and "entropy" seemed to do a much
            // better job of capturing the expected content than "attention". The pitfall of
            // this approach is that really "busy" backgrounds might be selected over faces/logos.
            // However, given the nature of the types of images people will use for their avatars,
            // I think that this is okay. If we need to change this, can just change position to
            // "top" or "centre"
            position: sharp.strategy.entropy,
            // crop the image -- don't distort
            fit: sharp.fit.cover,
        });

    const [lowestQuality, highestQuality] = qualityRange;
    const qualityStep = 10;

    // While testing on my local machine, I found that we can get a 2MB image down to about
    // 2.5 Kb at effort 9, quality 80 in about 200ms. That feels pretty fast for file upload.
    // If we want this to be faster, setting the highestEffort to 7 dropped the time to ~100ms.
    // I will say that the image quality did seem to degrade a bit at effort 7, so I do think a few
    // hundred extra milliseconds is worth it.
    // this process took 400ms for a 4MB, HEIF image
    // encoded a 800kb gif in 143ms
    for (let quality = highestQuality; quality >= lowestQuality; quality -= qualityStep) {
        try {
            const result = await span.withSpan("sharp resize avatar", async span => {
                const {data, info} = await base
                    .avif({quality, effort})
                    .timeout({seconds: sharpTimeoutSeconds})
                    .toBuffer({resolveWithObject: true})
                    .catch(rethrowClassifiedSharpError);

                span.addData({
                    sharp: {
                        avif: {
                            quality,
                            effort,
                        },
                        inputContentLength,
                        outputContentLength: info.size,
                    },
                });

                if (info.size <= targetBytes) {
                    return {
                        data,
                        quality,
                    };
                }
            });

            if (result) return result;
        } catch (error) {
            if (error instanceof InvalidArgumentError) {
                throw new InvalidArgumentError(error.message, {
                    displayMessage: errorDisplayMessage`This image format isn’t supported. Please upload a different image.`,
                });
            }

            throw error;
        }
    }

    return null;
}
