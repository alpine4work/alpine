import {ECSClient, RunTaskCommand} from "@aws-sdk/client-ecs";
import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";
import {
    ImporterContextModuleBase,
    PresignedUploadUrlResult,
} from "~/server/importer/importer_context_module_base.js";
import {NotionImportId, SpaceId} from "~/shared/id/types/id_types.js";
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

    async createPresignedUploadUrl({
        importKey,
        contentType,
        contentLength,
    }: {
        importKey: string;
        contentType: string;
        contentLength: number;
    }): Promise<PresignedUploadUrlResult> {
        const presignedUploadUrl = await getSignedUrl(
            this._s3Client,
            new PutObjectCommand({
                Bucket: this._bucketName,
                Key: importKey,
                ContentType: contentType,
                ContentLength: contentLength,
            }),
            {expiresIn: 24 * 60 * 60},
        );

        return {presignedUploadUrl, importKey};
    }

    async hasUploadedFile(importKey: string): Promise<boolean> {
        try {
            await this._s3Client.send(
                new HeadObjectCommand({Bucket: this._bucketName, Key: importKey}),
            );
            return true;
        } catch {
            return false;
        }
    }

    // TODO: Stream this file to disk before reading it
    // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/75j9w76k2chdpbnv04pa4sg8qw
    async readUploadedFile(importKey: string): Promise<Uint8Array | null> {
        const getObjectResult = await this._s3Client
            .send(new GetObjectCommand({Bucket: this._bucketName, Key: importKey}))
            .catch(() => null);

        if (!getObjectResult?.Body) {
            return null;
        }

        return getObjectResult.Body.transformToByteArray();
    }

    async deleteUploadedFile(importKey: string): Promise<void> {
        await this._s3Client.send(
            new DeleteObjectCommand({Bucket: this._bucketName, Key: importKey}),
        );
    }

    async startValidateNotionImport(options: {
        spaceId: SpaceId;
        notionImportId: NotionImportId;
        importZipSize: number;
    }): Promise<void> {
        await this._runImporterTask({
            action: "ValidateNotionImport",
            spaceId: options.spaceId,
            notionImportId: options.notionImportId,
            importZipSize: options.importZipSize,
        });
    }

    async startNotionImport(options: {
        spaceId: SpaceId;
        notionImportId: NotionImportId;
        importZipSize: number;
    }): Promise<void> {
        await this._runImporterTask({
            action: "StartNotionImport",
            spaceId: options.spaceId,
            notionImportId: options.notionImportId,
            importZipSize: options.importZipSize,
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
                                {name: "NOTION_IMPORT_ID", value: params.notionImportId},
                            ],
                        },
                    ],
                },
            }),
        );
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
