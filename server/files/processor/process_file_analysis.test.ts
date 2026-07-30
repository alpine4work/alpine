import {GetObjectCommandOutput} from "@aws-sdk/client-s3";
import {jest} from "@jest/globals";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {Readable} from "stream";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {FileProcessorActionContext} from "~/server/files/data/file_processor_context.js";
import {FileProcessorAnalysisResponse} from "~/server/files/processor/file_processor_tag_instructions.js";
import {
    isFileContentTypeSupportedForAnalysis,
    processFileAnalysis,
} from "~/server/files/processor/process_file_analysis.js";
import {
    LanguageModelsGenerateObjectOptions,
    LanguageModelsGenerateObjectResult,
} from "~/server/language_models/language_models_types.js";
import {InternalError} from "~/shared/error/error.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0WQAAAAASUVORK5CYII=",
    "base64",
);

type GenerateObjectForTest = (
    options: LanguageModelsGenerateObjectOptions<FileProcessorAnalysisResponse>,
) => Promise<LanguageModelsGenerateObjectResult<FileProcessorAnalysisResponse>>;

type MetadataContextForTest = {
    readonly languageModels: {
        readonly generateObject: jest.MockedFunction<GenerateObjectForTest>;
    };
    readonly r2: {
        readonly GetObject: jest.MockedFunction<CloudflareR2ContextModule["GetObject"]>;
        readonly PutObject: jest.MockedFunction<CloudflareR2ContextModule["PutObject"]>;
    };
    readonly tracer: {
        readonly withSpan: (
            name: string,
            action: (context: FileProcessorActionContext, span: TracerSpan) => Promise<unknown>,
        ) => Promise<unknown>;
    };
};

function createMetadataContextForTest({
    generateObject = jest.fn<GenerateObjectForTest>(),
    getObject = jest.fn<CloudflareR2ContextModule["GetObject"]>(),
    putObject = jest.fn<CloudflareR2ContextModule["PutObject"]>(),
}: {
    readonly generateObject?: jest.MockedFunction<GenerateObjectForTest>;
    readonly getObject?: jest.MockedFunction<CloudflareR2ContextModule["GetObject"]>;
    readonly putObject?: jest.MockedFunction<CloudflareR2ContextModule["PutObject"]>;
} = {}): MetadataContextForTest {
    const context = {
        languageModels: {
            generateObject,
        },
        r2: {
            GetObject: getObject,
            PutObject: putObject,
        },
    };

    const tracer = {
        withSpan: async (
            name: string,
            action: (context: FileProcessorActionContext, span: TracerSpan) => Promise<unknown>,
        ) => {
            return await testTracer.withSpan(name, async span => {
                return await action(context as unknown as FileProcessorActionContext, span);
            });
        },
    };

    return {
        ...context,
        tracer,
    };
}

function createGenerateObjectMock(
    result: LanguageModelsGenerateObjectResult<FileProcessorAnalysisResponse>,
): jest.MockedFunction<GenerateObjectForTest> {
    return jest.fn<GenerateObjectForTest>().mockResolvedValue(result);
}

function createGetObjectMock(
    body: Readable,
): jest.MockedFunction<CloudflareR2ContextModule["GetObject"]> {
    return jest
        .fn<CloudflareR2ContextModule["GetObject"]>()
        .mockResolvedValue({Body: body} as GetObjectCommandOutput);
}

afterEach(() => {
    jest.restoreAllMocks();
});

test("reports which content types are supported for analysis", () => {
    expect(isFileContentTypeSupportedForAnalysis("image/png")).toBe(true);
    expect(isFileContentTypeSupportedForAnalysis("audio/mpeg")).toBe(true);
    expect(isFileContentTypeSupportedForAnalysis("video/mp4")).toBe(true);
    expect(isFileContentTypeSupportedForAnalysis("application/json")).toBe(false);
});

