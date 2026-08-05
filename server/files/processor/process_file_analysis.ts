import {ContentBlock} from "@aws-sdk/client-bedrock-runtime";
import {spawn} from "child_process";
import fsSync from "fs";
import {dirname, join as joinPath} from "path";
import sharp from "sharp";
import {Readable as ReadableStream} from "stream";
import {finished} from "stream/promises";
import {FileProcessorActionContext} from "~/server/files/data/file_processor_context.js";
import {
    fileProcessWhisperLocalModelDirectoryName,
    getFileProcessWhisperModelLoading,
} from "~/server/files/processor/get_file_process_whisper_model_loading.js";
import {materializePackagedFileProcessWhisperModelPathIfExists} from "~/server/files/processor/materialize_packaged_file_process_whisper_model_path_if_exists.js";
import {
    FileProcessorAnalysisResponse,
    FileProcessorAnalysisResponseSchema,
    createFileProcessorAudioTranscriptTagInstructions,
    createFileProcessorCodeTextTagInstructions,
    createFileProcessorDocumentTagInstructions,
    createFileProcessorVideoTagInstructions,
    fileProcessorAnalysisSystemInstructions,
    fileProcessorImageTagInstructions,
} from "~/server/files/processor/process_file_analysis_instructions.js";
import {
    ffmpegExecutablePath,
    ffmpegThreadCount,
    ffprobeExecutablePath,
} from "~/server/files/processor/processors/file_video_and_audio_processor_base.js";
import {rethrowClassifiedSharpError} from "~/server/files/processor/sharp/rethrow_classified_sharp_error.js";
import {sharpTimeoutSeconds} from "~/server/files/processor/sharp/sharp_timeout_seconds.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {getProcessEnvToPropagate, runProcess} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {withTemporaryDirectory} from "~/server/helpers/node/with_temporary_directory.js";
import {SupportedBedrockModel} from "~/server/language_models/supported_bedrock_model.js";
import {getFileContentTypeName} from "~/shared/content/code/get_file_content_type_name.js";
import {DeadlineExceededError, InternalError} from "~/shared/error/error.js";
import {
    FileAnalysisResult,
    FileAnalysisResultSchema,
    fileAnalysisMaxTagCount,
    fileAnalysisTagsMaxLength,
    getFileAnalysisTagsLength,
} from "~/shared/files/file_analysis.js";
import {
    FileAudioContentType,
    FileCodeContentType,
    FileContentType,
    FileDocumentContentType,
    FileImageContentType,
    FileVideoContentType,
    getFileContentTypePreferredExtension,
    isFileAudioContentType,
    isFileCodeContentType,
    isFileDocumentContentType,
    isFileImageContentType,
    isFileVideoContentType,
} from "~/shared/files/file_content_type.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";

export type ProcessFileAnalysisResult =
    | {readonly ok: true; readonly analysis: FileAnalysisResult}
    | {readonly ok: false; readonly error: unknown};

export type ProcessFileAnalysisTranscriptResult =
    | {readonly ok: true; readonly transcriptJson: FileProcessTranscriptJson}
    | {readonly ok: true; readonly isUnavailable: true}
    | {readonly ok: false; readonly error: unknown};

export type FileProcessTranscriptJson = {
    readonly text: string;
    readonly chunks?: ReadonlyArray<{
        readonly text: string;
        readonly timestamp: readonly [number | null, number | null];
    }>;
};

export type FileContentTypeSupportedForAnalysis =
    | FileAudioContentType
    | FileCodeContentType
    | FileDocumentContentType
    | FileImageContentType
    | FileVideoContentType;

const fileProcessTagsLanguageModel: SupportedBedrockModel = "google.gemma-3-4b-it";
const fileProcessTagsModelCacheDirectoryName = ".cache/cyberworlds/models";

const fileProcessTagsTimeoutMs = 1000 * 60 * 5;
const fileProcessTagsMaxImageDimensionPixels = 1024;
const fileProcessTagsMaxTextCharacters = 24_000;
const fileProcessTagsMaxTranscriptCharacters = 24_000;
const fileProcessTagsMaxVideoFrameCount = 20;

