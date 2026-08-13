import {ECSClient, RunTaskCommand} from "@aws-sdk/client-ecs";
import {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    CreateMultipartUploadCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
    S3Client,
    UploadPartCommand,
} from "@aws-sdk/client-s3";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";

import {ImporterContextModuleBase} from "~/server/importer/importer_context_module_base.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {NotionImportId} from "~/shared/id/types/id_types.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {importerVolumeName} from "~/shared/importer/importer_volume.js";

/**
 * ECS configuration for spawning importer tasks.
 */
export type ImporterEcsConfig = {
    cluster: string;
    taskDefinition: string;
    subnets: Array<string>;
    securityGroups: Array<string>;
    /**
     * IAM role ARN that grants ECS permission to manage EBS volumes. Required for
     * attaching EBS volumes to tasks.
     */
    ebsVolumeRoleArn: string;
};

const bytesPerGiB = 1024 * 1024 * 1024;

/**
 * Based on the size of the zip file being uploaded, how much storage do we provide
 * on the volume?
 *
 * If the factor is 3, and our import zip is 10 GiB, we'll give the task 30GiB of
 * storage. for the zip + unzipped content.
 */
const importerTaskVolumeFactor = 3;

/**
 * Production importer context module that uses AWS S3 for file storage and spawns
 * ECS tasks for import processing.
 *
 * ## S3 Bucket Setup
 *
 * The bucket is created by the CDK stack in
 * `admin/aws/internal/aws_import_uploads.ts`. It has:
 *
 * - 7-day lifecycle rule for automatic cleanup
 * - CORS configured for browser uploads
 * - SSL enforcement
 *
 * ## IAM Permissions
 *
 * - App service needs `s3:PutObject` for creating presigned upload URLs
 * - App service needs `ecs:RunTask` for spawning import tasks
 *
 * These permissions are granted in `admin/aws/internal/aws_app_service.ts`.
 *
 * ## Import Processing
 *
 * In production, imports are processed by spawning an ECS Fargate task. The task
 * runs the importer service binary with environment variable overrides to specify
 * which import to process.
 */

export class ImporterContextModule extends ImporterContextModuleBase {
    private readonly _s3Client: S3Client;
    private readonly _bucketName: string;
    private readonly _ecsClient: ECSClient;
    private readonly _ecsConfig: ImporterEcsConfig;

    constructor({
        s3Client,
        bucketName,
        ecsClient,
        ecsConfig,
    }: {
        s3Client: S3Client;
        bucketName: string;
        ecsClient: ECSClient;
        ecsConfig: ImporterEcsConfig;
    }) {
        super();
        this._s3Client = s3Client;
        this._bucketName = bucketName;
        this._ecsConfig = ecsConfig;
        this._ecsClient = ecsClient;
    }

    async createMultipartUpload({
        importKey,
        contentType,
        contentLength,
    }: {
        importKey: string;
        contentType: string;
        contentLength: number;
    }): Promise<{uploadId: string; importKey: string}> {
        return await this._context.tracer.withSpan("Create multipart upload", async (_, span) => {
            span.addData({file: {contentType, contentLength}});

            const result = await this._s3Client.send(
                new CreateMultipartUploadCommand({
                    Bucket: this._bucketName,
                    Key: importKey,
                    ContentType: contentType,
                }),
            );

            return {
                uploadId: assertExists(result.UploadId),
                importKey,
            };
        });
    }

    async createPresignedPartUploadUrls({
        importKey,
        uploadId,
        partCount,
    }: {
        importKey: string;
        uploadId: string;
        partCount: number;
    }): Promise<Array<{partNumber: number; presignedUrl: string}>> {
        return await this._context.tracer.withSpan(
            "Create presigned part upload URLs",
            async () => {
                const partNumbers = Array.from({length: partCount}, (_, i) => i + 1);

                return await runAllPromises(
                    partNumbers.map(async partNumber => {
                        const presignedUrl = await getSignedUrl(
                            this._s3Client,
                            new UploadPartCommand({
                                Bucket: this._bucketName,
                                Key: importKey,
                                UploadId: uploadId,
                                PartNumber: partNumber,
                            }),
                            {expiresIn: 24 * 60 * 60},
                        );

                        return {partNumber, presignedUrl};
                    }),
                );
            },
        );
    }

    async completeMultipartUpload({
        importKey,
        uploadId,
        parts,
    }: {
        importKey: string;
        uploadId: string;
        parts: ReadonlyArray<{partNumber: number; etag: string}>;
    }): Promise<void> {
        await this._context.tracer.withSpan("Complete multipart upload", async () => {
            await this._s3Client.send(
                new CompleteMultipartUploadCommand({
                    Bucket: this._bucketName,
                    Key: importKey,
                    UploadId: uploadId,
                    MultipartUpload: {
                        Parts: parts.map(p => ({
                            PartNumber: p.partNumber,
                            ETag: p.etag,
                        })),
                    },
                }),
            );
        });
    }