test("returns analysis for supported image files", async () => {
    const generateObject = createGenerateObjectMock({
        object: {
            caption: "  Cat in a window.  ",
            description: "  Cat in a window.  ",
            tags: [
                "Cat",
                "cat",
                "  pet ",
                "",
                "window",
                "light",
                "curtain",
                "house",
                "sun",
                "animal",
                "extra",
            ],
        },
        text: "{}",
    });
    const getObject = createGetObjectMock(Readable.from(onePixelPng));
    const context = createMetadataContextForTest({generateObject, getObject});

    const result = await processFileAnalysis(context as unknown as FileProcessorActionContext, {
        contentType: "image/png",
        fileId: "file1" as never,
        parentTemporaryDirectoryPath: "/tmp",
        spaceId: "space1" as never,
    });

    expect(getObject).toHaveBeenCalledWith(
        {
            Bucket: "cyberworlds-files",
            Key: "space1/file1",
        },
        expect.objectContaining({
            signal: expect.any(AbortSignal),
        }),
    );
    expect(generateObject).toHaveBeenCalledWith(
        expect.objectContaining({
            model: "google.gemma-3-4b-it",
            messages: [
                expect.objectContaining({
                    role: "user",
                }),
            ],
        }),
    );
    expect(result).toMatchObject({
        ok: true,
        analysis: {
            caption: "Cat in a window.",
            description: "Cat in a window.",
            tags: ["cat", "pet", "window", "light", "curtain", "house", "sun", "animal", "extra"],
        },
    });
});

test("drops tags from the end until the combined tag text fits", async () => {
    const firstTag = "a".repeat(80);
    const secondTag = "b".repeat(80);
    const thirdTag = "c".repeat(80);
    const fourthTag = "d".repeat(80);
    const generateObject = createGenerateObjectMock({
        object: {
            caption: "Cat in a window.",
            description: "Cat in a window.",
            tags: [firstTag, secondTag, thirdTag, fourthTag],
        },
        text: "{}",
    });
    const context = createMetadataContextForTest({
        generateObject,
        getObject: createGetObjectMock(Readable.from(onePixelPng)),
    });

    const result = await processFileAnalysis(context as unknown as FileProcessorActionContext, {
        contentType: "image/png",
        fileId: "file1" as never,
        parentTemporaryDirectoryPath: "/tmp",
        spaceId: "space1" as never,
    });

    expect(result).toMatchObject({
        ok: true,
        analysis: {tags: [firstTag, secondTag, thirdTag]},
    });
});

test("keeps dropping tags until multiple tags have been removed", async () => {
    const firstTag = "a".repeat(80);
    const secondTag = "b".repeat(80);
    const thirdTag = "c".repeat(80);
    const fourthTag = "d".repeat(20);
    const fifthTag = "e".repeat(20);
    const sixthTag = "f".repeat(20);
    const generateObject = createGenerateObjectMock({
        object: {
            caption: "Cat in a window.",
            description: "Cat in a window.",
            tags: [firstTag, secondTag, thirdTag, fourthTag, fifthTag, sixthTag],
        },
        text: "{}",
    });
    const context = createMetadataContextForTest({
        generateObject,
        getObject: createGetObjectMock(Readable.from(onePixelPng)),
    });

    const result = await processFileAnalysis(context as unknown as FileProcessorActionContext, {
        contentType: "image/png",
        fileId: "file1" as never,
        parentTemporaryDirectoryPath: "/tmp",
        spaceId: "space1" as never,
    });

    expect(result).toMatchObject({
        ok: true,
        analysis: {tags: [firstTag, secondTag, thirdTag]},
    });
});

test("uses the provided local input path instead of re-downloading the file", async () => {
    const inputPath = joinPath("/tmp", `process_file_analysis_${Date.now()}.png`);
    await fs.writeFile(inputPath, Uint8Array.from(onePixelPng));

    try {
        const getObject = createGetObjectMock(Readable.from(onePixelPng));
        const generateObject = createGenerateObjectMock({
            object: {
                caption: "Local test image.",
                description:
                    "A local test image used to verify analysis without re-downloading from storage.",
                tags: ["local", "test", "image"],
            },
            text: "{}",
        });
        const context = createMetadataContextForTest({generateObject, getObject});

        await processFileAnalysis(context as unknown as FileProcessorActionContext, {
            contentType: "image/png",
            fileId: "file1" as never,
            inputPathIfExists: inputPath,
            parentTemporaryDirectoryPath: "/tmp",
            spaceId: "space1" as never,
        });

        expect(getObject).not.toHaveBeenCalled();
        expect(generateObject).toHaveBeenCalled();
    } finally {
        await fs.unlink(inputPath).catch(() => {});
    }
});

