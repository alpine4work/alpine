import {spawn} from "child_process";
import fs from "fs/promises";
import {tmpdir} from "os";
import {join as joinPath} from "path";
import {performance} from "perf_hooks";
import {parseArgs} from "util";
import {getProcessEnvToPropagate} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {FailedPreconditionError, InvalidArgumentError} from "~/shared/error/error.js";
import {
    FileContentType,
    getPathFileContentTypeIfExists,
    isFileAudioContentType,
    isFileImageContentType,
    isFileVideoContentType,
} from "~/shared/files/file_content_type.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";

type ProbeRoute = "Audio" | "Image" | "Unsupported" | "Video";

type ProbeStage = {
    readonly currentRssMiB: number;
    readonly durationMs: number;
    readonly maxRssMiB: number;
    readonly name: string;
};

type ProbeResult = {
    readonly contentType: FileContentType;
    readonly filePath: string;
    readonly final: {
        readonly summary: string | null;
        readonly tags: ReadonlyArray<string>;
    };
    readonly peakRssMiB: number;
    readonly route: ProbeRoute;
    readonly stages: ReadonlyArray<ProbeStage>;
    readonly totalDurationMs: number;
    readonly transcript: string | null;
    readonly transcriptSummarySourceSentences: ReadonlyArray<string>;
    readonly visionDescriptions: {
        readonly frame25Caption: string | null;
        readonly frame75Caption: string | null;
        readonly imageCaption: string | null;
    };
    readonly visionText: {
        readonly frame25Text: string | null;
        readonly frame75Text: string | null;
        readonly imageText: string | null;
    };
    readonly visionTags: {
        readonly frame25Labels: ReadonlyArray<string>;
        readonly frame75Labels: ReadonlyArray<string>;
        readonly imageLabels: ReadonlyArray<string>;
    };
};

type ProbePipelines = {
    readonly asr: {
        readonly pipe: (
            audio: Float32Array,
            options?: {chunk_length_s?: number; stride_length_s?: number},
        ) => Promise<{text: string}>;
    } | null;
    readonly ocr: {
        readonly pipe: (image: string) => Promise<Array<{generated_text: string}>>;
    } | null;
    readonly captioner: {
        readonly pipe: (image: string) => Promise<Array<{generated_text: string}>>;
    } | null;
    readonly classifier: {
        readonly pipe: (image: string) => Promise<Array<{label: string; score: number}>>;
    } | null;
};

const ffmpegExecutablePath = joinPath(runfilesPath, "ffmpeg/install/bin/ffmpeg");
const ffprobeExecutablePath = joinPath(runfilesPath, "ffmpeg/install/bin/ffprobe");

const defaultOcrModel = "Xenova/trocr-small-printed";
const defaultAsrModel = "Xenova/whisper-tiny.en";
const defaultCaptionModel = "Xenova/vit-gpt2-image-captioning";
const defaultClassifierModel = "Xenova/vit-base-patch16-224";

const stopWords = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "but",
    "by",
    "for",
    "from",
    "has",
    "have",
    "he",
    "i",
    "if",
    "in",
    "is",
    "it",
    "its",
    "me",
    "my",
    "not",
    "of",
    "on",
    "or",
    "our",
    "out",
    "so",
    "that",
    "the",
    "their",
    "them",
    "there",
    "these",
    "they",
    "this",
    "to",
    "up",
    "us",
    "was",
    "we",
    "were",
    "what",
    "when",
    "where",
    "which",
    "who",
    "with",
    "you",
    "your",
]);

const captionNoiseWords = new Set([
    "attached",
    "close",
    "eating",
    "front",
    "growing",
    "holding",
    "image",
    "large",
    "next",
    "photo",
    "picture",
    "piece",
    "posing",
    "sitting",
    "small",
    "standing",
    "top",
    "view",
]);