// 256mb max audio limit seems more than enough for a transcript
const fileProcessTagsMaxDecodedAudioByteLength = 256 * 1024 * 1024;

type FileProcessTagsAsr = {
    readonly pipe: (
        audio: Float32Array,
        options?: {
            chunk_length_s?: number;
            stride_length_s?: number;
            return_timestamps?: boolean;
        },
    ) => Promise<unknown>;
};

// Holds in-flight or initialized Whisper ASR pipelines keyed by their writable
// model cache directory. This lets concurrent file analysis jobs share model
// loading work while still isolating runtimes or tests that use different temp
// roots.
const fileProcessTagsAsrPromiseByModelCacheDirectoryPath = new Map<
    string,
    Promise<FileProcessTagsAsr>
>();

/**
 * Analyze files for search-oriented descriptions.
 *
 * This function never throws analysis failures to its caller. Instead it converts
 * them into `{ok: false}` so the caller can decide whether analysis failure should
 * be:
 *
 * - ignored
 * - retried in a separate job
 * - or surfaced as a fatal error
 */
export async function processFileAnalysis(
    context: FileProcessorActionContext,
    {
        contentType,
        fileId,
        inputPathIfExists,
        onTranscriptProcessed,
        parentTemporaryDirectoryPath,
        signal,
        spaceId,
    }: {
        contentType: FileContentTypeSupportedForAnalysis;
        fileId: FileId;
        inputPathIfExists?: string;
        onTranscriptProcessed?: (result: ProcessFileAnalysisTranscriptResult) => void;
        parentTemporaryDirectoryPath: string;
        signal?: AbortSignal;
        spaceId: SpaceId;
    },
): Promise<ProcessFileAnalysisResult> {
    return await context.tracer.withSpan("Analyze file", async (actionContext, span) => {
        let hasReportedTranscriptResult = false;
        const reportTranscriptResult = (result: ProcessFileAnalysisTranscriptResult) => {
            if (onTranscriptProcessed === undefined || hasReportedTranscriptResult) return;

            hasReportedTranscriptResult = true;
            onTranscriptProcessed(result);
        };

        try {
            const analysis = await withFileAnalysisDeadline(signal, async signal => {
                if (inputPathIfExists !== undefined) {
                    return await runTagGeneration({
                        context: actionContext,
                        contentType,
                        filePath: inputPathIfExists,
                        onTranscriptProcessed: reportTranscriptResult,
                        parentTemporaryDirectoryPath,
                        signal,
                    });
                }

                return await withTemporaryDirectory(
                    parentTemporaryDirectoryPath,
                    `${fileId}_tags_`,
                    async temporaryDirectoryPath => {
                        const inputPath = joinPath(
                            temporaryDirectoryPath,
                            `input.${getFileContentTypePreferredExtension(contentType)}`,
                        );

                        await downloadFileToPath(actionContext, {
                            fileId,
                            outputPath: inputPath,
                            signal,
                            spaceId,
                        });

                        return await runTagGeneration({
                            context: actionContext,
                            contentType,
                            filePath: inputPath,
                            onTranscriptProcessed: reportTranscriptResult,
                            parentTemporaryDirectoryPath,
                            signal,
                        });
                    },
                );
            });

            return {ok: true, analysis};
        } catch (error) {
            reportTranscriptResult({ok: false, error});
            span.addException(error);
            return {ok: false, error};
        }
    });
}

/**
 * Check whether a file content type has a metadata generation path.
 */
export function isFileContentTypeSupportedForAnalysis(
    contentType: FileContentType,
): contentType is FileContentTypeSupportedForAnalysis {
    return (
        isFileImageContentType(contentType) ||
        isFileAudioContentType(contentType) ||
        isFileVideoContentType(contentType) ||
        isFileDocumentContentType(contentType) ||
        isFileCodeContentType(contentType)
    );
}

/**
 * Run file analysis work with the analysis-specific timeout and caller abort
 * signal combined into one downstream signal.
 */
