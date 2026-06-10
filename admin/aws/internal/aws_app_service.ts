import {Duration} from "aws-cdk-lib";
import {Vpc} from "aws-cdk-lib/aws-ec2";
import {PolicyStatement} from "aws-cdk-lib/aws-iam";
import {Construct} from "constructs";
import {AwsDynamo} from "~/admin/aws/internal/aws_dynamo.js";
import {AwsEcsCluster} from "~/admin/aws/internal/aws_ecs_cluster.js";
import {AwsImportUploadsData} from "~/admin/aws/internal/aws_import_uploads_data.js";
import {AwsImporterService} from "~/admin/aws/internal/aws_importer_service.js";
import {AwsObservability} from "~/admin/aws/internal/aws_observability.js";
import {AwsOpensearch} from "~/admin/aws/internal/aws_opensearch.js";
import {AwsSes} from "~/admin/aws/internal/aws_ses.js";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {AwsTaskRealtimeService} from "~/admin/aws/internal/aws_task_realtime_service.js";
import {createAwsAppOrApiService} from "~/admin/aws/internal/create_aws_app_or_api_service.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export class AwsAppService extends Construct {
    constructor(
        parentConstruct: Construct,
        options: {
            vpc: Vpc;
            ecsCluster: AwsEcsCluster;
            cloudflareAccountId: string;
            dynamo: AwsDynamo;
            opensearch: AwsOpensearch;
            sqs: AwsSqs;
            ses: AwsSes;
            taskRealtimeService: AwsTaskRealtimeService;
            observability: AwsObservability;
            importUploads: AwsImportUploadsData;
            importerService: AwsImporterService;
        },
    ) {
        super(parentConstruct, "AppService");

        const {taskDefinition} = createAwsAppOrApiService(this, options, {
            serviceName: "App",
            secretsName: "AppServiceSecrets",
            autoScalingGroup: {
                minCapacity: 2,
                // During a deploy, we double our capacity needs since we keep running old
                // instances to maintain availability while a new fleet of instances start.
                maxCapacity: 4,
            },
            taskDefinition: {
                tarballPath: "cyberworlds/app/app_image_tarball_load/tarball.tar",
                containerCommandPath: "/var/www/app/app_production",
            },
            loadBalancer: {
                // NOTE(calebmer, 2024-11-13): This is `LoadBalancer2` because we had an old
                // `LoadBalancer` with an automatically generated `loadBalancerName`. When we
                // switched to an opinionated `loadBalancerName` in order to do a zero downtime
                // deploy we created `LoadBalancer2` alongside the original `LoadBalancer`, updated
                // our DNS record, waited for all requests to move to `LoadBalancer2` then deleted
                // `LoadBalancer`.
                logicalName: "LoadBalancer2",
                domainName: "alpine.inc",
                healthCheckPath: "/api/internal/healthcheck",
                listenerTarget: {
                    // Attempt to route sessions to the same EC2 instance for a day. This is an
                    // optimization that increases in-memory cache hits and not required for successful
                    // operation of the product.
                    stickinessCookieDuration: Duration.days(1),
                },
            },
            withAgentServiceUrl: true,
            withStripeSecrets: true,
            withSlackSecrets: true,
            withLogoDevSecrets: true,
            withCookieNameSuffixOption: true,
            importUploadsBucketName: options.importUploads.bucketName,
            importerService: {
                taskDefinitionArn: options.importerService.taskDefinition.taskDefinitionArn,
                subnetIds: options.importerService.subnetIds,
                securityGroupId: options.importerService.securityGroup.securityGroupId,
                ebsVolumeRoleArn: options.importerService.ebsVolumeRole.roleArn,
            },
        });

        options.ses.grantSendEmailFromAlpineIdentity(taskDefinition.taskRole);

        // Grant access to the import uploads bucket for multipart uploads. PutObject
        // covers CreateMultipartUpload, UploadPart, and CompleteMultipartUpload. GetObject
        // is needed for verifying uploads exist via HeadObject. grantUpload includes
        // s3:Abort\* which covers AbortMultipartUpload for cleaning up canceled imports.
        options.importUploads.grantUpload(taskDefinition.taskRole);
        options.importUploads.grantGetObject(taskDefinition.taskRole);
        options.importUploads.grantDeleteObject(taskDefinition.taskRole);

        // Grant permission to run importer tasks.
        //
        // When the App service programmatically starts a Fargate task via `ecs:RunTask`,
        // it must also have `iam:PassRole` permission for each IAM role that the new task
        // will assume. This is an AWS security mechanism that prevents privilege
        // escalation—without it, a service could start tasks with more permissions than it
        // has itself.
        //
        // See: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_passrole.html
        //
        // We need to pass three roles:
        //
        // - taskRole: The role the importer container uses at runtime to access AWS
        //   resources (DynamoDB, S3, etc.)
        // - executionRole: The role ECS uses to pull container images from ECR and write
        //   logs to CloudWatch
        // - ebsVolumeRole: The role that allows ECS to attach EBS volumes to the task
        //   (used for large file imports that need more disk space than ephemeral storage)
        //
        // Note: CDK provides `taskDefinition.grantRun()` which handles `ecs:RunTask` and
        // `iam:PassRole` for standard roles automatically. We use explicit grants here
        // because we also need to pass the custom `ebsVolumeRole`.
        taskDefinition.addToTaskRolePolicy(
            new PolicyStatement({
                actions: ["ecs:RunTask"],
                resources: [options.importerService.taskDefinition.taskDefinitionArn],
            }),
        );
        taskDefinition.addToTaskRolePolicy(
            new PolicyStatement({
                actions: ["iam:PassRole"],
                resources: [
                    options.importerService.taskDefinition.taskRole.roleArn,
                    assertExists(options.importerService.taskDefinition.executionRole?.roleArn),
                    options.importerService.ebsVolumeRole.roleArn,
                ],
            }),
        );

        // TODO(ifitzsimmons, 2025-12-18): This is a temporary workaround to allow the App
        // service to read the Bots table for the `internal/bots` page. One day, we should
        // have better access patterns for getting all of the bots of which you are an
        // admin. Until then, we'll scan all the bots in the table, since we (Alpine) own
        // all the bots for now.
        options.dynamo.grantReadDataForTable(taskDefinition.taskRole, "Bots", {
            allowExpensiveScan: true,
        });

        // This is here for historical reasons, as we used to send email from
        // cyberworlds.dev. It should be removed at some point in the future.
        taskDefinition.addToTaskRolePolicy(
            new PolicyStatement({
                actions: ["ses:SendEmail"],
                resources: [
                    // We don't send emails from cyberworlds.dev anymore and this was left as a
                    // precaution. Should be removed in the future.
                    "arn:aws:ses:*:*:identity/cyberworlds.dev",
                ],
            }),
        );
    }
}