async function main() {
    const {values} = parseArgs({
        options: {
            asrModel: {type: "string"},
            cacheDir: {type: "string"},
            captionModel: {type: "string"},
            classifierModel: {type: "string"},
            file: {type: "string"},
            ocrModel: {type: "string"},
            visionModel: {type: "string"},
        },
        strict: true,
    });

    const filePath = values.file;
    if (!filePath) {
        throw new InvalidArgumentError("Expected `--file=/absolute/path/to/file`");
    }

    const stats = await fs.stat(filePath);
    assert(stats.isFile());

    const contentType = getPathFileContentTypeIfExists(filePath) ?? "application/octet-stream";
    const route = getProbeRoute(contentType);
    const stages: Array<ProbeStage> = [];
    const totalStart = performance.now();

    const cacheDirectoryPath =
        values.cacheDir ?? joinPath(process.env.HOME ?? tmpdir(), ".cache/cyberworlds/models");
    const pipelines = await createProbePipelinesForRoute({
        asrModel: values.asrModel ?? defaultAsrModel,
        cacheDirectoryPath,
        captionModel: values.captionModel ?? defaultCaptionModel,
        classifierModel: values.classifierModel ?? values.visionModel ?? defaultClassifierModel,
        ocrModel: values.ocrModel ?? defaultOcrModel,
        route,
        stages,
    });

    const result = await runProbeForRoute({
        filePath,
        pipelines,
        route,
        stages,
    });

    const totalDurationMs = performance.now() - totalStart;
    const peakRssMiB = getMaxRssMiB();

    const finalResult: ProbeResult = {
        contentType,
        filePath,
        final: result.final,
        peakRssMiB,
        route,
        stages,
        totalDurationMs,
        transcript: result.transcript,
        transcriptSummarySourceSentences: result.transcriptSummarySourceSentences,
        visionDescriptions: result.visionDescriptions,
        visionTags: result.visionTags,
        visionText: result.visionText,
    };

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(finalResult, null, 2));
}

function getProbeRoute(contentType: FileContentType): ProbeRoute {
    if (isFileImageContentType(contentType)) return "Image";
    if (isFileAudioContentType(contentType)) return "Audio";
    if (isFileVideoContentType(contentType)) return "Video";
    return "Unsupported";
}

async function createProbePipelines({
    asrModel,
    cacheDirectoryPath,
    captionModel,
    classifierModel,
    loadAsr,
    loadCaptioner,
    loadClassifier,
    loadOcr,
    ocrModel,
}: {
    asrModel: string;
    cacheDirectoryPath: string;
    captionModel: string;
    classifierModel: string;
    loadAsr: boolean;
    loadCaptioner: boolean;
    loadClassifier: boolean;
    loadOcr: boolean;
    ocrModel: string;
}): Promise<ProbePipelines> {
    const transformers: typeof import("@xenova/transformers") = await import(
        /* @vite-ignore */ "@xenova/" + cast("transformers")
    );

    transformers.env.cacheDir = cacheDirectoryPath;
    transformers.env.allowLocalModels = true;
    transformers.env.allowRemoteModels = true;
    transformers.env.backends.onnx.logLevel = "error";

    const [asrPipe, ocrPipe, captionerPipe, classifierPipe] = await runAllPromises([
        loadAsr
            ? transformers.pipeline("automatic-speech-recognition", asrModel)
            : Promise.resolve(null),
        loadOcr ? transformers.pipeline("image-to-text", ocrModel) : Promise.resolve(null),
        loadCaptioner
            ? transformers.pipeline("image-to-text", captionModel)
            : Promise.resolve(null),
        loadClassifier
            ? transformers.pipeline("image-classification", classifierModel)
            : Promise.resolve(null),
    ]);

    return {
        asr:
            asrPipe === null
                ? null
                : {
                      pipe: (audio, options) => asrPipe(audio, options),
                  },
        ocr:
            ocrPipe === null
                ? null
                : {
                      pipe: image => ocrPipe(image),
                  },
        captioner:
            captionerPipe === null
                ? null
                : {
                      pipe: image => captionerPipe(image),
                  },
        classifier:
            classifierPipe === null
                ? null
                : {
                      pipe: image => classifierPipe(image),
                  },
    };
}