async function withFileAnalysisDeadline<Value>(
    parentSignal: AbortSignal | undefined,
    callback: (signal: AbortSignal) => Promise<Value>,
): Promise<Value> {
    // Metadata generation has its own deadline, but we also respect the caller's
    // broader file-processing abort signal. Use one combined signal so downstream
    // subprocesses, R2 requests, and Bedrock calls can be interrupted instead of
    // racing detached background work.
    const timeoutAbortController = new AbortController();
    const timeout = createTimeout(() => {
        timeoutAbortController.abort(new DeadlineExceededError("File analysis timed out"));
    }, fileProcessTagsTimeoutMs);
    timeout.unref?.();

    try {
        const signal =
            parentSignal !== undefined
                ? AbortSignal.any([parentSignal, timeoutAbortController.signal])
                : timeoutAbortController.signal;

        if (signal.aborted) {
            throw signal.reason;
        }

        return await callback(signal);
    } finally {
        timeout.clear();
    }
}

/**
 * Download the original file object from R2 into a local path for analysis.
 */
async function downloadFileToPath(
    context: FileProcessorActionContext,
    {
        fileId,
        outputPath,
        signal,
        spaceId,
    }: {
        fileId: FileId;
        outputPath: string;
        signal: AbortSignal;
        spaceId: SpaceId;
    },
) {
    const object = await context.r2.GetObject(
        {
            Bucket: filesBucketName,
            Key: `${spaceId}/${fileId}`,
        },
        {signal},
    );

    assert(object.Body instanceof ReadableStream);

    const writeStream = fsSync.createWriteStream(outputPath);
    await finished(object.Body.pipe(writeStream));
}

/**
 * Route a supported content type to its tag generation pipeline.
 */
async function runTagGeneration({
    context,
    contentType,
    filePath,
    onTranscriptProcessed,
    parentTemporaryDirectoryPath,
    signal,
}: {
    context: FileProcessorActionContext;
    contentType: FileContentTypeSupportedForAnalysis;
    filePath: string;
    onTranscriptProcessed?: (result: ProcessFileAnalysisTranscriptResult) => void;
    parentTemporaryDirectoryPath: string;
    signal: AbortSignal;
}): Promise<FileAnalysisResult> {
    if (isFileImageContentType(contentType)) {
        return normalizeFileAnalysisResult(
            await generateImageTagsWithBedrock({context, filePath, signal}),
        );
    }

    if (isFileDocumentContentType(contentType)) {
        return normalizeFileAnalysisResult(
            await generateDocumentTagsWithBedrock({context, contentType, filePath, signal}),
        );
    }

    if (isFileCodeContentType(contentType)) {
        return normalizeFileAnalysisResult(
            await generateCodeTextTagsWithBedrock({context, contentType, filePath, signal}),
        );
    }

    if (isFileAudioContentType(contentType)) {
        return normalizeFileAnalysisResult(
            await generateAudioTagsWithBedrock({
                context,
                filePath,
                onTranscriptProcessed,
                parentTemporaryDirectoryPath,
                signal,
            }),
        );
    }

    if (isFileVideoContentType(contentType)) {
        return normalizeFileAnalysisResult(
            await generateVideoTagsWithBedrock({
                context,
                filePath,
                onTranscriptProcessed,
                parentTemporaryDirectoryPath,
                signal,
            }),
        );
    }

    throw exhaustive(contentType);
}

/**
 * Generate tags and an optional caption for an image using the Bedrock vision
 * model.
 */
async function generateImageTagsWithBedrock({
    context,
    filePath,
    signal,
}: {
    context: FileProcessorActionContext;
    filePath: string;
    signal: AbortSignal;
}): Promise<FileProcessorAnalysisResponse> {
    const imagePayload = await loadResizedImagePayload(filePath);
    return await invokeBedrockTags({
        contentBlocks: [
            {
                image: {
                    format: imagePayload.format,
                    source: {bytes: imagePayload.bytes},
                },
            },
            {text: fileProcessorImageTagInstructions},
        ],
        context,
        signal,
    });
}

