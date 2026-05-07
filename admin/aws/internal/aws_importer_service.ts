import {ArnFormat, Stack} from "aws-cdk-lib";
import {SecurityGroup, SubnetType, Vpc} from "aws-cdk-lib/aws-ec2";
import {
    ContainerImage,
    CpuArchitecture,
    Secret as EcsSecret,
    FargateTaskDefinition,
    OperatingSystemFamily,
} from "aws-cdk-lib/aws-ecs";
import {Effect, PolicyStatement, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {Secret} from "aws-cdk-lib/aws-secretsmanager";
import {Construct} from "constructs";
import {join as joinPath} from "path";
import {AwsDynamo} from "~/admin/aws/internal/aws_dynamo.js";
import {AwsEcsCluster} from "~/admin/aws/internal/aws_ecs_cluster.js";
import {AwsImportUploadsData} from "~/admin/aws/internal/aws_import_uploads_data.js";
import {AwsObservability} from "~/admin/aws/internal/aws_observability.js";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {AwsTaskRealtimeService} from "~/admin/aws/internal/aws_task_realtime_service.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {
    importerVolumeContainerPath,
    importerVolumeName,
} from "~/shared/importer/importer_volume.js";

/**
 * AWS infrastructure for the importer service which processes Notion imports (and
 * potentially other import types in the future).
 *
 * The importer service runs as Fargate tasks spawned on-demand by the app service
 * when a user uploads a file to import. Each import gets its own Fargate task with
 * an EBS volume attached for storage.
 *
 * ## Architecture
 *
 * 1. User uploads a zip file to S3 via presigned URL
 * 2. App service spawns a Fargate task using `RunTaskCommand`
 * 3. Task attaches an EBS volume sized based on the import file size
 * 4. Task processes the import and updates status in DynamoDB
 * 5. Task terminates and EBS volume is automatically deleted
 *
 * ## EBS Volume
 *
 * We use EBS volumes instead of Fargate ephemeral storage because:
 *
 * - Ephemeral storage is capped at 200 GiB
 * - EBS volumes can be much larger (up to 16 TiB)
 * - EBS volumes support better IOPS for large imports
 *
 * The `ebsVolumeRole` grants ECS permission to create and manage EBS volumes on
 * behalf of the task.
 */
export class AwsImporterService extends Construct {
    public readonly taskDefinition: FargateTaskDefinition;
    public readonly securityGroup: SecurityGroup;
    public readonly ebsVolumeRole: Role;

    /**
     * Returns the subnet IDs where importer tasks should run. Tasks run in public
     * subnets to avoid NAT gateway costs.
     */
    public readonly subnetIds: Array<string>;

