import {
    BedrockRuntimeClient,
    ContentBlock,
    ConverseCommand,
    ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import {fromIni} from "@aws-sdk/credential-providers";
import {spawn} from "child_process";
import fs from "fs/promises";
import {tmpdir} from "os";
import {basename, extname, join as joinPath} from "path";
import {performance} from "perf_hooks";
import sharp from "sharp";
import {parseArgs} from "util";
import {getProcessEnvToPropagate} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {FailedPreconditionError, InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {
    FileContentType,
    getPathFileContentTypeIfExists,
    isFileAudioContentType,
    isFileImageContentType,
    isFileVideoContentType,
} from "~/shared/files/file_content_type.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";

type ProbeRoute = "Audio" | "Image" | "Unsupported" | "Video";
type PricingRegion = keyof typeof gemmaInputCostPerMillionTokensByRegion;

type ProbeStage = {
    readonly currentRssMiB: number;
    readonly durationMs: number;
    readonly maxRssMiB: number;
    readonly name: string;
};

type ProbeUsage = {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
};

type ProbeModels = {
    readonly asr: {
        readonly pipe: (
            audio: Float32Array,
            options?: {chunk_length_s?: number; stride_length_s?: number},
        ) => Promise<{text: string}>;
    } | null;
    readonly bedrockClient: BedrockRuntimeClient | null;
};

type ProbeResult = {
    readonly contentType: FileContentType;
    readonly estimatedCostUsd: number;
    readonly filePath: string;
    readonly final: {
        readonly summary: string | null;
        readonly tags: ReadonlyArray<string>;
    };
    readonly frameSampling: {
        readonly frameCount: number;
        readonly frameTimestampsSeconds: ReadonlyArray<number>;
    };
    readonly modelInfo: {
        readonly awsProfile: string | null;
        readonly modelId: string;
        readonly pricing: {
            readonly inputCostPerMillionTokensUsd: number;
            readonly outputCostPerMillionTokensUsd: number;
        };
        readonly region: string;
        readonly whisperModel: string | null;
    };
    readonly peakRssMiB: number;
    readonly route: ProbeRoute;
    readonly stages: ReadonlyArray<ProbeStage>;
    readonly tokenUsage: ProbeUsage;
    readonly totalDurationMs: number;
    readonly transcript: string | null;
};

type ProbeRouteResult = {
    readonly estimatedCostUsd: number;
    readonly final: {
        readonly summary: string | null;
        readonly tags: ReadonlyArray<string>;
    };
    readonly frameSampling: {
        readonly frameCount: number;
        readonly frameTimestampsSeconds: ReadonlyArray<number>;
    };
    readonly tokenUsage: ProbeUsage;
    readonly transcript: string | null;
};

const ffmpegExecutablePath = joinPath(runfilesPath, "ffmpeg/install/bin/ffmpeg");
const ffprobeExecutablePath = joinPath(runfilesPath, "ffmpeg/install/bin/ffprobe");

const defaultGemmaModelId = "google.gemma-3-12b-it";
const defaultWhisperModel = "Xenova/whisper-base.en";
const defaultAwsProfile = "imjoshin";
const defaultAwsRegion = "us-east-1";
const maxImageDimensionPixels = 1024;
const maxVideoFrameCount = 20;
const maxTranscriptCharacters = 24_000;
const gemmaInputCostPerMillionTokensByRegion = {
    "us-east-1": 0.09,
    "us-east-2": 0.09,
    "us-west-2": 0.09,
} as const;
const gemmaOutputCostPerMillionTokensByRegion = {
    "us-east-1": 0.29,
    "us-east-2": 0.29,
    "us-west-2": 0.29,
} as const;
const bedrockLegacyBearerTokenEnvironmentVariableName = "AWS_BEDROCK_TOKEN";
const bedrockBearerTokenEnvironmentVariableName = "AWS_BEARER_TOKEN_BEDROCK";

async function main() {
    const {values} = parseArgs({
        options: {
            awsProfile: {type: "string"},
            cacheDir: {type: "string"},
            directory: {type: "string"},
            file: {type: "string"},
            modelId: {type: "string"},
            outputSuffix: {type: "string"},
            region: {type: "string"},
            whisperModel: {type: "string"},
        },
        strict: true,
    });

    const filePath = values.file;
    const directoryPath = values.directory;
    if ((filePath === undefined) === (directoryPath === undefined)) {
        throw new InvalidArgumentError("Provide exactly one of `--file` or `--directory`");
    }

    const awsProfile = values.awsProfile ?? defaultAwsProfile;
    const region = getPricingRegionOrThrow(values.region ?? defaultAwsRegion);

    const modelId = values.modelId ?? defaultGemmaModelId;
    const whisperModel = values.whisperModel ?? defaultWhisperModel;
    const cacheDirectoryPath =
        values.cacheDir ?? joinPath(process.env.HOME ?? tmpdir(), ".cache/cyberworlds/models");

    if (filePath !== undefined) {
        const stats = await fs.stat(filePath);
        assert(stats.isFile());
        const result = await runProbeForFile({
            awsProfile,
            cacheDirectoryPath,
            filePath,
            modelId,
            region,
            reuseModels: null,
            whisperModel,
        });
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    assert(directoryPath !== undefined);
    const inputFilePaths = (await fs.readdir(directoryPath))
        .filter(fileName => fileName !== ".DS_Store")
        .filter(fileName => !fileName.includes(".json"))
        .map(fileName => joinPath(directoryPath, fileName))
        .sort();

    const routes = inputFilePaths.map(file =>
        getProbeRoute(getPathFileContentTypeIfExists(file) ?? "application/octet-stream"),
    );
    const needsAsr = routes.some(route => route === "Audio" || route === "Video");
    const sharedModels = await loadModels({
        awsProfile,
        cacheDirectoryPath,
        needsAsr,
        region,
        stages: [],
        whisperModel,
    });

    const outputSuffix = values.outputSuffix ?? ".gemma.json";
    for (const inputFilePath of inputFilePaths) {
        const outputPath = joinPath(
            directoryPath,
            `${basename(inputFilePath, extname(inputFilePath))}${outputSuffix}`,
        );
        const result = await runProbeForFile({
            awsProfile,
            cacheDirectoryPath,
            filePath: inputFilePath,
            modelId,
            region,
            reuseModels: sharedModels,
            whisperModel,
        });
        await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
        // eslint-disable-next-line no-console
        console.log(`Wrote ${basename(outputPath)}`);
    }
}

async function runProbeForFile({
    awsProfile,
    cacheDirectoryPath,
    filePath,
    modelId,
    region,
    reuseModels,
    whisperModel,
}: {
    awsProfile: string;
    cacheDirectoryPath: string;
    filePath: string;
    modelId: string;
    region: PricingRegion;
    reuseModels: ProbeModels | null;
    whisperModel: string;
}): Promise<ProbeResult> {
    const contentType = getPathFileContentTypeIfExists(filePath) ?? "application/octet-stream";
    const route = getProbeRoute(contentType);
    const stages: Array<ProbeStage> = [];
    const totalStart = performance.now();
    const models =
        reuseModels ??
        (await loadModels({
            awsProfile,
            cacheDirectoryPath,
            needsAsr: route === "Audio" || route === "Video",
            region,
            stages,
            whisperModel,
        }));

    const routeResult = await runRoute({
        filePath,
        modelId,
        models,
        region,
        route,
        stages,
    });

    return {
        contentType,
        estimatedCostUsd: routeResult.estimatedCostUsd,
        filePath,
        final: routeResult.final,
        frameSampling: routeResult.frameSampling,
        modelInfo: {
            awsProfile,
            modelId,
            pricing: {
                inputCostPerMillionTokensUsd: gemmaInputCostPerMillionTokensByRegion[region],
                outputCostPerMillionTokensUsd: gemmaOutputCostPerMillionTokensByRegion[region],
            },
            region,
            whisperModel: route === "Audio" || route === "Video" ? whisperModel : null,
        },
        peakRssMiB: getMaxRssMiB(),
        route,
        stages,
        tokenUsage: routeResult.tokenUsage,
        totalDurationMs: performance.now() - totalStart,
        transcript: routeResult.transcript,
    };
}

function getProbeRoute(contentType: FileContentType): ProbeRoute {
    if (isFileImageContentType(contentType)) return "Image";
    if (isFileAudioContentType(contentType)) return "Audio";
    if (isFileVideoContentType(contentType)) return "Video";
    return "Unsupported";
}

async function loadModels({
    awsProfile,
    cacheDirectoryPath,
    needsAsr,
    region,
    stages,
    whisperModel,
}: {
    awsProfile: string;
    cacheDirectoryPath: string;
    needsAsr: boolean;
    region: string;
    stages: Array<ProbeStage>;
    whisperModel: string;
}): Promise<ProbeModels> {
    const bearerToken = getBedrockBearerTokenIfExists();
    const bedrockClient =
        bearerToken === null
            ? await measureStage(
                  stages,
                  "Create Bedrock runtime client",
                  async () =>
                      new BedrockRuntimeClient({
                          ...(awsProfile ? {credentials: fromIni({profile: awsProfile})} : {}),
                          maxAttempts: 5,
                          region,
                      }),
              )
            : null;

    let asr: ProbeModels["asr"] = null;
    if (needsAsr) {
        asr = await measureStage(stages, "Load Whisper ASR model", async () =>
            createAsrPipeline({cacheDirectoryPath, whisperModel}),
        );
    }

    return {asr, bedrockClient};
}

async function createAsrPipeline({
    cacheDirectoryPath,
    whisperModel,
}: {
    cacheDirectoryPath: string;
    whisperModel: string;
}): Promise<NonNullable<ProbeModels["asr"]>> {
    const transformers: typeof import("@xenova/transformers") = await import(
        /* @vite-ignore */ "@xenova/" + cast("transformers")
    );

    transformers.env.cacheDir = cacheDirectoryPath;
    transformers.env.allowLocalModels = true;
    transformers.env.allowRemoteModels = true;
    transformers.env.backends.onnx.logLevel = "error";

    const asrPipe = await transformers.pipeline("automatic-speech-recognition", whisperModel);
    return {
        pipe: (audio, options) => asrPipe(audio, options),
    };
}

async function runRoute({
    filePath,
    modelId,
    models,
    region,
    route,
    stages,
}: {
    filePath: string;
    modelId: string;
    models: ProbeModels;
    region: PricingRegion;
    route: ProbeRoute;
    stages: Array<ProbeStage>;
}): Promise<ProbeRouteResult> {
    switch (route) {
        case "Image": {
            const imagePayload = await measureStage(stages, "Prepare image for Bedrock", async () =>
                loadResizedImagePayload(filePath),
            );
            const response = await measureStage(stages, "Analyze image with Gemma 3", async () =>
                analyzeImageWithGemma({
                    bedrockClient: models.bedrockClient,
                    imagePayload,
                    modelId,
                    region,
                }),
            );
            return {
                estimatedCostUsd: estimateCostUsd({region, usage: response.usage}),
                final: normalizeResult(parseModelJson(response.text)),
                frameSampling: {frameCount: 1, frameTimestampsSeconds: []},
                tokenUsage: response.usage,
                transcript: null,
            };
        }
        case "Audio": {
            assert(models.asr !== null);
            const audio = await measureStage(stages, "Decode audio to mono 16k float32", async () =>
                decodeAudioToFloat32({filePath}),
            );
            const asr = models.asr;
            assert(asr !== null);
            const transcript = await measureStage(
                stages,
                "Transcribe audio with Whisper",
                async () => transcribeAudio(asr, audio),
            );
            const response = await measureStage(
                stages,
                "Summarize audio transcript with Gemma 3",
                async () =>
                    analyzeTranscriptWithGemma({
                        bedrockClient: models.bedrockClient,
                        kind: "audio transcript",
                        modelId,
                        region,
                        transcript,
                    }),
            );
            return {
                estimatedCostUsd: estimateCostUsd({region, usage: response.usage}),
                final: normalizeResult(parseModelJson(response.text)),
                frameSampling: {frameCount: 0, frameTimestampsSeconds: []},
                tokenUsage: response.usage,
                transcript,
            };
        }
        case "Video": {
            const durationSeconds = await measureStage(stages, "Probe video duration", async () =>
                probeMediaDurationSeconds({filePath}),
            );
            const hasAudioStream = await measureStage(
                stages,
                "Probe video audio stream",
                async () => probeMediaHasAudioStream({filePath}),
            );
            const frameTimestampsSeconds = getVideoFrameTimestampsSeconds(durationSeconds);
            const frameCount = frameTimestampsSeconds.length;
            const temporaryDirectoryPath = await fs.mkdtemp(
                joinPath(tmpdir(), "imjoshin_tags_gemma_bedrock_probe_"),
            );

            try {
                const framePayloads: Array<{bytes: Uint8Array; format: "jpeg"}> = [];
                for (const [index, frameTimestampSeconds] of frameTimestampsSeconds.entries()) {
                    const framePath = joinPath(
                        temporaryDirectoryPath,
                        `frame_${String(index).padStart(2, "0")}.jpg`,
                    );
                    await measureStage(
                        stages,
                        `Extract frame ${index + 1} of ${frameCount}`,
                        async () =>
                            extractVideoFrame({
                                filePath,
                                outputPath: framePath,
                                timeSeconds: frameTimestampSeconds,
                            }),
                    );
                    const framePayload = await measureStage(
                        stages,
                        `Prepare frame ${index + 1} for Bedrock`,
                        async () => loadResizedImagePayload(framePath),
                    );
                    framePayloads.push(framePayload);
                }

                let transcript: string | null = null;
                if (hasAudioStream) {
                    assert(models.asr !== null);
                    const audio = await measureStage(
                        stages,
                        "Decode video audio to mono 16k float32",
                        async () => decodeAudioToFloat32({filePath}),
                    );
                    const asr = models.asr;
                    assert(asr !== null);
                    transcript = await measureStage(
                        stages,
                        "Transcribe video audio with Whisper",
                        async () => transcribeAudio(asr, audio),
                    );
                }

                const response = await measureStage(
                    stages,
                    "Analyze video frames and transcript with Gemma 3",
                    async () =>
                        analyzeVideoWithGemma({
                            bedrockClient: models.bedrockClient,
                            framePayloads,
                            modelId,
                            region,
                            transcript,
                        }),
                );

                return {
                    estimatedCostUsd: estimateCostUsd({region, usage: response.usage}),
                    final: normalizeResult(parseModelJson(response.text)),
                    frameSampling: {frameCount, frameTimestampsSeconds},
                    tokenUsage: response.usage,
                    transcript,
                };
            } finally {
                await fs.rm(temporaryDirectoryPath, {force: true, recursive: true});
            }
        }
        case "Unsupported":
            return {
                estimatedCostUsd: 0,
                final: {summary: null, tags: []},
                frameSampling: {frameCount: 0, frameTimestampsSeconds: []},
                tokenUsage: {inputTokens: 0, outputTokens: 0, totalTokens: 0},
                transcript: null,
            };
        default:
            return cast(route satisfies never);
    }
}

async function analyzeImageWithGemma({
    bedrockClient,
    imagePayload,
    modelId,
    region,
}: {
    bedrockClient: BedrockRuntimeClient | null;
    imagePayload: {bytes: Uint8Array; format: "jpeg"};
    modelId: string;
    region: PricingRegion;
}): Promise<{text: string; usage: ProbeUsage}> {
    return invokeBedrockJson({
        bedrockClient,
        contentBlocks: [
            {
                image: {
                    format: imagePayload.format,
                    source: {bytes: imagePayload.bytes},
                },
            },
            {
                text:
                    "You are analyzing a single image for Alpine file search and alt-text support. " +
                    "Return only strict JSON with keys `tags` and `summary`. " +
                    "`tags` must be an array of exactly 5 short lowercase strings ordered by importance. " +
                    "`summary` must be one concise factual sentence describing the image. " +
                    "Do not include markdown, commentary, or extra keys.",
            },
        ],
        modelId,
        region,
    });
}

async function analyzeTranscriptWithGemma({
    bedrockClient,
    kind,
    modelId,
    region,
    transcript,
}: {
    bedrockClient: BedrockRuntimeClient | null;
    kind: string;
    modelId: string;
    region: PricingRegion;
    transcript: string;
}): Promise<{text: string; usage: ProbeUsage}> {
    return invokeBedrockJson({
        bedrockClient,
        contentBlocks: [
            {
                text:
                    `You are analyzing a ${kind} for Alpine file search and summarization. ` +
                    "Return only strict JSON with keys `tags` and `summary`. " +
                    "`tags` must be an array of exactly 5 short lowercase strings ordered by importance. " +
                    "`summary` must be one concise factual sentence capturing the main idea. " +
                    "Base your answer only on the transcript below. " +
                    "Do not include markdown, commentary, or extra keys.\n\n" +
                    `Transcript:\n${truncateTranscript(transcript)}`,
            },
        ],
        modelId,
        region,
    });
}

async function analyzeVideoWithGemma({
    bedrockClient,
    framePayloads,
    modelId,
    region,
    transcript,
}: {
    bedrockClient: BedrockRuntimeClient | null;
    framePayloads: ReadonlyArray<{bytes: Uint8Array; format: "jpeg"}>;
    modelId: string;
    region: PricingRegion;
    transcript: string | null;
}): Promise<{text: string; usage: ProbeUsage}> {
    const contentBlocks: Array<ContentBlock> = [
        {
            text: "The following images are chronological frames sampled from one video. Use all frames together as one sequence.",
        },
    ];

    for (const [index, framePayload] of framePayloads.entries()) {
        contentBlocks.push({text: `Frame ${index + 1}.`});
        contentBlocks.push({
            image: {
                format: framePayload.format,
                source: {bytes: framePayload.bytes},
            },
        });
    }

    if (transcript !== null) {
        contentBlocks.push({
            text: `Transcript from the video audio:\n${truncateTranscript(transcript)}`,
        });
    }

    contentBlocks.push({
        text:
            "Return only strict JSON with keys `tags` and `summary`. " +
            "`tags` must be an array of exactly 5 short lowercase strings ordered by importance. " +
            "`summary` must be one concise factual sentence describing the video. " +
            "Use the frames and transcript together when both are available. " +
            "Do not include markdown, commentary, or extra keys.",
    });

    return invokeBedrockJson({bedrockClient, contentBlocks, modelId, region});
}

async function invokeBedrockJson({
    bedrockClient,
    contentBlocks,
    modelId,
    region,
}: {
    bedrockClient: BedrockRuntimeClient | null;
    contentBlocks: Array<ContentBlock>;
    modelId: string;
    region: PricingRegion;
}): Promise<{text: string; usage: ProbeUsage}> {
    const bearerToken = getBedrockBearerTokenIfExists();
    const response =
        bearerToken !== null
            ? await sendBedrockConverseRequestWithBearerToken({
                  bearerToken,
                  contentBlocks,
                  modelId,
                  region,
              })
            : await (bedrockClient as BedrockRuntimeClient).send(
                  new ConverseCommand({
                      inferenceConfig: {
                          maxTokens: 400,
                          temperature: 0.1,
                          topP: 0.8,
                      },
                      messages: [{content: contentBlocks, role: "user"}],
                      modelId,
                  }),
              );

    return {
        text: extractResponseText(response),
        usage: {
            inputTokens: response.usage?.inputTokens ?? 0,
            outputTokens: response.usage?.outputTokens ?? 0,
            totalTokens: response.usage?.totalTokens ?? 0,
        },
    };
}

async function sendBedrockConverseRequestWithBearerToken({
    bearerToken,
    contentBlocks,
    modelId,
    region,
}: {
    bearerToken: string;
    contentBlocks: Array<ContentBlock>;
    modelId: string;
    region: PricingRegion;
}): Promise<ConverseCommandOutput> {
    // eslint-disable-next-line cyberworlds/no-global-fetch
    const response = await fetch(
        `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(
            modelId,
        )}/converse`,
        {
            body: JSON.stringify({
                inferenceConfig: {
                    maxTokens: 400,
                    temperature: 0.1,
                    topP: 0.8,
                },
                messages: [{content: contentBlocks, role: "user"}],
            }),
            headers: {
                authorization: `Bearer ${bearerToken}`,
                "content-type": "application/json",
            },
            method: "POST",
        },
    );

    if (!response.ok) {
        throw new FailedPreconditionError(
            `Bedrock bearer token request failed (${response.status}): ${await response.text()}`,
        );
    }

    return cast(await response.json());
}

function getBedrockBearerTokenIfExists(): string | null {
    const bearerToken = process.env[bedrockBearerTokenEnvironmentVariableName];
    if (bearerToken) return bearerToken;

    const legacyBearerToken = process.env[bedrockLegacyBearerTokenEnvironmentVariableName];
    if (!legacyBearerToken) return null;

    process.env[bedrockBearerTokenEnvironmentVariableName] = legacyBearerToken;
    return legacyBearerToken;
}

function extractResponseText(response: ConverseCommandOutput): string {
    const textParts =
        response.output?.message?.content
            ?.map((contentBlock: ContentBlock) => {
                if ("text" in contentBlock && typeof contentBlock.text === "string") {
                    return contentBlock.text;
                }
                return "";
            })
            .filter((text: string) => text.length > 0) ?? [];
    return textParts.join("\n").trim();
}

function parseModelJson(text: string): Record<string, unknown> {
    if (!text) return {tags: [], summary: null};

    try {
        const parsed = JSON.parse(text);
        if (typeof parsed === "object" && parsed !== null) {
            return cast(parsed);
        }
    } catch {}

    const jsonMatch = text.match(/\{[\s\S]*\}/u);
    if (jsonMatch !== null) {
        try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (typeof parsed === "object" && parsed !== null) {
                return cast(parsed);
            }
        } catch {}
    }

    return {tags: [], summary: normalizeSummary(text)};
}

function normalizeResult(parsed: Record<string, unknown>): {
    summary: string | null;
    tags: ReadonlyArray<string>;
} {
    const tags: Array<string> = [];
    if (Array.isArray(parsed.tags)) {
        for (const rawTag of parsed.tags) {
            if (typeof rawTag !== "string") continue;
            const normalizedTag = normalizeTag(rawTag);
            if (normalizedTag.length === 0 || tags.includes(normalizedTag)) continue;
            tags.push(normalizedTag);
            if (tags.length >= 5) break;
        }
    }

    return {
        summary: typeof parsed.summary === "string" ? normalizeSummary(parsed.summary) : null,
        tags,
    };
}

function normalizeTag(tag: string): string {
    return tag
        .trim()
        .toLowerCase()
        .replace(/\s+/gu, " ")
        .replace(/^[.,:;!?"']+|[.,:;!?"']+$/gu, "");
}

function normalizeSummary(summary: string): string | null {
    const normalizedSummary = summary.trim().replace(/\s+/gu, " ");
    return normalizedSummary.length > 0 ? normalizedSummary : null;
}

async function loadResizedImagePayload(
    filePath: string,
): Promise<{bytes: Uint8Array; format: "jpeg"}> {
    const buffer = await sharp(filePath, {pages: 1})
        .rotate()
        .resize({
            fit: "inside",
            height: maxImageDimensionPixels,
            width: maxImageDimensionPixels,
            withoutEnlargement: true,
        })
        .jpeg({mozjpeg: true, quality: 85})
        .toBuffer();

    return {bytes: Uint8Array.from(buffer), format: "jpeg"};
}

async function transcribeAudio(
    asr: NonNullable<ProbeModels["asr"]>,
    audio: Float32Array,
): Promise<string> {
    const output = await asr.pipe(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
    });
    return output.text.trim();
}

async function decodeAudioToFloat32({filePath}: {filePath: string}): Promise<Float32Array> {
    const subprocess = spawn(
        ffmpegExecutablePath,
        [
            "-i",
            filePath,
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
            env: getProcessEnvToPropagate(),
            stdio: ["ignore", "pipe", "pipe"],
        },
    );

    const stdoutChunks: Array<Buffer> = [];
    const stderrChunks: Array<Buffer> = [];
    subprocess.stdout.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
    });
    subprocess.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
    });

    await waitForProcessExit(subprocess).catch(error => {
        const stderr = concatenateChunks(stderrChunks).toString("utf8").trim();
        throw new FailedPreconditionError(
            `${error instanceof Error ? error.message : String(error)}\n\nstderr:\n${stderr}`,
        );
    });

    const buffer = concatenateChunks(stdoutChunks);
    assert(buffer.length % 4 === 0);
    const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
    );
    return new Float32Array(arrayBuffer);
}