async function createProbePipelinesForRoute({
    asrModel,
    cacheDirectoryPath,
    captionModel,
    classifierModel,
    ocrModel,
    route,
    stages,
}: {
    asrModel: string;
    cacheDirectoryPath: string;
    captionModel: string;
    classifierModel: string;
    ocrModel: string;
    route: ProbeRoute;
    stages: Array<ProbeStage>;
}): Promise<ProbePipelines> {
    switch (route) {
        case "Image":
            return measureStage(stages, "Load local OCR + caption + classifier models", async () =>
                createProbePipelines({
                    asrModel,
                    cacheDirectoryPath,
                    captionModel,
                    classifierModel,
                    loadAsr: false,
                    loadCaptioner: true,
                    loadClassifier: true,
                    loadOcr: true,
                    ocrModel,
                }),
            );
        case "Audio":
            return measureStage(stages, "Load local ASR model", async () =>
                createProbePipelines({
                    asrModel,
                    cacheDirectoryPath,
                    captionModel,
                    classifierModel,
                    loadAsr: true,
                    loadCaptioner: false,
                    loadClassifier: false,
                    loadOcr: false,
                    ocrModel,
                }),
            );
        case "Video":
            return measureStage(
                stages,
                "Load local OCR + caption + classifier + ASR models",
                async () =>
                    createProbePipelines({
                        asrModel,
                        cacheDirectoryPath,
                        captionModel,
                        classifierModel,
                        loadAsr: true,
                        loadCaptioner: true,
                        loadClassifier: true,
                        loadOcr: true,
                        ocrModel,
                    }),
            );
        case "Unsupported":
            return {
                asr: null,
                captioner: null,
                classifier: null,
                ocr: null,
            };
        default:
            return cast(route satisfies never);
    }
}