    constructor(
        parentConstruct: Construct,
        {
            vpc,
            ecsCluster,
            cloudflareAccountId,
            dynamo,
            sqs,
            importUploads,
            observability,
            taskRealtimeService,
        }: {
            vpc: Vpc;
            ecsCluster: AwsEcsCluster;
            cloudflareAccountId: string;
            dynamo: AwsDynamo;
            sqs: AwsSqs;
            importUploads: AwsImportUploadsData;
            observability: AwsObservability;
            taskRealtimeService: AwsTaskRealtimeService;
        },
    ) {
        super(parentConstruct, "ImporterService");

        const stack = Stack.of(this);
        const secrets = Secret.fromSecretNameV2(this, "SecretsImport", "ImporterServiceSecrets");

        // Create an IAM role that ECS can assume to manage EBS volumes. This role is
        // passed to RunTaskCommand's volumeConfigurations.managedEBSVolume.roleArn.
        //
        // See:
        // https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ebs-volumes.html
        this.ebsVolumeRole = new Role(this, "EbsVolumeRole", {
            assumedBy: new ServicePrincipal("ecs.amazonaws.com"),
            description: "Allows ECS to manage EBS volumes for importer tasks",
        });

        // Grant ECS permission to create, attach, detach, and delete EBS volumes.
        this.ebsVolumeRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    // Volume lifecycle
                    "ec2:CreateVolume",
                    "ec2:DeleteVolume",
                    "ec2:AttachVolume",
                    "ec2:DetachVolume",
                    // Required for volume management
                    "ec2:DescribeVolumes",
                    "ec2:DescribeVolumeStatus",
                    "ec2:DescribeAvailabilityZones",
                ],
                resources: ["*"],
            }),
        );

        // Grant ECS permission to create tags on volumes (required for tracking).
        this.ebsVolumeRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["ec2:CreateTags"],
                resources: [
                    stack.formatArn({
                        service: "ec2",
                        resource: "volume",
                        resourceName: "*",
                        arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
                    }),
                ],
                conditions: {
                    StringEquals: {
                        "ec2:CreateAction": "CreateVolume",
                    },
                },
            }),
        );

        // Create the Fargate task definition.
        this.taskDefinition = new FargateTaskDefinition(this, "TaskDefinition", {
            runtimePlatform: {
                operatingSystemFamily: OperatingSystemFamily.LINUX,
                cpuArchitecture: CpuArchitecture.ARM64,
            },

            // We need beefy resources here. Unlike FileProcessorService, we may be operating
            // on many files at once during an import (e.g., a large Notion workspace). This
            // config handles data-intensive parallel processing.
            //
            // As of February 19, 2026: vCPU: $0.000011244 per cpu per second Memory:
            // $0.000001235 per gb per second

            // For an hour run, 4 vCPU is ~$0.16, 30gb of memory is ~$0.13. If we have a
            // (guessing) P50 of 10 minutes, that's roughly ~$0.05 per import.
            //
            // TODO(imjoshin): Instrument actual import durations and revisit this config. We
            // should ensure we're fully utilizing these resources—if imports are CPU-bound,
            // we're good; if they're I/O-bound waiting on network or EBS, we may be
            // overpaying. Consider profiling with smaller instance sizes.
            cpu: 4096, // 4 vCPU
            memoryLimitMiB: 30720, // max for 4 vCPU

            // Add a volume that will be configured at runtime with managed EBS. The actual
            // volume is created by RunTaskCommand's volumeConfigurations. configuredAtLaunch
            // tells ECS the volume config is provided at runtime.
            volumes: [
                {
                    name: importerVolumeName,
                    configuredAtLaunch: true,
                },
            ],
        });

        const container = this.taskDefinition.addContainer("Container", {
            image: ContainerImage.fromTarball(
                joinPath(
                    runfilesPath,
                    process.env.CDK_LITE === "true"
                        ? "cyberworlds/admin/aws/empty_image_tarball_load/tarball.tar"
                        : "cyberworlds/server/importer/importer_service/importer_image_tarball_load/tarball.tar",
                ),
            ),
            // Send logs to AWS. Container logs are short-lived and used for debugging obscure
            // machine-level issues. Our long-lived logs are in Honeycomb.
            logging: ecsCluster.shortLivedLogDriver,
            // For security, use the `www-data` user which exists on our Linux image. It only
            // has read access and execute access to files on our system.
            user: "www-data",
            secrets: {
                // Token agent keys for service-to-service authentication
                APP_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "appServicePublicKey",
                ),
                EDGE_SERVICE_FAMILY_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "edgeServiceFamilyPublicKey",
                ),
                TASK_REALTIME_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "taskRealtimeServicePublicKey",
                ),
                JOB_QUEUE_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "jobQueueServicePublicKey",
                ),
                FILE_PROCESSOR_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "fileProcessorServicePublicKey",
                ),
                API_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "apiServicePublicKey",
                ),
                RESOURCE_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "resourceServicePublicKey",
                ),
                IMPORTER_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "importerServicePublicKey",
                ),
                IMPORTER_SERVICE_PRIVATE_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "importerServicePrivateKey",
                ),
                TOKEN_AGENT_SECRET: EcsSecret.fromSecretsManager(secrets, "tokenAgentSecret"),
                // Cloudflare R2 credentials for file storage
                CLOUDFLARE_R2_ACCESS_KEY_ID: EcsSecret.fromSecretsManager(
                    secrets,
                    "cloudflareR2AccessKeyId",
                ),
                CLOUDFLARE_R2_SECRET_ACCESS_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "cloudflareR2SecretAccessKey",
                ),
                // Observability
                HONEYCOMB_API_KEY: EcsSecret.fromSecretsManager(secrets, "honeycombApiKey"),
            },
            environment: {
                NODE_ENV: "production",
                AWS_REGION: stack.region,
            },
            command: [
                // NOTE(calebmer): We're not using a shell (e.g. `sh -c`) here because it breaks
                // ECS process termination. The `SIGTERM` signal is sent to the shell (e.g.
                // `sh -c`) not our process.
                //
                // `runService()` implements env variable substitution which is why we can use env
                // variable syntax like `$HONEYCOMB_API_KEY`.
                "/var/www/server/importer/importer_service/importer_binary",
                // Service URLs
                "--edgeServiceUrl=https://alpine.inc",
                "--resourceServiceUrl=https://resources.alpine.inc",
                // Cloudflare R2 for file storage
                `--cloudflareAccountId=${cloudflareAccountId}`,
                "--cloudflareR2AccessKeyId=$CLOUDFLARE_R2_ACCESS_KEY_ID",
                "--cloudflareR2SecretAccessKey=$CLOUDFLARE_R2_SECRET_ACCESS_KEY",
                // Token agent for service-to-service authentication
                "--appServicePublicKey=$APP_SERVICE_PUBLIC_KEY",
                "--edgeServiceFamilyPublicKey=$EDGE_SERVICE_FAMILY_PUBLIC_KEY",
                "--taskRealtimeServicePublicKey=$TASK_REALTIME_SERVICE_PUBLIC_KEY",
                "--jobQueueServicePublicKey=$JOB_QUEUE_SERVICE_PUBLIC_KEY",
                "--fileProcessorServicePublicKey=$FILE_PROCESSOR_SERVICE_PUBLIC_KEY",
                "--apiServicePublicKey=$API_SERVICE_PUBLIC_KEY",
                "--resourceServicePublicKey=$RESOURCE_SERVICE_PUBLIC_KEY",
                "--importerServicePublicKey=$IMPORTER_SERVICE_PUBLIC_KEY",
                "--servicePrivateKey=$IMPORTER_SERVICE_PRIVATE_KEY",
                "--tokenAgentSecret=$TOKEN_AGENT_SECRET",
                // Observability
                "--honeycombApiKey=$HONEYCOMB_API_KEY",
                `--kinesisTracerStreamName=${observability.tracerEventStreamName}`,
                // Import data
                `--importUploadsBucketName=${importUploads.bucketName}`,
                // Job queues (for sending file processing jobs if needed)
                `--jobQueueUrl=${sqs.getJobQueueUrl()}`,
                `--fileProcessorJobQueueUrl=${sqs.getFileProcessorJobQueueUrl()}`,
                `--fileProcessorHeavyJobQueueUrl=${sqs.getFileProcessorHeavyJobQueueUrl()}`,
                `--fileProcessorLightJobQueueUrl=${sqs.getFileProcessorLightJobQueueUrl()}`,
                // These environment variables are provided at runtime via containerOverrides in
                // the RunTaskCommand.
                "--importerAction=$IMPORTER_ACTION",
                "--spaceId=$SPACE_ID",
                "--notionImportId=$NOTION_IMPORT_ID",
                `--ecsCluster=${ecsCluster.cluster.clusterName}`,
                `--taskRealtimeServiceEcsTaskDefinitionFamily=${taskRealtimeService.taskDefinition.family}`,
                `--taskRealtimeServiceSecurityGroupId=${taskRealtimeService.securityGroup.securityGroupId}`,
            ],
        });

        // Mount the EBS volume for storing downloaded and unzipped import files. The
        // volume is created at runtime by RunTaskCommand's volumeConfigurations and
        // mounted here at /data/import.
        container.addMountPoints({
            sourceVolume: importerVolumeName,
            containerPath: importerVolumeContainerPath,
            readOnly: false,
        });

        // Grant permissions to the task role.
        dynamo.grantReadWriteData(this.taskDefinition.taskRole);
        importUploads.grantRead(this.taskDefinition.taskRole);
        observability.grantPutToTracerEventStream(this.taskDefinition.taskRole);
        sqs.grantSendJobQueueMessages(this.taskDefinition.taskRole);

        // Create a security group for importer tasks. This security group's ID must be
        // explicitly provided to the ECS RunTask action.
        this.securityGroup = new SecurityGroup(this, "InstanceSecurityGroup", {
            vpc,
            allowAllOutbound: true,
        });

        // Get subnet IDs for public subnets (to avoid NAT gateway costs).
        this.subnetIds = vpc.selectSubnets({subnetType: SubnetType.PUBLIC}).subnetIds;
    }
}
