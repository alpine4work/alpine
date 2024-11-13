import {ContainerImage, Secret as EcsSecret, FargateTaskDefinition} from "aws-cdk-lib/aws-ecs";
import {Secret} from "aws-cdk-lib/aws-secretsmanager";
import {Construct} from "constructs";
import {join as joinPath} from "path";
import {AwsDynamo} from "~/admin/aws/internal/aws_dynamo.js";
import {AwsEcsCluster} from "~/admin/aws/internal/aws_ecs_cluster.js";
import {AwsOpensearch} from "~/admin/aws/internal/aws_opensearch.js";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";

export class AwsMigrationService extends Construct {
    constructor(
        parentConstruct: Construct,
        {
            ecsCluster,
            dynamo,
            opensearch,
            sqs,
        }: {
            ecsCluster: AwsEcsCluster;
            dynamo: AwsDynamo;
            opensearch: AwsOpensearch;
            sqs: AwsSqs;
        },
    ) {
        super(parentConstruct, "MigrationService");

        const secrets = Secret.fromSecretNameV2(this, "SecretsImport", "MigrationServiceSecrets");

        const taskDefinition = new FargateTaskDefinition(this, "TaskDefinition", {
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
                // Running using a shell so variables like `$HONEYCOMB_API_KEY` expand to the
                // proper value.
                "sh",
                "-c",
                `/var/www/server/migration/migration ${[
                    `--jobQueueUrl=${sqs.getJobQueueUrl()}`,
                    "--honeycombApiKey=$HONEYCOMB_API_KEY",
                    // When you execute the ECS `RunTask` action to start migration service, you
                    // must provide these environment variables in `containerOverrides`. Each run of
                    // the migration service may be for a different task.
                    "--migration=$MIGRATION",
                    "--segmentIndex=$SEGMENT_INDEX",
                    "--totalSegmentCount=$TOTAL_SEGMENT_COUNT",
                ].join(" ")}`,
            ],
        });

        dynamo.grantReadWriteData(taskDefinition.taskRole, {
            // Migrations may scan through DynamoDB tables.
            allowExpensiveScan: true,
        });

        opensearch.grantReadWriteData(taskDefinition.taskRole);
        sqs.grantSendJobQueueMessages(taskDefinition.taskRole);
    }
}
