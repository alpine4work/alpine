import {Duration} from "aws-cdk-lib";
import {Vpc} from "aws-cdk-lib/aws-ec2";
import {PolicyStatement} from "aws-cdk-lib/aws-iam";
import {Construct} from "constructs";
import {AwsDynamo} from "~/admin/aws/internal/aws_dynamo.js";
import {AwsEcsCluster} from "~/admin/aws/internal/aws_ecs_cluster.js";
import {AwsObservability} from "~/admin/aws/internal/aws_observability.js";
import {AwsOpensearch} from "~/admin/aws/internal/aws_opensearch.js";
import {AwsSes} from "~/admin/aws/internal/aws_ses.js";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {AwsTaskRealtimeService} from "~/admin/aws/internal/aws_task_realtime_service.js";
import {createAwsAppOrApiService} from "~/admin/aws/internal/create_aws_app_or_api_service.js";

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
        },
    ) {
        super(parentConstruct, "AppService");

        const {taskDefinition} = createAwsAppOrApiService(this, options, {
            serviceName: "App",
            secretsName: "AppServiceSecrets",
            autoScalingGroup: {
                minCapacity: 8,
                // During a deploy, we double our capacity needs since we keep running old
                // instances to maintain availability while a new fleet of instances start.
                maxCapacity: 16,
            },
            taskDefinition: {
                tarballPath: "cyberworlds/app/app_image_tarball_load/tarball.tar",
                containerCommandPath: "/var/www/app/app_production",
            },
            loadBalancer: {
                // NOTE(calebmer, 2024-11-13): This is `LoadBalancer2` because we had an old
                // `LoadBalancer` with an automatically generated `loadBalancerName`. When we
                // switched to an opinionated `loadBalancerName` in order to do a zero downtime
                // deploy we created `LoadBalancer2` alongside the original `LoadBalancer`,
                // updated our DNS record, waited for all requests to move to `LoadBalancer2`
                // then deleted `LoadBalancer`.
                logicalName: "LoadBalancer2",
                domainName: "alpine.inc",
                healthCheckPath: "/api/internal/healthcheck",
                listenerTarget: {
                    // Attempt to route sessions to the same EC2 instance for a day. This is an
                    // optimization that increases in-memory cache hits and not required for
                    // successful operation of the product.
                    stickinessCookieDuration: Duration.days(1),
                },
            },
            withAgentServiceUrl: true,
            withStripeSecrets: true,
            withLogoDevSecrets: true,
            withCookieNameSuffixOption: true,
        });

        options.ses.grantSendEmailFromAlpineIdentity(taskDefinition.taskRole);

        // TODO(ifitzsimmons, 2025-12-18): This is a temporary workaround to allow the App service
        // to read the Bots table for the `internal/bots` page. One day, we should have better
        // access patterns for getting all of the bots of which you are an admin. Until then,
        // we'll scan all the bots in the table, since we (Alpine) own all the bots for now.
        options.dynamo.grantReadDataForTable(taskDefinition.taskRole, "Bots", {
            allowExpensiveScan: true,
        });

        // This is here for historical reasons, as we used to send email from cyberworlds.dev.
        // It should be removed at some point in the future.
        taskDefinition.addToTaskRolePolicy(
            new PolicyStatement({
                actions: ["ses:SendEmail"],
                resources: [
                    // We don't send emails from cyberworlds.dev anymore and this was
                    // left as a precaution. Should be removed in the future.
                    "arn:aws:ses:*:*:identity/cyberworlds.dev",
                ],
            }),
        );
    }
}