async function probeMediaDurationSeconds({filePath}: {filePath: string}): Promise<number> {
    const stdout = await runTextProcess({
        args: [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            filePath,
        ],
        command: ffprobeExecutablePath,
    });

    const durationSeconds = parseFloat(stdout.trim());
    if (isNaN(durationSeconds) || !Number.isFinite(durationSeconds)) {
        throw new FailedPreconditionError(
            `Could not parse duration from ffprobe output: ${stdout}`,
        );
    }

    return durationSeconds;
}

async function probeMediaHasAudioStream({filePath}: {filePath: string}): Promise<boolean> {
    const stdout = await runTextProcess({
        args: [
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
        command: ffprobeExecutablePath,
    });

    return stdout.trim().length > 0;
}

async function extractVideoFrame({
    filePath,
    outputPath,
    timeSeconds,
}: {
    filePath: string;
    outputPath: string;
    timeSeconds: number;
}): Promise<void> {
    await runTextProcess({
        args: [
            "-y",
            "-ss",
            String(Math.max(0, timeSeconds)),
            "-i",
            filePath,
            "-frames:v",
            "1",
            outputPath,
        ],
        command: ffmpegExecutablePath,
    });
}

function getVideoFrameTimestampsSeconds(durationSeconds: number): Array<number> {
    if (durationSeconds <= 5) return [durationSeconds / 2];

    let frameCount =
        durationSeconds <= 60
            ? Math.max(2, Math.round(durationSeconds / 6))
            : 10 + Math.round((durationSeconds - 60) / 12);
    frameCount = Math.max(1, Math.min(frameCount, maxVideoFrameCount));

    return [...Array(frameCount).keys()].map(
        index => durationSeconds * ((index + 0.5) / frameCount),
    );
}

async function runTextProcess({
    args,
    command,
}: {
    args: Array<string>;
    command: string;
}): Promise<string> {
    const subprocess = spawn(command, args, {
        env: getProcessEnvToPropagate(),
        stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    subprocess.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
    });
    subprocess.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
    });

    await waitForProcessExit(subprocess).catch(error => {
        throw new FailedPreconditionError(
            `${error instanceof Error ? error.message : String(error)}\n\nstderr:\n${stderr.trim()}`,
        );
    });

    return stdout;
}