async function runProbeForRoute({
    filePath,
    pipelines,
    route,
    stages,
}: {
    filePath: string;
    pipelines: ProbePipelines;
    route: ProbeRoute;
    stages: Array<ProbeStage>;
}): Promise<{
    final: {readonly summary: string | null; readonly tags: ReadonlyArray<string>};
    transcript: string | null;
    transcriptSummarySourceSentences: ReadonlyArray<string>;
    visionDescriptions: {
        readonly frame25Caption: string | null;
        readonly frame75Caption: string | null;
        readonly imageCaption: string | null;
    };
    visionTags: {
        readonly frame25Labels: ReadonlyArray<string>;
        readonly frame75Labels: ReadonlyArray<string>;
        readonly imageLabels: ReadonlyArray<string>;
    };
    visionText: {
        readonly frame25Text: string | null;
        readonly frame75Text: string | null;
        readonly imageText: string | null;
    };
}> {
    switch (route) {
        case "Image": {
            const ocr = pipelines.ocr;
            const captioner = pipelines.captioner;
            const classifier = pipelines.classifier;
            assert(ocr !== null);
            assert(captioner !== null);
            assert(classifier !== null);
            const imageText = await measureStage(stages, "OCR image", async () =>
                ocrImageText(ocr, filePath),
            );
            const imageCaption = await measureStage(stages, "Generate image caption", async () =>
                captionImage(captioner, filePath),
            );
            const imageLabels = await measureStage(stages, "Classify image content", async () =>
                classifyImageLabels(classifier, filePath),
            );
            return {
                final: {
                    summary: null,
                    tags: createImageTags({
                        classifierLabels: imageLabels,
                        imageCaption,
                        ocrText: imageText,
                    }),
                },
                transcript: null,
                transcriptSummarySourceSentences: [],
                visionDescriptions: {
                    frame25Caption: null,
                    frame75Caption: null,
                    imageCaption,
                },
                visionTags: {
                    frame25Labels: [],
                    frame75Labels: [],
                    imageLabels,
                },
                visionText: {frame25Text: null, frame75Text: null, imageText},
            };
        }
        case "Audio": {
            const asr = pipelines.asr;
            assert(asr !== null);
            const audio = await measureStage(stages, "Decode audio to mono 16k float32", async () =>
                decodeAudioToFloat32({filePath}),
            );
            const transcript = await measureStage(stages, "Transcribe audio", async () =>
                transcribeAudio(asr, audio),
            );
            const {summary, sourceSentences} = await measureStage(
                stages,
                "Build extractive transcript summary",
                async () => createExtractiveSummary(transcript),
            );
            return {
                final: {
                    summary,
                    tags: extractTranscriptTagsOrderedByUseCount(transcript),
                },
                transcript,
                transcriptSummarySourceSentences: sourceSentences,
                visionDescriptions: {
                    frame25Caption: null,
                    frame75Caption: null,
                    imageCaption: null,
                },
                visionTags: {
                    frame25Labels: [],
                    frame75Labels: [],
                    imageLabels: [],
                },
                visionText: {frame25Text: null, frame75Text: null, imageText: null},
            };
        }
        case "Video": {
            const asr = pipelines.asr;
            const ocr = pipelines.ocr;
            const captioner = pipelines.captioner;
            const classifier = pipelines.classifier;
            assert(asr !== null);
            assert(ocr !== null);
            assert(captioner !== null);
            assert(classifier !== null);
            const durationSeconds = await measureStage(stages, "Probe video duration", async () =>
                probeMediaDurationSeconds({filePath}),
            );
            const hasAudioStream = await measureStage(
                stages,
                "Probe video audio stream",
                async () => probeMediaHasAudioStream({filePath}),
            );

            const temporaryDirectoryPath = await fs.mkdtemp(
                joinPath(tmpdir(), "imjoshin_file_content_probe_"),
            );

            try {
                const frame25Path = joinPath(temporaryDirectoryPath, "frame_25.png");
                const frame75Path = joinPath(temporaryDirectoryPath, "frame_75.png");

                await measureStage(stages, "Extract frame at 25%", async () =>
                    extractVideoFrame({
                        filePath,
                        outputPath: frame25Path,
                        timeSeconds: durationSeconds * 0.25,
                    }),
                );
                const frame25Text = await measureStage(stages, "OCR frame at 25%", async () =>
                    ocrImageText(ocr, frame25Path),
                );
                const frame25Caption = await measureStage(
                    stages,
                    "Generate frame caption at 25%",
                    async () => captionImage(captioner, frame25Path),
                );
                const frame25Labels = await measureStage(
                    stages,
                    "Classify frame content at 25%",
                    async () => classifyImageLabels(classifier, frame25Path),
                );

                await measureStage(stages, "Extract frame at 75%", async () =>
                    extractVideoFrame({
                        filePath,
                        outputPath: frame75Path,
                        timeSeconds: durationSeconds * 0.75,
                    }),
                );
                const frame75Text = await measureStage(stages, "OCR frame at 75%", async () =>
                    ocrImageText(ocr, frame75Path),
                );
                const frame75Caption = await measureStage(
                    stages,
                    "Generate frame caption at 75%",
                    async () => captionImage(captioner, frame75Path),
                );
                const frame75Labels = await measureStage(
                    stages,
                    "Classify frame content at 75%",
                    async () => classifyImageLabels(classifier, frame75Path),
                );

                let summary: string | null = null;
                let transcript: string | null = null;
                let sourceSentences: ReadonlyArray<string> = [];

                if (hasAudioStream) {
                    const audio = await measureStage(
                        stages,
                        "Decode video audio track to mono 16k float32",
                        async () => decodeAudioToFloat32({filePath}),
                    );
                    const audioTranscript = await measureStage(
                        stages,
                        "Transcribe video audio",
                        async () => transcribeAudio(asr, audio),
                    );
                    transcript = audioTranscript;
                    const summaryResult = await measureStage(
                        stages,
                        "Build extractive video transcript summary",
                        async () => createExtractiveSummary(audioTranscript),
                    );
                    summary = summaryResult.summary;
                    sourceSentences = summaryResult.sourceSentences;
                }

                return {
                    final: {
                        summary,
                        tags: createVideoTags({
                            frame25Caption,
                            frame25Labels,
                            frame25Text,
                            frame75Caption,
                            frame75Labels,
                            frame75Text,
                            transcript,
                        }),
                    },
                    transcript,
                    transcriptSummarySourceSentences: sourceSentences,
                    visionDescriptions: {
                        frame25Caption,
                        frame75Caption,
                        imageCaption: null,
                    },
                    visionTags: {
                        frame25Labels,
                        frame75Labels,
                        imageLabels: [],
                    },
                    visionText: {
                        frame25Text,
                        frame75Text,
                        imageText: null,
                    },
                };
            } finally {
                await fs.rm(temporaryDirectoryPath, {force: true, recursive: true});
            }
        }
        case "Unsupported":
            return {
                final: {summary: null, tags: []},
                transcript: null,
                transcriptSummarySourceSentences: [],
                visionDescriptions: {
                    frame25Caption: null,
                    frame75Caption: null,
                    imageCaption: null,
                },
                visionTags: {
                    frame25Labels: [],
                    frame75Labels: [],
                    imageLabels: [],
                },
                visionText: {frame25Text: null, frame75Text: null, imageText: null},
            };
        default:
            return cast(route satisfies never);
    }
}