/**
 * Generate tags and a summary for a document preview image.
 */
async function generateDocumentTagsWithBedrock({
    context,
    contentType,
    filePath,
    signal,
}: {
    context: FileProcessorActionContext;
    contentType: FileDocumentContentType;
    filePath: string;
    signal: AbortSignal;
}): Promise<FileProcessorAnalysisResponse> {
    const imagePayload = await loadResizedImagePayload(filePath);
    return await invokeBedrockTags({
        contentBlocks: [
            {
                image: {
                    format: imagePayload.format,
                    source: {bytes: imagePayload.bytes},
                },
            },
            {
                text: createFileProcessorDocumentTagInstructions({
                    contentTypeName: getFileContentTypeName(contentType),
                }),
            },
        ],
        context,
        signal,
    });
}

/**
 * Generate tags and a summary for code or text files.
 */
async function generateCodeTextTagsWithBedrock({
    context,
    contentType,
    filePath,
    signal,
}: {
    context: FileProcessorActionContext;
    contentType: FileCodeContentType;
    filePath: string;
    signal: AbortSignal;
}): Promise<FileProcessorAnalysisResponse> {
    const text = await loadTextSnippet({filePath, signal});
    return await invokeBedrockTags({
        contentBlocks: [
            {
                text: createFileProcessorCodeTextTagInstructions({
                    contentTypeName: getFileContentTypeName(contentType),
                    text,
                }),
            },
        ],
        context,
        signal,
    });
}

/**
 * Transcribe audio when possible, report the transcript state, and generate tags
 * from the transcript.
 */
async function generateAudioTagsWithBedrock({
    context,
    filePath,
    onTranscriptProcessed,
    parentTemporaryDirectoryPath,
    signal,
}: {
    context: FileProcessorActionContext;
    filePath: string;
    onTranscriptProcessed?: (result: ProcessFileAnalysisTranscriptResult) => void;
    parentTemporaryDirectoryPath: string;
    signal: AbortSignal;
}): Promise<FileProcessorAnalysisResponse> {
    const asr = await getFileProcessTagsAsr(parentTemporaryDirectoryPath);
    const audio = await decodeAudioToFloat32IfWithinLimit({filePath, signal});

    if (audio === null) {
        onTranscriptProcessed?.({ok: true, isUnavailable: true});
        return {tags: []};
    }

    const transcriptJson = await transcribeAudio(asr, audio);

    onTranscriptProcessed?.({ok: true, transcriptJson});

    const transcript = truncateTranscript(transcriptJson.text);

    return await invokeBedrockTags({
        contentBlocks: [
            {
                text: createFileProcessorAudioTranscriptTagInstructions(transcript),
            },
        ],
        context,
        signal,
    });
}

/**
 * Sample video frames, transcribe audio when present, and generate tags from the
 * combined visual and transcript context.
 */