    async abortMultipartUpload({
        importKey,
        uploadId,
    }: {
        importKey: string;
        uploadId: string;
    }): Promise<void> {
        await this._context.tracer.withSpan("Abort multipart upload", async () => {
            await this._s3Client.send(
                new AbortMultipartUploadCommand({
                    Bucket: this._bucketName,
                    Key: importKey,
                    UploadId: uploadId,
                }),
            );
        });
    }

    async hasUploadedFile(importKey: string): Promise<boolean> {
        return await this._context.tracer.withSpan("Check uploaded file exists", async () => {
            try {
                await this._s3Client.send(
                    new HeadObjectCommand({Bucket: this._bucketName, Key: importKey}),
                );
                return true;
            } catch {
                return false;
            }
        });
    }

    async deleteUploadedFile(importKey: string): Promise<void> {
        await this._context.tracer.withSpan("Delete uploaded file", async () => {
            await this._s3Client.send(
                new DeleteObjectCommand({Bucket: this._bucketName, Key: importKey}),
            );
        });
    }

    async startValidateNotionImport(options: {
        spaceId: SpaceId;
        notionImportId: NotionImportId;
        importZipSize: number;
    }): Promise<void> {
        await this._context.tracer.withSpan("Start validate notion import", async () => {
            await this._runImporterTask({
                action: "ValidateNotionImport",
                spaceId: options.spaceId,
                notionImportId: options.notionImportId,
                importZipSize: options.importZipSize,
            });
        });
    }

    async startNotionImport(options: {
        spaceId: SpaceId;
        notionImportId: NotionImportId;
        importZipSize: number;
    }): Promise<void> {
        await this._context.tracer.withSpan("Start notion import", async () => {
            await this._runImporterTask({
                action: "StartNotionImport",
                spaceId: options.spaceId,
                notionImportId: options.notionImportId,
                importZipSize: options.importZipSize,
            });
        });
    }

    /**
     * Spawns an ECS Fargate task to run an import operation.
     *
     * The task is started asynchronously - this method returns after the task is
     * launched, not after it completes. The task updates the import status in DynamoDB
     * as it progresses.
     *
     * An EBS volume is attached at 3x the import zip size to accommodate:
     *
     * - The downloaded zip file
     * - Extracted contents
     * - Working files during processing
     *
     * The volume is automatically deleted when the task terminates.
     */
    private async _runImporterTask(params: {
        action: "ValidateNotionImport" | "StartNotionImport";
        spaceId: SpaceId;
        notionImportId: NotionImportId;
        importZipSize: number;
    }): Promise<void> {
        await this._context.tracer.withSpan("Run importer task", async (_, span) => {
            span.addData({
                importer: {type: "Notion"},
                common: {contentLength: params.importZipSize},
            });

            // Calculate EBS volume size: 3x zip size, converted to GiB, rounded up. Minimum 1
            // GiB for EBS volumes.
            const requiredGiB = Math.ceil(
                (params.importZipSize * importerTaskVolumeFactor) / bytesPerGiB,
            );
            const volumeSizeGiB = Math.max(1, requiredGiB);

            await this._ecsClient.send(
                new RunTaskCommand({
                    cluster: this._ecsConfig.cluster,
                    taskDefinition: this._ecsConfig.taskDefinition,
                    launchType: "FARGATE",
                    networkConfiguration: {
                        awsvpcConfiguration: {
                            subnets: this._ecsConfig.subnets,
                            securityGroups: this._ecsConfig.securityGroups,
                            assignPublicIp: "ENABLED",
                        },
                    },
                    volumeConfigurations: [
                        {
                            name: importerVolumeName,
                            managedEBSVolume: {
                                sizeInGiB: volumeSizeGiB,
                                volumeType: "gp3",
                                roleArn: this._ecsConfig.ebsVolumeRoleArn,
                                filesystemType: "ext4",
                                terminationPolicy: {
                                    deleteOnTermination: true,
                                },
                            },
                        },
                    ],
                    overrides: {
                        containerOverrides: [
                            {
                                name: "Container",
                                environment: [
                                    {name: "IMPORTER_ACTION", value: params.action},
                                    {name: "SPACE_ID", value: params.spaceId},
                                    {
                                        name: "NOTION_IMPORT_ID",
                                        value: params.notionImportId,
                                    },
                                ],
                            },
                        ],
                    },
                }),
            );
        });
    }

    fork(): ImporterContextModule {
        return new ImporterContextModule({
            s3Client: this._s3Client,
            bucketName: this._bucketName,
            ecsClient: this._ecsClient,
            ecsConfig: this._ecsConfig,
        });
    }
}
