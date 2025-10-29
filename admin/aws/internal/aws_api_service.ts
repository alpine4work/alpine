import {Vpc} from "aws-cdk-lib/aws-ec2";
import {Construct} from "constructs";
import {AwsDynamo} from "~/admin/aws/internal/aws_dynamo.js";
import {AwsEcsCluster} from "~/admin/aws/internal/aws_ecs_cluster.js";
import {AwsLoggingService} from "~/admin/aws/internal/aws_logging_service.js";
import {AwsOpensearch} from "~/admin/aws/internal/aws_opensearch.js";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {AwsTaskRealtimeService} from "~/admin/aws/internal/aws_task_realtime_service.js";
import {createAwsAppOrApiService} from "~/admin/aws/internal/create_aws_app_or_api_service.js";

export class AwsApiService extends Construct {
    constructor(
        parentConstruct: Construct,
        options: {
            vpc: Vpc;
            ecsCluster: AwsEcsCluster;
            cloudflareAccountId: string;
            dynamo: AwsDynamo;
            opensearch: AwsOpensearch;
            sqs: AwsSqs;
            taskRealtimeService: AwsTaskRealtimeService;
            loggingService: AwsLoggingService;
        },
    ) {
        super(parentConstruct, "ApiService");

        createAwsAppOrApiService(this, options, {
            serviceName: "Api",
            secretsName: "ApiServiceSecrets",
            taskDefinitionOptions: {
                tarballPath: "cyberworlds/server/api/api_image_tarball_load/tarball.tar",
                containerCommandPath: "/var/www/server/api/api",
            },
            loadBalancerOptions: {
                domainName: "api.alpine.inc",
                healthCheckPath: "/healthcheck",
            },
        });
    }
}