async function generateVideoTagsWithBedrock({
    context,
    filePath,
    onTranscriptProcessed,
    parentTemporaryDirectoryPath,
    signal,
}: {
    context: FileProcessorActionContext;
    filePath: string;
    onTranscriptProcessed?: (result: ProcessFileAnalysisTranscriptResult) => void;
    parentTemporaryDirectoryPath: string;
    signal: AbortSignal;
}): Promise<FileProcessorAnalysisResponse> {
    const durationSeconds = await probeMediaDurationSeconds({filePath, signal});
    const hasAudioStream = await probeMediaHasAudioStream({filePath, signal});
    const frameTimestampsSeconds = getVideoFrameTimestampsSeconds(durationSeconds);

    const contentBlocks: Array<ContentBlock> = [];

    return await withTemporaryDirectory(
        dirname(filePath),
        "video_tags_",
        async temporaryDirectoryPath => {
            for (const [index, frameTimestampSeconds] of frameTimestampsSeconds.entries()) {
                const framePath = joinPath(
                    temporaryDirectoryPath,
                    `frame_${String(index).padStart(2, "0")}.jpg`,
                );
                await extractVideoFrame({
                    filePath,
                    outputPath: framePath,
                    signal,
                    timeSeconds: frameTimestampSeconds,
                });
                const framePayload = await loadResizedImagePayload(framePath);
                contentBlocks.push({
                    text: `Video moment ${index + 1} of ${frameTimestampsSeconds.length}.`,
                });
                contentBlocks.push({
                    image: {
                        format: framePayload.format,
                        source: {bytes: framePayload.bytes},
                    },
                });
            }

            let transcript: string | null = null;
            if (hasAudioStream) {
                const asr = await getFileProcessTagsAsr(parentTemporaryDirectoryPath);
                const audio = await decodeAudioToFloat32IfWithinLimit({filePath, signal});

                if (audio === null) {
                    onTranscriptProcessed?.({ok: true, isUnavailable: true});
                } else {
                    const transcriptJson = await transcribeAudio(asr, audio);

                    onTranscriptProcessed?.({ok: true, transcriptJson});
                    transcript = truncateTranscript(transcriptJson.text);
                }
            } else {
                onTranscriptProcessed?.({ok: true, isUnavailable: true});
            }

            const instructions = createFileProcessorVideoTagInstructions({transcript});
            for (const instruction of instructions) {
                contentBlocks.push({text: instruction});
            }

            return await invokeBedrockTags({contentBlocks, context, signal});
        },
    );
}

/**
 * Call Bedrock with normalized content blocks and parse the structured tag
 * response.
 */
async function invokeBedrockTags({
    contentBlocks,
    context,
    signal,
}: {
    contentBlocks: Array<ContentBlock>;
    context: FileProcessorActionContext;
    signal: AbortSignal;
}): Promise<FileProcessorAnalysisResponse> {
    const normalizedContentBlocks = contentBlocks.filter(contentBlock => {
        if (!("text" in contentBlock)) return true;
        return typeof contentBlock.text === "string" && contentBlock.text.trim().length > 0;
    });

    const result = await context.languageModels.generateObject({
        inferenceConfig: {
            maxTokens: 250,
            temperature: 0.1,
            topP: 0.8,
        },
        messages: [{content: normalizedContentBlocks, role: "user"}],
        model: fileProcessTagsLanguageModel,
        schema: FileProcessorAnalysisResponseSchema,
        signal,
        system: fileProcessorAnalysisSystemInstructions,
    });

    return result.object;
}

/**
 * Normalize model output into a persisted file analysis result with bounded,
 * deduplicated tags.
 */
function normalizeFileAnalysisResult(analysis: FileProcessorAnalysisResponse): FileAnalysisResult {
    const dedupedTags: Array<string> = [];

    for (const tag of analysis.tags) {
        const normalizedTag = tag.trim().toLowerCase();
        if (!normalizedTag) continue;
        if (dedupedTags.includes(normalizedTag)) continue;
        dedupedTags.push(normalizedTag);
        if (dedupedTags.length >= fileAnalysisMaxTagCount) break;
    }
    while (
        dedupedTags.length > 0 &&
        getFileAnalysisTagsLength(dedupedTags) > fileAnalysisTagsMaxLength
    ) {
        dedupedTags.pop();
    }

    let caption: string | undefined;
    if (analysis.caption !== undefined) {
        const normalizedCaption = analysis.caption.trim();
        if (normalizedCaption) {
            caption = normalizedCaption;
        }
    }

    let description: string | undefined;
    if (analysis.description !== undefined) {
        const normalizedDescription = analysis.description.trim();
        if (normalizedDescription) {
            description = normalizedDescription;
        }
    }

    // Empty analysis is more likely a failed model/schema result than a useful file
    // state. Surface it as an analysis failure instead of persisting a permanent empty
    // `tags` array.
    if (dedupedTags.length === 0) {
        throw new InternalError("Expected file analysis to include at least one tag");
    }

    return FileAnalysisResultSchema.deserialize({
        ...(caption !== undefined ? {caption} : {}),
        ...(description !== undefined ? {description} : {}),
        tags: dedupedTags,
    });
}

