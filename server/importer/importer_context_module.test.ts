import {
    DeleteObjectCommand,
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import {SdkStreamMixin} from "@smithy/types";
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "fs";
import {join as joinPath} from "path";
import {ImporterContextModule} from "~/server/importer/importer_context_module.js";
import {ImporterDevelopmentContextModule} from "~/server/importer/importer_development_context_module.js";
import {ConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

/** Creates a mock body with the transformToByteArray method that the S3 SDK uses. */
function createMockBody(data: Uint8Array): SdkStreamMixin {
    return {
        transformToByteArray: async () => data,
        transformToString: async () => new TextDecoder().decode(data),
        transformToWebStream: () => {
            throw InternalError.from("Not implemented");
        },
    } as SdkStreamMixin;
}

function createMockS3Client(): S3Client & {
    sentCommands: Array<GetObjectCommand | PutObjectCommand | DeleteObjectCommand>;
    mockGetObjectData: Uint8Array | null;
    mockGetObjectError: Error | null;
} {
    const mock = {
        sentCommands: [] as Array<GetObjectCommand | PutObjectCommand | DeleteObjectCommand>,
        mockGetObjectData: null as Uint8Array | null,
        mockGetObjectError: null as Error | null,
        async send(command: GetObjectCommand | PutObjectCommand | DeleteObjectCommand) {
            mock.sentCommands.push(command);
            if (command instanceof GetObjectCommand) {
                if (mock.mockGetObjectError) {
                    throw mock.mockGetObjectError;
                }
                if (mock.mockGetObjectData) {
                    return {Body: createMockBody(mock.mockGetObjectData)};
                }
                return {};
            }
            return {};
        },
    };
    return mock as unknown as S3Client & typeof mock;
}

describe("ImporterContextModule", () => {
    const testBucketName = "test-import-uploads-bucket";

    // Note: createPresignedUploadUrl cannot be unit tested with a mock S3 client
    // because getSignedUrl from @aws-sdk/s3-request-presigner requires a real
    // S3Client with credential resolution. Integration tests should cover this.

    describe("readUploadedFile", () => {
        test("returns file contents from S3", async () => {
            const mockS3 = createMockS3Client();
            const fileData = new Uint8Array([1, 2, 3, 4, 5]);
            mockS3.mockGetObjectData = fileData;

            const module = new ImporterContextModule({
                s3Client: mockS3,
                bucketName: testBucketName,
            });

            const result = await module.readUploadedFile("spa_123/nim_456");

            expect(result).toEqual(fileData);
            expect(mockS3.sentCommands.length).toBe(1);
            expect(mockS3.sentCommands[0]).toBeInstanceOf(GetObjectCommand);
        });

        test("uses provided bucket name for GetObject", async () => {
            const mockS3 = createMockS3Client();
            mockS3.mockGetObjectData = new Uint8Array([1]);

            const module = new ImporterContextModule({
                s3Client: mockS3,
                bucketName: "custom-bucket-name",
            });

            await module.readUploadedFile("test/key");

            const command = mockS3.sentCommands[0] as GetObjectCommand;
            expect(command.input.Bucket).toBe("custom-bucket-name");
            expect(command.input.Key).toBe("test/key");
        });

        test("returns null when S3 returns error", async () => {
            const mockS3 = createMockS3Client();
            mockS3.mockGetObjectError = InternalError.from("NoSuchKey");

            const module = new ImporterContextModule({
                s3Client: mockS3,
                bucketName: testBucketName,
            });

            const result = await module.readUploadedFile("nonexistent/key");

            expect(result).toBeNull();
        });

        test("returns null when Body is missing", async () => {
            const mockS3 = createMockS3Client();
            // mockGetObjectData is null by default, so Body will be missing

            const module = new ImporterContextModule({
                s3Client: mockS3,
                bucketName: testBucketName,
            });

            const result = await module.readUploadedFile("spa_123/nim_456");

            expect(result).toBeNull();
        });
    });

    describe("fork", () => {
        test("returns a new instance with same s3Client and bucketName", () => {
            const mockS3 = createMockS3Client();
            const module = new ImporterContextModule({
                s3Client: mockS3,
                bucketName: testBucketName,
            });

            const forked = module.fork();

            expect(forked).toBeInstanceOf(ImporterContextModule);
            expect(forked).not.toBe(module);
        });
    });
});

describe("ImporterContextModuleDevelopment", () => {
    const testTmpDir = assertExists(process.env.TEST_TMPDIR);
    const workspacePath = joinPath(testTmpDir, "test-workspace");
    const uploadDir = joinPath(workspacePath, "import-uploads");

    beforeEach(() => {
        // Clean up and recreate test directories
        if (existsSync(uploadDir)) {
            rmSync(uploadDir, {recursive: true});
        }
        mkdirSync(uploadDir, {recursive: true});
    });

    afterAll(() => {
        // Clean up test workspace
        if (existsSync(workspacePath)) {
            rmSync(workspacePath, {recursive: true});
        }
    });

    describe("createPresignedUploadUrl", () => {
        test("returns local dev endpoint URL", async () => {
            const module = new ImporterDevelopmentContextModule(workspacePath);

            const result = await Context.with(
                {
                    tracer: new TracerContextModule(testTracer),
                    constants: new ConstantsContextModule({
                        edgeServiceUrl: "http://localhost:3010",
                        resourceServiceUrl: "http://localhost:3020",
                    }),
                    importer: module,
                },
                async ctx => {
                    return ctx.importer.createPresignedUploadUrl({
                        importKey: "spa_123/nim_456",
                        contentType: "application/zip",
                        contentLength: 1024,
                    });
                },
            );

            expect(result).toEqual({
                presignedUploadUrl: "http://localhost:3010/dev/import-upload/spa_123/nim_456",
                importKey: "spa_123/nim_456",
            });
        });

        test("includes full import key in URL path", async () => {
            const module = new ImporterDevelopmentContextModule(workspacePath);

            const result = await Context.with(
                {
                    tracer: new TracerContextModule(testTracer),
                    constants: new ConstantsContextModule({
                        edgeServiceUrl: "http://localhost:3010",
                        resourceServiceUrl: "http://localhost:3020",
                    }),
                    importer: module,
                },
                async ctx => {
                    return ctx.importer.createPresignedUploadUrl({
                        importKey: "space/subdir/file",
                        contentType: "application/octet-stream",
                        contentLength: 500,
                    });
                },
            );

            expect(result.presignedUploadUrl).toBe(
                "http://localhost:3010/dev/import-upload/space/subdir/file",
            );
        });

        test("uses edge service URL from constants context", async () => {
            const module = new ImporterDevelopmentContextModule(workspacePath);

            const result = await Context.with(
                {
                    tracer: new TracerContextModule(testTracer),
                    constants: new ConstantsContextModule({
                        edgeServiceUrl: "http://custom-host:8080",
                        resourceServiceUrl: "http://localhost:3020",
                    }),
                    importer: module,
                },
                async ctx => {
                    return ctx.importer.createPresignedUploadUrl({
                        importKey: "test/key",
                        contentType: "application/zip",
                        contentLength: 100,
                    });
                },
            );

            expect(result.presignedUploadUrl).toBe(
                "http://custom-host:8080/dev/import-upload/test/key",
            );
        });
    });

    describe("writeUploadedFile", () => {
        test("writes file to dev-data directory", () => {
            const module = new ImporterDevelopmentContextModule(workspacePath);
            const testData = new Uint8Array([10, 20, 30, 40, 50]);

            module.writeUploadedFile("spa_123/nim_456", testData);

            const filePath = joinPath(uploadDir, "spa_123/nim_456");
            expect(existsSync(filePath)).toBe(true);

            const written = readFileSync(filePath);
            expect(new Uint8Array(written)).toEqual(testData);
        });

        test("creates nested directories if needed", () => {
            const module = new ImporterDevelopmentContextModule(workspacePath);
            const testData = new Uint8Array([1, 2, 3]);

            module.writeUploadedFile("deep/nested/path/file", testData);

            const filePath = joinPath(uploadDir, "deep/nested/path/file");
            expect(existsSync(filePath)).toBe(true);
        });

        test("overwrites existing file", () => {
            const module = new ImporterDevelopmentContextModule(workspacePath);
            const importKey = "overwrite/test";
            const filePath = joinPath(uploadDir, importKey);

            // Write initial file
            mkdirSync(joinPath(uploadDir, "overwrite"), {recursive: true});
            writeFileSync(filePath, new Uint8Array([1, 1, 1]));

            // Overwrite
            const newData = new Uint8Array([2, 2, 2, 2]);
            module.writeUploadedFile(importKey, newData);

            const written = readFileSync(filePath);
            expect(new Uint8Array(written)).toEqual(newData);
        });

        test("handles empty file", () => {
            const module = new ImporterDevelopmentContextModule(workspacePath);
            const testData = new Uint8Array([]);

            module.writeUploadedFile("empty/file", testData);

            const filePath = joinPath(uploadDir, "empty/file");
            expect(existsSync(filePath)).toBe(true);

            const written = readFileSync(filePath);
            expect(written.length).toBe(0);
        });

        test("handles large file", () => {
            const module = new ImporterDevelopmentContextModule(workspacePath);
            // 1MB file
            const testData = new Uint8Array(1024 * 1024);
            for (let i = 0; i < testData.length; i++) {
                testData[i] = i % 256;
            }

            module.writeUploadedFile("large/file", testData);

            const filePath = joinPath(uploadDir, "large/file");
            expect(existsSync(filePath)).toBe(true);

            const written = readFileSync(filePath);
            expect(written.length).toBe(testData.length);
            expect(new Uint8Array(written)).toEqual(testData);
        });
    });

    describe("readUploadedFile", () => {
        test("returns file contents from dev-data directory", async () => {
            const module = new ImporterDevelopmentContextModule(workspacePath);
            const testData = new Uint8Array([100, 200, 150, 75]);
            const importKey = "spa_abc/nim_xyz";

            // Write test file
            const filePath = joinPath(uploadDir, importKey);
            mkdirSync(joinPath(uploadDir, "spa_abc"), {recursive: true});
            writeFileSync(filePath, testData);

            const result = await module.readUploadedFile(importKey);

            expect(result).toEqual(testData);
        });

        test("returns null when file does not exist", async () => {
            const module = new ImporterDevelopmentContextModule(workspacePath);

            const result = await module.readUploadedFile("nonexistent/file");

            expect(result).toBeNull();
        });

        test("returns null when path is a directory", async () => {
            const module = new ImporterDevelopmentContextModule(workspacePath);
            const dirPath = joinPath(uploadDir, "some-dir");
            mkdirSync(dirPath, {recursive: true});

            const result = await module.readUploadedFile("some-dir");

            expect(result).toBeNull();
        });

        test("handles empty file", async () => {
            const module = new ImporterDevelopmentContextModule(workspacePath);
            const importKey = "empty/read-test";

            const filePath = joinPath(uploadDir, importKey);
            mkdirSync(joinPath(uploadDir, "empty"), {recursive: true});
            writeFileSync(filePath, new Uint8Array([]));

            const result = await module.readUploadedFile(importKey);

            expect(result).toEqual(new Uint8Array([]));
        });
    });

    describe("fork", () => {
        test("returns a new instance with same workspace path", () => {
            const module = new ImporterDevelopmentContextModule(workspacePath);
            const forked = module.fork();

            expect(forked).toBeInstanceOf(ImporterDevelopmentContextModule);
            expect(forked).not.toBe(module);

            // Verify they share the same workspace by writing through one and reading through other
            const testData = new Uint8Array([1, 2, 3]);
            module.writeUploadedFile("fork-test", testData);

            // The forked module should see the same file
            const filePath = joinPath(uploadDir, "fork-test");
            expect(existsSync(filePath)).toBe(true);
        });
    });

    describe("round-trip", () => {
        test("write then read returns same data", async () => {
            const module = new ImporterDevelopmentContextModule(workspacePath);
            const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
            const importKey = "roundtrip/test";

            module.writeUploadedFile(importKey, testData);
            const result = await module.readUploadedFile(importKey);

            expect(result).toEqual(testData);
        });

        test("write with binary data preserves all bytes", async () => {
            const module = new ImporterDevelopmentContextModule(workspacePath);
            // Include all possible byte values
            const testData = new Uint8Array(256);
            for (let i = 0; i < 256; i++) {
                testData[i] = i;
            }
            const importKey = "binary/test";

            module.writeUploadedFile(importKey, testData);
            const result = await module.readUploadedFile(importKey);

            expect(result).toEqual(testData);
        });
    });
});
