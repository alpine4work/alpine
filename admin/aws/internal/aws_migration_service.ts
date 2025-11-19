import {SecurityGroup} from "aws-cdk-lib/aws-ec2";
import {
    ContainerImage,
    CpuArchitecture,
    Secret as EcsSecret,
    FargateTaskDefinition,
    OperatingSystemFamily,
} from "aws-cdk-lib/aws-ecs";
import {Secret} from "aws-cdk-lib/aws-secretsmanager";
import {Construct} from "constructs";
import {join as joinPath} from "path";
import {AwsDynamo} from "~/admin/aws/internal/aws_dynamo.js";
import {AwsEcsCluster} from "~/admin/aws/internal/aws_ecs_cluster.js";
import {AwsOpensearch} from "~/admin/aws/internal/aws_opensearch.js";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {AwsVpc} from "~/admin/aws/internal/aws_vpc.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";

export class AwsMigrationService extends Construct {
    constructor(
        parentConstruct: Construct,
        {
            vpc,
            ecsCluster,
            dynamo,
            opensearch,
            sqs,
        }: {
            vpc: AwsVpc;
            ecsCluster: AwsEcsCluster;
            dynamo: AwsDynamo;
            opensearch: AwsOpensearch;
            sqs: AwsSqs;
        },
    ) {
        super(parentConstruct, "MigrationService");

        const secrets = Secret.fromSecretNameV2(this, "SecretsImport", "MigrationServiceSecrets");

        const taskDefinition = new FargateTaskDefinition(this, "TaskDefinition", {
            runtimePlatform: {
                operatingSystemFamily: OperatingSystemFamily.LINUX,
                cpuArchitecture: CpuArchitecture.ARM64,
            },
            // Smallest CPU and memory. Migration service isn't doing much work itself.
            cpu: 256,
            memoryLimitMiB: 512,
        });

        taskDefinition.addContainer("Container", {
            image: ContainerImage.fromTarball(
                joinPath(
                    runfilesPath,
                    process.env.CDK_LITE === "true"
                        ? "cyberworlds/admin/aws/empty_image_tarball_load/tarball.tar"
                        : "cyberworlds/server/migration/migration_image_tarball_load/tarball.tar",
                ),
            ),
            // Send logs to AWS. Container logs are short-lived and used for debugging
            // obscure machine-level issues. Our long-lived logs are in Honeycomb.
            logging: ecsCluster.shortLivedLogDriver,
            // For security, use the `www-data` user which exists on our Linux image. It
            // only has read access and execute access to files on our system.
            user: "www-data",
            secrets: {
                HONEYCOMB_API_KEY: EcsSecret.fromSecretsManager(secrets, "honeycombApiKey"),
            },
            environment: {
                NODE_ENV: "production",
            },
            command: [
                // NOTE(calebmer): We're not using a shell (e.g. `sh -c`) here because it
                // breaks ECS process termination. The `SIGTERM` signal is sent to the shell
                // (e.g. `sh -c`) not our process.
                //
                // `runProcess()` implements env variable substitution which is why we can use
                // env variable syntax like `$HONEYCOMB_API_KEY`.
                "/var/www/server/migration/migration",
                "--edgeServiceUrl=https://alpine.inc",
                "--resourceServiceUrl=https://resources.alpine.inc",
                `--jobQueueUrl=${sqs.getJobQueueUrl()}`,
                `--fileProcessorJobQueueUrl=${sqs.getFileProcessorJobQueueUrl()}`,
                `--fileProcessorHeavyJobQueueUrl=${sqs.getFileProcessorHeavyJobQueueUrl()}`,
                `--fileProcessorLightJobQueueUrl=${sqs.getFileProcessorLightJobQueueUrl()}`,
                "--honeycombApiKey=$HONEYCOMB_API_KEY",
                `--opensearchDomainEndpoint=${opensearch.domainEndpoint}`,
                // When you execute the ECS `RunTask` action to start migration service, you
                // must provide these environment variables in `containerOverrides`. Each run of
                // the migration service may be for a different task.
                "--migration=$MIGRATION",
                "--segmentIndex=$SEGMENT_INDEX",
                "--totalSegmentCount=$TOTAL_SEGMENT_COUNT",
            ],
        });

        dynamo.grantReadWriteData(taskDefinition.taskRole, {
            // Migrations may scan through DynamoDB tables.
            allowExpensiveScan: true,
        });

        opensearch.grantReadWriteData(taskDefinition.taskRole);
        sqs.grantSendJobQueueMessages(taskDefinition.taskRole);

        // Create a security group for migration service. This security group's ID must
        // be explicitly provided to the [ECS `RunTask`][1] action used to start a
        // migration service instance under `networkConfiguration`.
        //
        // The name `InstanceSecurityGroup` is based on the [default `AutoScalingGroup`
        // security group name][2].
        //
        // [1]: https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_RunTask.html
        // [2]: https://github.com/aws/aws-cdk/blob/b93b7e3fe30aead82d9cb6458036c62541c493ff/packages/aws-cdk-lib/aws-autoscaling/lib/auto-scaling-group.ts#L1410-L1413
        const securityGroup = new SecurityGroup(this, "InstanceSecurityGroup", {
            vpc,
            allowAllOutbound: true,
        });

        opensearch.allowConnectionsFrom(securityGroup);
    }
}