/**
 * Get the shared ASR pipeline for a writable model cache directory.
 *
 * A single file processing invocation only needs ASR once, but warm Lambda
 * environments and local/ECS processes can reuse module-level state across
 * invocations. Keeping the initialized pipeline here avoids reloading Whisper for
 * every audio or video file processed by the same process.
 *
 * The promise is keyed by cache directory because tests and runtimes can use
 * different writable roots, and `@xenova/transformers` stores cache settings on
 * the imported module.
 */
async function getFileProcessTagsAsr(
    parentTemporaryDirectoryPath: string,
): Promise<FileProcessTagsAsr> {
    // File processor runtimes already guarantee this temp root is writable. Avoid the
    // default transformers `$HOME/.cache`, which is not reliable in Lambda.
    const modelCacheDirectoryPath = joinPath(
        parentTemporaryDirectoryPath,
        fileProcessTagsModelCacheDirectoryName,
    );

    // Cache the ASR initialization per model cache directory. Tests and different
    // runtimes may use different writable roots, and transformers keeps cache settings
    // globally on the imported module.
    let asrPromise =
        fileProcessTagsAsrPromiseByModelCacheDirectoryPath.get(modelCacheDirectoryPath);
    if (asrPromise === undefined) {
        asrPromise = createFileProcessTagsAsr(modelCacheDirectoryPath).catch(error => {
            // Do not permanently memoize failed initialization. A later file processing job
            // may run after the cache directory or model files have been repaired.
            if (
                fileProcessTagsAsrPromiseByModelCacheDirectoryPath.get(modelCacheDirectoryPath) ===
                asrPromise
            ) {
                fileProcessTagsAsrPromiseByModelCacheDirectoryPath.delete(modelCacheDirectoryPath);
            }
            throw error;
        });
        fileProcessTagsAsrPromiseByModelCacheDirectoryPath.set(modelCacheDirectoryPath, asrPromise);
    }

    return await asrPromise;
}

/**
 * Create a Whisper ASR pipeline backed by the packaged local model when available.
 */
async function createFileProcessTagsAsr(modelCacheDirectoryPath: string) {
    const transformers: typeof import("@xenova/transformers") =
        await import("@xenova/transformers");

    // Prefer the packaged local Whisper subset when it is present in runfiles. That
    // subset is intentionally smaller than the full upstream model repo: it includes
    // only the files our current `@xenova/transformers` loader path needs. See
    // `server/files/processor/whisper_base_en/README.md`.
    const localModelPathIfExists = await materializePackagedFileProcessWhisperModelPathIfExists({
        outputDirectoryPath: joinPath(
            modelCacheDirectoryPath,
            fileProcessWhisperLocalModelDirectoryName,
        ),
        runfilesDirectoryPath: runfilesPath,
    });
    const whisperModelLoading = getFileProcessWhisperModelLoading(localModelPathIfExists);

    transformers.env.cacheDir = modelCacheDirectoryPath;
    transformers.env.allowLocalModels = true;
    if (whisperModelLoading.localModelPath !== undefined) {
        transformers.env.localModelPath = whisperModelLoading.localModelPath;
    }
    // If the packaged files are missing, keep the old behavior and allow a remote
    // fetch instead of hard-failing startup.
    transformers.env.allowRemoteModels = whisperModelLoading.allowRemoteModels;
    transformers.env.backends.onnx.logLevel = "error";

    const asrPipe = await transformers.pipeline(
        "automatic-speech-recognition",
        whisperModelLoading.modelName,
        {quantized: true},
    );

    return {
        pipe: (
            audio: Float32Array,
            options?: {
                chunk_length_s?: number;
                stride_length_s?: number;
                return_timestamps?: boolean;
            },
        ) => asrPipe(audio, options),
    };
}

/**
 * Load an image from disk, auto-orient it, resize it for model input, and encode
 * it as JPEG bytes.
 */
