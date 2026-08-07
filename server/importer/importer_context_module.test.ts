import {ECSClient, RunTaskCommand} from "@aws-sdk/client-ecs";
import {
    DeleteObjectCommand,
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import {SdkStreamMixin} from "@smithy/types";
import {existsSync, mkdirSync, readFileSync, rmSync} from "fs";
import {join as joinPath} from "path";
import {ImporterDevelopmentContextModule} from "~/server/importer/development/importer_development_context_module.js";
import {ImporterContextModule} from "~/server/importer/importer_context_module.js";
import {ConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {NotionImportId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

/**
 * Creates no-op dev module options for testing ImporterDevelopmentContextModule
 */
function createNoOpDevModuleOptions() {
    return {
        getProcessContext: () => {
            throw new InternalError("Not expected to be called in this test");
        },
        escalateToImporterServiceContext: () => {
            throw new InternalError("Not expected to be called in this test");
        },
    } as {
        getProcessContext: () => never;
        escalateToImporterServiceContext: () => never;
    };
}

/** Creates a mock ECS config for testing ImporterContextModule */
function createMockEcsConfig() {
    return {
        cluster: "test-cluster",
        taskDefinition: "test-task-definition",
        subnets: ["subnet-123"],
        securityGroups: ["sg-456"],
        ebsVolumeRoleArn: "arn:aws:iam::123456789012:role/test-ebs-role",
    };
}

/**
 * Creates a mock body with the transformToByteArray method that the S3 SDK uses.
 */
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

type MockEcsClient = ECSClient & {
    sentCommands: Array<RunTaskCommand>;
};

function createMockEcsClient(): MockEcsClient {
    const mock = {
        sentCommands: [] as Array<RunTaskCommand>,
        async send(command: RunTaskCommand) {
            mock.sentCommands.push(command);
            return {tasks: [{taskArn: "arn:aws:ecs:us-east-1:123456789012:task/test-task"}]};
        },
    };
    return mock as unknown as MockEcsClient;
}

/**
 * Creates an `ImporterContextModule` with mock S3/ECS clients, bound to a context
 * with a test tracer. Returns the mocks and a `run` function that executes an
 * action within the bound context.
 */
function createTestImporterModule({bucketName}: {bucketName?: string} = {}) {
    const mockS3 = createMockS3Client();
    const mockEcs = createMockEcsClient();
    const module = new ImporterContextModule({
        s3Client: mockS3,
        bucketName: bucketName ?? "test-import-uploads-bucket",
        ecsClient: mockEcs,
        ecsConfig: createMockEcsConfig(),
    });

    return {
        mockS3,
        mockEcs,
        module,
        run: <T>(action: (importer: ImporterContextModule) => Promise<T>) =>
            Context.with({tracer: new TracerContextModule(testTracer), importer: module}, ctx =>
                action(ctx.importer),
            ),
    };
}

describe("ImporterContextModule", () => {
    // Note: createMultipartUpload and createPresignedPartUploadUrls cannot be unit
    // tested with a mock S3 client because they require a real S3Client with
    // credential resolution. Integration tests should cover this.

    describe("fork", () => {
        test("returns a new instance with same s3Client and bucketName", () => {
            const {module} = createTestImporterModule();

            const forked = module.fork();

            expect(forked).toBeInstanceOf(ImporterContextModule);
            expect(forked).not.toBe(module);
        });
    });

    describe("ECS task volume sizing", () => {
        const bytesPerGiB = 1024 * 1024 * 1024;

        function getVolumeSizeFromCommand(command: RunTaskCommand): number {
            const volumeConfig = command.input.volumeConfigurations?.[0];
            return volumeConfig?.managedEBSVolume?.sizeInGiB ?? 0;
        }

        test("uses minimum 1 GiB volume for small files", async () => {
            const {mockEcs, run} = createTestImporterModule();

            await run(importer =>
                importer.startValidateNotionImport({
                    spaceId: "spa_test123" as SpaceId,
                    notionImportId: "nim_test456" as NotionImportId,
                    importZipSize: 1024, // 1 KB - very small
                }),
            );

            expect(mockEcs.sentCommands).toHaveLength(1);
            expect(getVolumeSizeFromCommand(mockEcs.sentCommands[0]!)).toBe(1);
        });

        test("uses minimum 1 GiB volume for files under 1/3 GiB", async () => {
            const {mockEcs, run} = createTestImporterModule();

            // 300 MB = 0.29 GiB, which at 3x = 0.88 GiB, rounds up to 1 GiB
            const importZipSize = 300 * 1024 * 1024;
            await run(importer =>
                importer.startNotionImport({
                    spaceId: "spa_test123" as SpaceId,
                    notionImportId: "nim_test456" as NotionImportId,
                    importZipSize,
                }),
            );

            expect(mockEcs.sentCommands).toHaveLength(1);
            expect(getVolumeSizeFromCommand(mockEcs.sentCommands[0]!)).toBe(1);
        });

        test("calculates 3x volume size for 1 GiB file", async () => {
            const {mockEcs, run} = createTestImporterModule();

            await run(importer =>
                importer.startValidateNotionImport({
                    spaceId: "spa_test123" as SpaceId,
                    notionImportId: "nim_test456" as NotionImportId,
                    importZipSize: bytesPerGiB, // 1 GiB
                }),
            );

            expect(mockEcs.sentCommands).toHaveLength(1);
            // 1 GiB \* 3 = 3 GiB
            expect(getVolumeSizeFromCommand(mockEcs.sentCommands[0]!)).toBe(3);
        });

        test("calculates 3x volume size for 10 GiB file", async () => {
            const {mockEcs, run} = createTestImporterModule();

            await run(importer =>
                importer.startNotionImport({
                    spaceId: "spa_test123" as SpaceId,
                    notionImportId: "nim_test456" as NotionImportId,
                    importZipSize: 10 * bytesPerGiB, // 10 GiB
                }),
            );

            expect(mockEcs.sentCommands).toHaveLength(1);
            // 10 GiB \* 3 = 30 GiB
            expect(getVolumeSizeFromCommand(mockEcs.sentCommands[0]!)).toBe(30);
        });

        test("rounds up partial GiB to next whole number", async () => {
            const {mockEcs, run} = createTestImporterModule();

            // 500 MB = 0.49 GiB, which at 3x = 1.46 GiB, should round up to 2 GiB
            const importZipSize = 500 * 1024 * 1024;
            await run(importer =>
                importer.startValidateNotionImport({
                    spaceId: "spa_test123" as SpaceId,
                    notionImportId: "nim_test456" as NotionImportId,
                    importZipSize,
                }),
            );

            expect(mockEcs.sentCommands).toHaveLength(1);
            expect(getVolumeSizeFromCommand(mockEcs.sentCommands[0]!)).toBe(2);
        });

        test("passes correct environment variables to ECS task", async () => {
            const {mockEcs, run} = createTestImporterModule();

            await run(importer =>
                importer.startValidateNotionImport({
                    spaceId: "spa_myspace" as SpaceId,
                    notionImportId: "nim_myimport" as NotionImportId,
                    importZipSize: 1024,
                }),
            );

            const command = mockEcs.sentCommands[0]!;
            const containerOverrides = command.input.overrides?.containerOverrides?.[0];
            const envVars = containerOverrides?.environment;

            expect(envVars).toEqual(
                expect.arrayContaining([
                    {name: "IMPORTER_ACTION", value: "ValidateNotionImport"},
                    {name: "SPACE_ID", value: "spa_myspace"},
                    {name: "NOTION_IMPORT_ID", value: "nim_myimport"},
                ]),
            );
        });

        test("uses correct ECS config values", async () => {
            const {mockEcs, run} = createTestImporterModule();

            await run(importer =>
                importer.startNotionImport({
                    spaceId: "spa_test" as SpaceId,
                    notionImportId: "nim_test" as NotionImportId,
                    importZipSize: 1024,
                }),
            );

            const command = mockEcs.sentCommands[0]!;
            expect(command.input.cluster).toBe("test-cluster");
            expect(command.input.taskDefinition).toBe("test-task-definition");
            expect(command.input.networkConfiguration?.awsvpcConfiguration?.subnets).toEqual([
                "subnet-123",
            ]);
            expect(command.input.networkConfiguration?.awsvpcConfiguration?.securityGroups).toEqual(
                ["sg-456"],
            );

            const volumeConfig = command.input.volumeConfigurations?.[0];
            expect(volumeConfig?.managedEBSVolume?.roleArn).toBe(
                "arn:aws:iam::123456789012:role/test-ebs-role",
            );
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

    describe("createMultipartUpload", () => {
        test("returns uploadId and importKey", async () => {
            const module = new ImporterDevelopmentContextModule({
                localUploadPath: workspacePath,
                ...createNoOpDevModuleOptions(),
            });

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
                    return ctx.importer.createMultipartUpload({
                        importKey: "spa_123/nim_456",
                        contentType: "application/zip",
                        contentLength: 1024,
                    });
                },
            );

            expect(result.importKey).toBe("spa_123/nim_456");
            expect(result.uploadId).toMatch(/^dev-multipart-/);
        });
    });

    describe("createPresignedPartUploadUrls", () => {
        test("returns correct number of part URLs", async () => {
            const module = new ImporterDevelopmentContextModule({
                localUploadPath: workspacePath,
                ...createNoOpDevModuleOptions(),
            });

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
                    return ctx.importer.createPresignedPartUploadUrls({
                        importKey: "spa_123/nim_456",
                        uploadId: "dev-multipart-123",
                        partCount: 3,
                    });
                },
            );

            expect(result).toHaveLength(3);
            expect(result[0]).toMatchObject({
                partNumber: 1,
                presignedUrl: "http://localhost:3010/dev/import-upload/spa_123/nim_456/part/1",
            });
            expect(result[2]).toMatchObject({
                partNumber: 3,
                presignedUrl: "http://localhost:3010/dev/import-upload/spa_123/nim_456/part/3",
            });
        });

        test("uses edge service URL from constants context", async () => {
            const module = new ImporterDevelopmentContextModule({
                localUploadPath: workspacePath,
                ...createNoOpDevModuleOptions(),
            });

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
                    return ctx.importer.createPresignedPartUploadUrls({
                        importKey: "test/key",
                        uploadId: "dev-multipart-123",
                        partCount: 1,
                    });
                },
            );

            expect(result[0]!.presignedUrl).toBe(
                "http://custom-host:8080/dev/import-upload/test/key/part/1",
            );
        });
    });

    describe("writePartFile", () => {
        test("writes part file to parts directory", async () => {
            const module = new ImporterDevelopmentContextModule({
                localUploadPath: workspacePath,
                ...createNoOpDevModuleOptions(),
            });
            const testData = new Uint8Array([10, 20, 30, 40, 50]);

            await module.writePartFile("spa_123/nim_456", 1, testData);

            const filePath = joinPath(uploadDir, "spa_123/nim_456.parts/1");
            expect(existsSync(filePath)).toBe(true);

            const written = readFileSync(filePath);
            expect(new Uint8Array(written)).toEqual(testData);
        });

        test("writes multiple parts", async () => {
            const module = new ImporterDevelopmentContextModule({
                localUploadPath: workspacePath,
                ...createNoOpDevModuleOptions(),
            });
            const part1 = new Uint8Array([1, 2, 3]);
            const part2 = new Uint8Array([4, 5, 6]);

            await module.writePartFile("multi/parts", 1, part1);
            await module.writePartFile("multi/parts", 2, part2);

            expect(existsSync(joinPath(uploadDir, "multi/parts.parts/1"))).toBe(true);
            expect(existsSync(joinPath(uploadDir, "multi/parts.parts/2"))).toBe(true);

            const written1 = readFileSync(joinPath(uploadDir, "multi/parts.parts/1"));
            const written2 = readFileSync(joinPath(uploadDir, "multi/parts.parts/2"));
            expect(new Uint8Array(written1)).toEqual(part1);
            expect(new Uint8Array(written2)).toEqual(part2);
        });
    });

    describe("fork", () => {
        test("returns a new instance with same workspace path", async () => {
            const module = new ImporterDevelopmentContextModule({
                localUploadPath: workspacePath,
                ...createNoOpDevModuleOptions(),
            });
            const forked = module.fork();

            expect(forked).toBeInstanceOf(ImporterDevelopmentContextModule);
            expect(forked).not.toBe(module);

            // Verify they share the same workspace by writing a part through one
            const testData = new Uint8Array([1, 2, 3]);
            await module.writePartFile("fork-test", 1, testData);

            // The forked module should see the same file
            const filePath = joinPath(uploadDir, "fork-test.parts/1");
            expect(existsSync(filePath)).toBe(true);
        });
    });
});