test("aborts in-flight LLM analysis when the caller signal aborts", async () => {
    const inputPath = joinPath("/tmp", `process_file_analysis_${Date.now()}.png`);
    await fs.writeFile(inputPath, Uint8Array.from(onePixelPng));

    try {
        const abortController = new AbortController();
        const abortError = new InternalError("analysis aborted");
        const generateObject = jest
            .fn<GenerateObjectForTest>()
            .mockImplementation(async options => {
                return await new Promise((_resolve, reject) => {
                    const signal = options.signal;

                    expect(signal).toBeDefined();

                    if (signal?.aborted) {
                        reject(signal.reason);
                        return;
                    }

                    signal?.addEventListener(
                        "abort",
                        () => {
                            reject(signal.reason);
                        },
                        {once: true},
                    );

                    abortController.abort(abortError);
                });
            });
        const context = createMetadataContextForTest({generateObject});

        const result = await processFileAnalysis(context as unknown as FileProcessorActionContext, {
            contentType: "image/png",
            fileId: "file1" as never,
            inputPathIfExists: inputPath,
            parentTemporaryDirectoryPath: "/tmp",
            signal: abortController.signal,
            spaceId: "space1" as never,
        });

        expect(generateObject).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ok: false, error: abortError});
    } finally {
        await fs.unlink(inputPath).catch(() => {});
    }
});

test("returns not ok when analysis has no tags", async () => {
    const errorMessage = "Expected file analysis to include at least one tag";
    const context = createMetadataContextForTest({
        generateObject: createGenerateObjectMock({
            object: {
                caption: "   ",
                description: "   ",
                tags: [],
            },
            text: "{}",
        }),
        getObject: createGetObjectMock(Readable.from(onePixelPng)),
    });

    const result = await processFileAnalysis(context as unknown as FileProcessorActionContext, {
        contentType: "image/png",
        fileId: "file1" as never,
        parentTemporaryDirectoryPath: "/tmp",
        spaceId: "space1" as never,
    });

    expect(result).toMatchObject({ok: false, error: {message: errorMessage}});
});

test("returns not ok when downloading the file fails", async () => {
    const error = new InternalError("download failed");
    const getObject = jest.fn<CloudflareR2ContextModule["GetObject"]>().mockRejectedValue(error);
    const context = createMetadataContextForTest({
        generateObject: createGenerateObjectMock({
            object: {
                caption: "unused",
                description: "unused",
                tags: ["unused"],
            },
            text: "{}",
        }),
        getObject,
    });

    const result = await processFileAnalysis(context as unknown as FileProcessorActionContext, {
        contentType: "image/png",
        fileId: "file1" as never,
        parentTemporaryDirectoryPath: "/tmp",
        spaceId: "space1" as never,
    });

    expect(result).toEqual({ok: false, error});
});

test("returns not ok when the downloaded body is not a readable stream", async () => {
    const getObject = jest
        .fn<CloudflareR2ContextModule["GetObject"]>()
        .mockResolvedValue({Body: {}} as GetObjectCommandOutput);
    const context = createMetadataContextForTest({
        generateObject: createGenerateObjectMock({
            object: {
                caption: "unused",
                description: "unused",
                tags: ["unused"],
            },
            text: "{}",
        }),
        getObject,
    });

    const result = await processFileAnalysis(context as unknown as FileProcessorActionContext, {
        contentType: "image/png",
        fileId: "file1" as never,
        parentTemporaryDirectoryPath: "/tmp",
        spaceId: "space1" as never,
    });

    expect(result.ok).toBe(false);
});

test("returns not ok when the LLM generation step fails", async () => {
    const llmError = new InternalError("llm failed");
    const context = createMetadataContextForTest({
        generateObject: jest.fn<GenerateObjectForTest>().mockRejectedValue(llmError),
        getObject: createGetObjectMock(Readable.from(onePixelPng)),
    });

    const result = await processFileAnalysis(context as unknown as FileProcessorActionContext, {
        contentType: "image/png",
        fileId: "file1" as never,
        parentTemporaryDirectoryPath: "/tmp",
        spaceId: "space1" as never,
    });

    expect(result).toEqual({ok: false, error: llmError});
});