async function loadResizedImagePayload(
    filePath: string,
): Promise<{bytes: Uint8Array; format: "jpeg"}> {
    const buffer = await sharp(filePath, {pages: 1})
        .timeout({seconds: sharpTimeoutSeconds})
        .rotate()
        .resize({
            fit: "inside",
            height: fileProcessTagsMaxImageDimensionPixels,
            width: fileProcessTagsMaxImageDimensionPixels,
            withoutEnlargement: true,
        })
        .jpeg({mozjpeg: true, quality: 85})
        .toBuffer()
        .catch(rethrowClassifiedSharpError);

    return {bytes: Uint8Array.from(buffer), format: "jpeg"};
}

/**
 * Load a bounded UTF-8 snippet from a local file for text-based analysis.
 */
async function loadTextSnippet({
    filePath,
    signal,
}: {
    filePath: string;
    signal: AbortSignal;
}): Promise<string> {
    const readStream = fsSync.createReadStream(filePath, {
        encoding: "utf8",
        highWaterMark: 64 * 1024,
    });

    let text = "";

    try {
        for await (const chunk of readStream) {
            if (signal.aborted) {
                throw signal.reason;
            }

            text += chunk;
            if (text.length > fileProcessTagsMaxTextCharacters) break;
        }
    } finally {
        readStream.destroy();
    }

    const normalizedText = text.trim();
    if (normalizedText.length <= fileProcessTagsMaxTextCharacters) {
        return normalizedText;
    }
    return `${normalizedText.slice(0, fileProcessTagsMaxTextCharacters - 3).trimEnd()}...`;
}

/**
 * Run ASR over decoded mono audio and normalize the pipeline output.
 */
async function transcribeAudio(
    asr: Awaited<ReturnType<typeof createFileProcessTagsAsr>>,
    audio: Float32Array,
): Promise<FileProcessTranscriptJson> {
    const output = await asr.pipe(audio, {
        chunk_length_s: 30,
        return_timestamps: true,
        stride_length_s: 5,
    });

    return normalizeTranscriptJson(output);
}

/**
 * Normalize raw ASR output into transcript text and timestamped chunks.
 */
function normalizeTranscriptJson(output: unknown): FileProcessTranscriptJson {
    const outputObject = isObject(output) ? output : {};
    const text = typeof outputObject.text === "string" ? outputObject.text.trim() : "";

    if (!Array.isArray(outputObject.chunks)) {
        return {
            ...outputObject,
            text,
        };
    }

    const chunks = outputObject.chunks.flatMap(chunk => {
        if (!isObject(chunk)) return [];

        const chunkText = typeof chunk.text === "string" ? chunk.text.trim() : "";
        if (!Array.isArray(chunk.timestamp) || chunk.timestamp.length !== 2) return [];

        return [
            {
                text: chunkText,
                timestamp: [
                    normalizeTranscriptTimestampValue(chunk.timestamp[0]),
                    normalizeTranscriptTimestampValue(chunk.timestamp[1]),
                ] as const,
            },
        ];
    });

    return {
        ...outputObject,
        text,
        chunks,
    };
}

/**
 * Convert finite numeric transcript timestamps and discard unsupported values.
 */
function normalizeTranscriptTimestampValue(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Decode audio through ffmpeg into mono 16 kHz Float32 PCM when it fits within the
 * analysis memory budget.
 */
async function decodeAudioToFloat32IfWithinLimit({
    filePath,
    signal,
}: {
    filePath: string;
    signal: AbortSignal;
}): Promise<Float32Array | null> {
    const subprocess = spawn(
        ffmpegExecutablePath,
        [
            "-i",
            filePath,
            "-threads",
            String(ffmpegThreadCount),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "f32le",
            "-acodec",
            "pcm_f32le",
            "pipe:1",
        ],
        {
            cwd: runfilesPath,
            env: getProcessEnvToPropagate(),
            signal,
            stdio: ["ignore", "pipe", "pipe"],
        },
    );

    const stdoutChunks: Array<Uint8Array> = [];
    let stdoutByteLength = 0;
    let didExceedDecodedAudioByteLength = false;
    let stderr = "";

    subprocess.stdout.on("data", (chunk: Uint8Array) => {
        stdoutByteLength += chunk.length;

        if (stdoutByteLength > fileProcessTagsMaxDecodedAudioByteLength) {
            didExceedDecodedAudioByteLength = true;
            subprocess.kill("SIGKILL");
            return;
        }

        stdoutChunks.push(chunk);
    });
    subprocess.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
    });

    await waitForProcessExit(subprocess).catch(error => {
        if (didExceedDecodedAudioByteLength) {
            return;
        }

        throw new InternalError(
            `${error instanceof Error ? error.message : String(error)}\n\nstderr:\n${stderr.trim()}`,
        );
    });

    if (didExceedDecodedAudioByteLength) {
        return null;
    }

    const buffer = Buffer.concat(stdoutChunks);
    assert(buffer.length % 4 === 0);
    const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
    );
    return new Float32Array(arrayBuffer);
}

