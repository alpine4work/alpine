import {App, Duration, Stack, aws_iam, aws_lambda} from "aws-cdk-lib";
import {SubnetType, Vpc} from "aws-cdk-lib/aws-ec2";
import {Secret} from "aws-cdk-lib/aws-secretsmanager";
import {ciScheduleDeployIamArn} from "~/admin/aws/aws_known_ids.js";
import {AwsAnalyticsMirror} from "~/admin/aws/internal/aws_analytics_mirror.js";
import {AwsApiService} from "~/admin/aws/internal/aws_api_service.js";
import {AwsAppService} from "~/admin/aws/internal/aws_app_service.js";
import {AwsCronJobs} from "~/admin/aws/internal/aws_cron_jobs.js";
import {AwsDynamo} from "~/admin/aws/internal/aws_dynamo.js";
import {AwsEcsCluster} from "~/admin/aws/internal/aws_ecs_cluster.js";
import {AwsFileProcessorService} from "~/admin/aws/internal/aws_file_processor_service.js";
import {AwsGithubRunners} from "~/admin/aws/internal/aws_github_runners.js";
import {AwsImportUploadsData} from "~/admin/aws/internal/aws_import_uploads_data.js";
import {AwsImporterService} from "~/admin/aws/internal/aws_importer_service.js";
import {AwsJobQueueService} from "~/admin/aws/internal/aws_job_queue_service.js";
import {AwsMigrationService} from "~/admin/aws/internal/aws_migration_service.js";
import {AwsObservability} from "~/admin/aws/internal/aws_observability.js";
import {AwsOpensearch} from "~/admin/aws/internal/aws_opensearch.js";
import {AwsSes} from "~/admin/aws/internal/aws_ses.js";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {AwsTaskRealtimeService} from "~/admin/aws/internal/aws_task_realtime_service.js";
import {AwsVpc} from "~/admin/aws/internal/aws_vpc.js";
import {AwsLambda} from "~/admin/aws/internal/constructs/aws_lambda.js";

export async function createAwsApp() {
    // Hardcoded. We only have one production environment for now.
    const cloudflareAccountId = "d496846050bfc973d24617456c59242b";

    const app = new App({autoSynth: false});

    // Resources related to shared observability for our infrastructure and services
    // live in this stack.
    const observabilityStack = new Stack(app, "CyberworldsObservabilityStack", {
        env: {region: "us-east-1"},
    });
    const observability = new AwsObservability(observabilityStack);

    const stack = new Stack(app, "CyberworldsStack", {env: {region: "us-east-1"}});
    const {importDynamo, importSqs} = await addAwsResources(stack, {
        cloudflareAccountId,
        observability,
    });

    // Resources related to continuous integration and continuous deployment live in
    // this stack. The term "lifecycle" is from the industry term "software development
    // lifecycle" (SDLC).
    const lifecycleStack = new Stack(app, "CyberworldsLifecycleStack", {
        env: {region: "us-east-1"},
    });
    addAwsLifecycleResources(lifecycleStack, {
        cloudflareAccountId,
        importDynamo,
        importSqs,
        observability,
    });

    return app;
}

async function addAwsResources(
    stack: Stack,
    {
        cloudflareAccountId,
        observability,
    }: {
        cloudflareAccountId: string;
        observability: AwsObservability;
    },
): Promise<{
    importVpc: (stack: Stack) => AwsVpc;
    importDynamo: (stack: Stack) => AwsDynamo;
    importSqs: (stack: Stack) => AwsSqs;
}> {
    const vpc = new AwsVpc(stack);

    const ecsCluster = new AwsEcsCluster(stack, vpc);
    const opensearch = await AwsOpensearch.new(stack, vpc);
    const sqs = AwsSqs.new(stack);
    const ses = new AwsSes(stack, observability.loggingBucket);

    new AwsCronJobs(stack, sqs);

    const dynamo = await AwsDynamo.new(stack);
    const importUploads = new AwsImportUploadsData(stack);

    const taskRealtimeService = new AwsTaskRealtimeService(stack, {
        vpc,
        ecsCluster,
        dynamo,
        opensearch,
        sqs,
        observability,
    });

    const importerService = new AwsImporterService(stack, {
        vpc,
        ecsCluster,
        cloudflareAccountId,
        dynamo,
        sqs,
        importUploads,
        observability,
        taskRealtimeService,
    });

    new AwsAppService(stack, {
        vpc,
        ecsCluster,
        cloudflareAccountId,
        dynamo,
        opensearch,
        sqs,
        ses,
        taskRealtimeService,
        observability,
        importUploads,
        importerService,
    });

    new AwsApiService(stack, {
        vpc,
        ecsCluster,
        cloudflareAccountId,
        dynamo,
        opensearch,
        sqs,
        taskRealtimeService,
        observability,
    });

    new AwsJobQueueService(stack, {
        vpc,
        ecsCluster,
        cloudflareAccountId,
        dynamo,
        opensearch,
        sqs,
        ses,
        taskRealtimeService,
        observability,
        importUploads,
    });

    new AwsMigrationService(stack, {
        vpc,
        ecsCluster,
        dynamo,
        opensearch,
        sqs,
        observability,
    });

    new AwsFileProcessorService(stack, {
        vpc,
        ecsCluster,
        cloudflareAccountId,
        dynamo,
        sqs,
        observability,
    });

    new AwsAnalyticsMirror(stack, {
        cloudflareAccountId,
        sqs,
        observability,
    });

    // Create our schedule deploy lambda and allow our CI credentials to invoke it
    const scheduleDeployLambda = new AwsLambda(stack, "ScheduleDeploy", {
        bazelConfiguration: {
            bazelTarget: "//admin/lambda/schedule_deploy:schedule_deploy_lambda",
            handlerFilePath: "lambda/schedule_deploy_lambda",
        },
        sqs,
        cloudflareAccountId,
        vpc: null,
        timeout: Duration.seconds(30),
        honeycombApiKey: null,
        environment: {},
        observability,
    });

    sqs.grantSendJobQueueMessages(scheduleDeployLambda.executionRole);
    observability.grantPutToTracerEventStream(scheduleDeployLambda.executionRole);

    const ciScheduleDeployIam = aws_iam.User.fromUserArn(
        stack,
        "CIScheduleDeployRole",
        ciScheduleDeployIamArn,
    );

    scheduleDeployLambda.grantInvoke(ciScheduleDeployIam);

    // Manually export resources through CloudFormation instead of using the CDK's auto
    // export capabilities. We were finding ourselves running into issues when trying
    // to change how exported resources are used in dependent stacks.
    //
    // For example, if we remove a VPC reference from a dependant stack like
    // `CyberworldsLifecycleStack` we'd get an error trying to deploy
    // `CyberworldsStack` since it was trying to delete the CloudFormation output while
    // the output was still in use by `CyberworldsLifecycleStack`.
    //
    // By explicitly exporting the VPC we:
    //
    // - Ensure the output name never changes
    // - Ensure the output is never implicitly deleted
    return {
        importVpc: vpc.export(),
        importDynamo: dynamo.export(["Deploy"]),
        importSqs: sqs.export(),
    };
}