async function measureStage<Value>(
    stages: Array<ProbeStage>,
    name: string,
    fn: () => Promise<Value>,
): Promise<Value> {
    const start = performance.now();
    const value = await fn();
    const durationMs = performance.now() - start;
    stages.push({
        currentRssMiB: getCurrentRssMiB(),
        durationMs,
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

async function ocrImageText(
    ocr: NonNullable<ProbePipelines["ocr"]>,
    filePath: string,
): Promise<string> {
    const output = await ocr.pipe(filePath);
    return output
        .map(item => item.generated_text.trim())
        .filter(text => text.length > 0)
        .join("\n")
        .trim();
}

async function captionImage(
    captioner: NonNullable<ProbePipelines["captioner"]>,
    filePath: string,
): Promise<string> {
    const output = await captioner.pipe(filePath);
    return output
        .map(item => item.generated_text.trim())
        .filter(text => text.length > 0)
        .join("\n")
        .trim();
}

async function classifyImageLabels(
    classifier: NonNullable<ProbePipelines["classifier"]>,
    filePath: string,
): Promise<Array<string>> {
    const classifications = await classifier.pipe(filePath);
    const strongClassifications = classifications.filter(
        classification => classification.score >= 0.8,
    );
    return normalizeVisionLabels(strongClassifications.map(classification => classification.label));
}

async function transcribeAudio(
    asr: NonNullable<ProbePipelines["asr"]>,
    audio: Float32Array,
): Promise<string> {
    const output = await asr.pipe(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
    });
    return output.text.trim();
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

    const stdoutChunks: Array<Uint8Array> = [];
    const stderrChunks: Array<Uint8Array> = [];

    subprocess.stdout.on("data", (chunk: Buffer) => {
        stdoutChunks.push(Uint8Array.from(chunk));
    });
    subprocess.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(Uint8Array.from(chunk));
    });

    await waitForProcessExit(subprocess).catch(error => {
        const stderr = Buffer.from(concatenateChunks(stderrChunks)).toString("utf8").trim();
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

function createExtractiveSummary(transcript: string): {
    summary: string | null;
    sourceSentences: ReadonlyArray<string>;
} {
    const sentences = splitSentences(transcript);
    if (sentences.length === 0) return {summary: null, sourceSentences: []};
    if (sentences.length === 1) {
        const sentence = sentences[0];
        assert(sentence !== undefined);
        return {summary: sentence, sourceSentences: sentences};
    }

    const tokenCounts = new Map<string, number>();
    for (const sentence of sentences) {
        for (const token of tokenizeForKeywords(sentence)) {
            tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
        }
    }

    const rankedSentences = sentences
        .map((sentence, index) => {
            const tokens = tokenizeForKeywords(sentence);
            const tokenScore = tokens.reduce(
                (sum, token) => sum + (tokenCounts.get(token) ?? 0),
                0,
            );
            const positionBoost = index === 0 ? 1.25 : 1;
            return {
                index,
                score: positionBoost * (tokenScore / Math.max(tokens.length, 1)),
                sentence,
            };
        })
        .sort((a, b) => b.score - a.score);

    const chosen = rankedSentences
        .slice(0, Math.min(2, rankedSentences.length))
        .sort((a, b) => a.index - b.index)
        .map(item => item.sentence);

    return {
        sourceSentences: chosen,
        summary: chosen.join(" "),
    };
}

function splitSentences(text: string): Array<string> {
    return text
        .split(/(?<=[.!?])\s+|\n+/u)
        .map(sentence => sentence.trim())
        .filter(sentence => sentence.length > 0);
}

function extractKeywordTags(texts: ReadonlyArray<string>): Array<string> {
    return extractKeywordTagCounts(texts).map(([token]) => token);
}

function extractTranscriptTagsOrderedByUseCount(transcript: string): Array<string> {
    return extractKeywordTagCounts([transcript]).map(([token]) => token);
}

function extractKeywordTagCounts(texts: ReadonlyArray<string>): Array<[string, number]> {
    const counts = new Map<string, number>();

    for (const text of texts) {
        for (const token of tokenizeForKeywords(text)) {
            counts.set(token, (counts.get(token) ?? 0) + 1);
        }
    }

    return [...counts.entries()]
        .sort((a, b) => {
            if (b[1] !== a[1]) return b[1] - a[1];
            return a[0].localeCompare(b[0]);
        })
        .slice(0, 20);
}

function createImageTags({
    classifierLabels,
    imageCaption,
    ocrText,
}: {
    classifierLabels: ReadonlyArray<string>;
    imageCaption: string;
    ocrText: string;
}): Array<string> {
    const tags = new Set<string>();

    for (const label of classifierLabels) {
        tags.add(label);
        for (const token of expandPhraseIntoKeywordTags(label)) {
            tags.add(token);
        }
    }

    if (captionIsLikelyUseful(imageCaption)) {
        for (const token of extractCaptionKeywordTags(imageCaption)) {
            tags.add(token);
        }
    }

    for (const token of extractKeywordTags([ocrText])) {
        tags.add(token);
    }

    return [...tags].slice(0, 20);
}

function createVideoTags({
    frame25Caption,
    frame25Labels,
    frame25Text,
    frame75Caption,
    frame75Labels,
    frame75Text,
    transcript,
}: {
    frame25Caption: string;
    frame25Labels: ReadonlyArray<string>;
    frame25Text: string;
    frame75Caption: string;
    frame75Labels: ReadonlyArray<string>;
    frame75Text: string;
    transcript: string | null;
}): Array<string> {
    const tags = new Set<string>();

    for (const label of [...frame25Labels, ...frame75Labels]) {
        tags.add(label);
        for (const token of expandPhraseIntoKeywordTags(label)) {
            tags.add(token);
        }
    }

    for (const caption of [frame25Caption, frame75Caption]) {
        if (!captionIsLikelyUseful(caption)) continue;
        for (const token of extractCaptionKeywordTags(caption)) {
            tags.add(token);
        }
    }

    for (const token of extractKeywordTags([frame25Text, frame75Text, transcript ?? ""])) {
        tags.add(token);
    }

    return [...tags].slice(0, 20);
}

function normalizeVisionLabels(labels: ReadonlyArray<string>): Array<string> {
    const normalizedLabels = new Set<string>();

    for (const label of labels) {
        for (const part of label.split(/[;,/]/u)) {
            const normalizedLabel = part.trim().toLowerCase();
            if (normalizedLabel.length < 2) continue;
            normalizedLabels.add(normalizedLabel);
        }
    }

    return [...normalizedLabels];
}

function expandPhraseIntoKeywordTags(label: string): Array<string> {
    const tokenMatches = label.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) ?? [];
    return tokenMatches
        .map(token => token.toLowerCase())
        .filter(token => token.length >= 3)
        .filter(token => !stopWords.has(token));
}

function tokenizeForKeywords(text: string): Array<string> {
    const rawTokens = text.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) ?? [];
    return rawTokens
        .map(rawToken => ({
            normalizedToken: rawToken.toLowerCase(),
            rawToken,
        }))
        .filter(({normalizedToken, rawToken}) => {
            if (/^\d+$/.test(normalizedToken)) return false;
            if (stopWords.has(normalizedToken)) return false;
            if (normalizedToken.length >= 3) return true;
            return (
                normalizedToken.length >= 2 &&
                ((rawToken === rawToken.toUpperCase() && /[A-Z]/.test(rawToken)) ||
                    /[0-9]/.test(rawToken))
            );
        })
        .map(({normalizedToken}) => normalizedToken);
}

function extractCaptionKeywordTags(caption: string): Array<string> {
    const tags = new Set<string>();

    for (const token of tokenizeForKeywords(caption)) {
        if (captionNoiseWords.has(token)) continue;
        tags.add(token);
    }

    return [...tags];
}

function captionIsLikelyUseful(caption: string): boolean {
    const tokens = tokenizeForKeywords(caption);
    if (tokens.length === 0) return false;

    const uniqueTokenCount = new Set(tokens).size;
    if (tokens.length >= 8 && uniqueTokenCount / tokens.length < 0.7) {
        return false;
    }

    const tokenCounts = new Map<string, number>();
    for (const token of tokens) {
        tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
    }

    const maxTokenCount = Math.max(...tokenCounts.values());
    if (tokens.length >= 8 && maxTokenCount >= 3) {
        return false;
    }

    return true;
}

function concatenateChunks(chunks: ReadonlyArray<Uint8Array>): Uint8Array {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
    }

    return combined;
}

await main();