/**
 * Probe media duration with ffprobe, returning null when duration metadata is
 * absent.
 */
async function probeMediaDurationSeconds({
    filePath,
    signal,
}: {
    filePath: string;
    signal: AbortSignal;
}): Promise<number | null> {
    const stdout = await runProcess(
        ffprobeExecutablePath,
        [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            filePath,
        ],
        {
            cwd: runfilesPath,
            signal,
        },
    );

    const trimmedStdout = stdout.trim();
    if (trimmedStdout === "" || trimmedStdout === "N/A") {
        return null;
    }

    const durationSeconds = parseFloat(trimmedStdout);
    if (isNaN(durationSeconds) || !Number.isFinite(durationSeconds)) {
        throw new InternalError(`Could not parse duration from ffprobe output: ${stdout}`);
    }
    return durationSeconds;
}

/**
 * Check whether ffprobe can find at least one audio stream in the media file.
 */
async function probeMediaHasAudioStream({
    filePath,
    signal,
}: {
    filePath: string;
    signal: AbortSignal;
}): Promise<boolean> {
    const stdout = await runProcess(
        ffprobeExecutablePath,
        [
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=index",
            "-of",
            "csv=p=0",
            filePath,
        ],
        {
            cwd: runfilesPath,
            signal,
        },
    );

    return stdout.trim().length > 0;
}

/**
 * Extract one JPEG frame from a video at a requested timestamp.
 */
async function extractVideoFrame({
    filePath,
    outputPath,
    signal,
    timeSeconds,
}: {
    filePath: string;
    outputPath: string;
    signal: AbortSignal;
    timeSeconds: number;
}): Promise<void> {
    await runProcess(
        ffmpegExecutablePath,
        [
            "-y",
            "-ss",
            String(Math.max(0, timeSeconds)),
            "-i",
            filePath,
            "-threads",
            String(ffmpegThreadCount),
            "-frames:v",
            "1",
            outputPath,
        ],
        {
            cwd: runfilesPath,
            signal,
        },
    );
}

/**
 * Choose representative video frame timestamps while bounding model input size.
 */
function getVideoFrameTimestampsSeconds(durationSeconds: number | null): Array<number> {
    if (durationSeconds === null) return [0];

    if (durationSeconds <= 5) return [durationSeconds / 2];

    let frameCount: number;
    if (durationSeconds <= 60) {
        frameCount = Math.max(2, Math.round(durationSeconds / 6));
    } else {
        frameCount = 10 + Math.round((durationSeconds - 60) / 12);
    }

    frameCount = Math.max(1, Math.min(frameCount, fileProcessTagsMaxVideoFrameCount));
    return [...Array(frameCount).keys()].map(
        index => durationSeconds * ((index + 0.5) / frameCount),
    );
}

/**
 * Normalize whitespace and limit transcript length before sending it to Bedrock.
 */
function truncateTranscript(transcript: string): string {
    const normalizedTranscript = transcript.trim().replace(/\s+/gu, " ");
    if (normalizedTranscript.length <= fileProcessTagsMaxTranscriptCharacters) {
        return normalizedTranscript;
    }
    return `${normalizedTranscript.slice(0, fileProcessTagsMaxTranscriptCharacters - 3).trimEnd()}...`;
}