function addAwsLifecycleResources(
    stack: Stack,
    {
        cloudflareAccountId,
        importDynamo,
        importSqs,
        observability,
    }: {
        cloudflareAccountId: string;
        importDynamo: (stack: Stack) => AwsDynamo;
        importSqs: (stack: Stack) => AwsSqs;
        observability: AwsObservability;
    },
) {
    const dynamo = importDynamo(stack);
    const sqs = importSqs(stack);

    // Create our own VPC for lifecycle resources. Right now, we put most resources in
    // public subnets anyway so this doesn't add too much security. What this does
    // that's really useful is allows us to launch GitHub runner instances in all
    // availability zones. In case the first few availability zone we try don't have
    // capacity.
    const vpc = new Vpc(stack, "Vpc", {
        natGateways: 0,
        availabilityZones: [
            "us-east-1a",
            "us-east-1b",
            "us-east-1c",
            "us-east-1d",
            "us-east-1e",
            "us-east-1f",
        ],
        subnetConfiguration: [{subnetType: SubnetType.PUBLIC, name: "Public"}],
    });

    new AwsGithubRunners(stack, {
        vpc,
        cloudflareAccountId,
        dynamo,
        sqs,
        observability,
    });

    // Create our send alert lambda NOTE: If this is renamed, the url used by alerting
    // webhooks will also be changed. THIS WILL BREAK OUR ALERTS, which is not great.
    const sendAlertSecrets = Secret.fromSecretNameV2(stack, "SecretsImport", "AlertSecrets");
    const sendAlertLambda = new AwsLambda(stack, "SendAlert", {
        bazelConfiguration: {
            bazelTarget: "//admin/lambda/send_alert:send_alert_lambda",
            handlerFilePath: "lambda/send_alert_lambda",
        },
        sqs,
        cloudflareAccountId,
        vpc: null,
        timeout: Duration.seconds(30),
        honeycombApiKey: null,
        environment: {
            PAGERDUTY_WEBHOOK_SECRET: sendAlertSecrets
                .secretValueFromJson("pagerDutyWebhookSecret")
                .unsafeUnwrap(),
            HONEYCOMB_WEBHOOK_SECRET: sendAlertSecrets
                .secretValueFromJson("honeycombWebhookSecret")
                .unsafeUnwrap(),
            GITHUB_ACTIONS_WEBHOOK_SECRET: sendAlertSecrets
                .secretValueFromJson("gitHubActionsWebhookSecret")
                .unsafeUnwrap(),
            ALPINE_API_KEY: sendAlertSecrets.secretValueFromJson("alpineAPIKey").unsafeUnwrap(),
        },
        observability,
    });

    // Add a Function URL to the send alert lambda for external webhook access
    sendAlertLambda.lambdaFunction.addFunctionUrl({
        authType: aws_lambda.FunctionUrlAuthType.NONE,
        cors: {
            allowedOrigins: ["*"],
            allowedMethods: [aws_lambda.HttpMethod.POST],
            allowedHeaders: [
                "content-type",
                "user-agent",
                "x-github-event",
                "x-hub-signature",
                "x-hub-signature-256",
                "x-pagerduty-signature",
                "x-honeycomb-webhook-token",
            ],
        },
    });
}