function truncateTranscript(transcript: string): string {
    const normalizedTranscript = transcript.trim().replace(/\s+/gu, " ");
    if (normalizedTranscript.length <= maxTranscriptCharacters) return normalizedTranscript;
    return `${normalizedTranscript.slice(0, maxTranscriptCharacters - 3).trimEnd()}...`;
}

function estimateCostUsd({region, usage}: {region: PricingRegion; usage: ProbeUsage}): number {
    return (
        (usage.inputTokens / 1_000_000) * gemmaInputCostPerMillionTokensByRegion[region] +
        (usage.outputTokens / 1_000_000) * gemmaOutputCostPerMillionTokensByRegion[region]
    );
}

async function measureStage<Value>(
    stages: Array<ProbeStage>,
    name: string,
    fn: () => Promise<Value>,
): Promise<Value> {
    const start = performance.now();
    const value = await fn();
    stages.push({
        currentRssMiB: getCurrentRssMiB(),
        durationMs: performance.now() - start,
        maxRssMiB: getMaxRssMiB(),
        name,
    });
    return value;
}

function getCurrentRssMiB(): number {
    return process.memoryUsage().rss / (1024 * 1024);
}

function getMaxRssMiB(): number {
    return process.resourceUsage().maxRSS / 1024;
}

function concatenateChunks(chunks: ReadonlyArray<Buffer>): Buffer {
    return Buffer.concat(chunks.map(chunk => Uint8Array.from(chunk)));
}

function getPricingRegionOrThrow(region: string): PricingRegion {
    switch (region) {
        case "us-east-1":
        case "us-east-2":
        case "us-west-2":
            return region;
        default:
            throw new InvalidArgumentError(`Unsupported region for Gemma pricing: ${region}`);
    }
}

void main();
