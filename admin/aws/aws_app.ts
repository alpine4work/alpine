import {
    Architecture,
    FargateRunnerProvider,
    GitHubRunners,
    LambdaAccess,
} from "@cloudsnorkel/cdk-github-runners";
import {App, Stack} from "aws-cdk-lib";
import {fileURLToPath} from "url";
import {AwsAppService} from "~/admin/aws/internal/aws_app_service.js";
import {AwsCronJobs} from "~/admin/aws/internal/aws_cron_jobs.js";
import {AwsDynamo} from "~/admin/aws/internal/aws_dynamo.js";
import {AwsEcsCluster} from "~/admin/aws/internal/aws_ecs_cluster.js";
import {AwsJobQueueService} from "~/admin/aws/internal/aws_job_queue_service.js";
import {AwsMigrationService} from "~/admin/aws/internal/aws_migration_service.js";
import {AwsOpensearch} from "~/admin/aws/internal/aws_opensearch.js";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {AwsTaskRealtimeService} from "~/admin/aws/internal/aws_task_realtime_service.js";
import {AwsVpc} from "~/admin/aws/internal/aws_vpc.js";

const outputDirectoryPath = fileURLToPath(new URL("output", import.meta.url));

export async function createAwsApp() {
    const app = new App({autoSynth: false, outdir: outputDirectoryPath});

    const stack = new Stack(app, "CyberworldsStack", {env: {region: "us-east-1"}});
    const {vpc} = await addAwsResources(stack);

    // Resources related to continuous integration and continuous deployment live in
    // this stack.
    const lifecycleStack = new Stack(app, "CyberworldsLifecycleStack", {
        env: {region: "us-east-1"},
    });
    addAwsLifecycleResources(lifecycleStack, {vpc});

    return app;
}

async function addAwsResources(stack: Stack) {
    const vpc = new AwsVpc(stack);

    const ecsCluster = new AwsEcsCluster(stack, vpc);
    const opensearch = new AwsOpensearch(stack, vpc);
    const sqs = new AwsSqs(stack);

    new AwsCronJobs(stack, sqs);

    const dynamo = await AwsDynamo.new(stack);

    const taskRealtimeService = new AwsTaskRealtimeService(stack, {
        vpc,
        ecsCluster,
        dynamo,
        opensearch,
        sqs,
    });

    new AwsAppService(stack, {
        vpc,
        ecsCluster,
        dynamo,
        opensearch,
        sqs,
        taskRealtimeService,
    });

    new AwsJobQueueService(stack, {
        vpc,
        ecsCluster,
        dynamo,
        opensearch,
        sqs,
        taskRealtimeService,
    });

    new AwsMigrationService(stack, {
        ecsCluster,
        dynamo,
        opensearch,
        sqs,
    });

    return {vpc};
}

function addAwsLifecycleResources(stack: Stack, {vpc}: {vpc: AwsVpc}) {
    const runnerProvider = new FargateRunnerProvider(stack, "FargateRunnerProvider", {
        vpc,
        labels: ["aws-test"],
        imageBuilder: FargateRunnerProvider.imageBuilder(stack, "FargateRunnerImageBuilder", {
            // Use arm64 instances since it's cheaper. From our initial [CI pricing
            // calculator][1] it's estimated x64 instances are ~25% more expensive than
            // arm64 instances.
            //
            // [1]: https://docs.google.com/spreadsheets/d/1MdwqNYwHfVeo9ShYztWSjOTf4h30x36C9R0uAutYy1I/edit
            architecture: Architecture.ARM64,
        }),
        cpu: 16384, // 16 vCPUs
        memoryLimitMiB: 32768, // 32 GB
        ephemeralStorageGiB: 20, // First 20 is free

        // NOTE(calebmer, 2024-07-22): In theory, CI is a good use case for spot
        // capacity. However, when trying to set this up I have one test job that's
        // been running for >12 minutes and still hasn't been able to get spot
        // capacity. Without knowing too much about cloud economics, I'm guessing that
        // trying to get such a large instance (16 vCPU, the max for Fargate) is
        // competitive and so there's not available excess capacity.
        //
        // To optimize cost we could still try:
        //
        // 1. Trying to get spot capacity in a different availability zone that's less
        //    competitive
        // 2. Try to get spot capacity 2-3 times and if that doesn't work request
        //    regular capacity
        //
        // Not doing this for now due to implementation complexity.
        //
        // From our initial [CI pricing calculator][1] it's estimated spot x64
        // instances would save us 63%.
        //
        // [1]: https://docs.google.com/spreadsheets/d/1MdwqNYwHfVeo9ShYztWSjOTf4h30x36C9R0uAutYy1I/edit
        spot: false,
    });

    // NOTE(calebmer, 2024-07-22): `@cloudsnorkel/cdk-github-runners` is causing
    // the following deprecation warning:
    //
    // ```
    // [WARNING] aws-cdk-lib.aws_lambda.FunctionOptions#logFormat is deprecated.
    //   Use `loggingFormat` as a property instead.
    //   This API will be removed in the next major release.
    // ```
    //
    // [Tracking issue][1] in their repository.
    //
    // [1]: https://github.com/CloudSnorkel/cdk-github-runners/issues/596
    new GitHubRunners(stack, "Runners", {
        providers: [runnerProvider],
        setupAccess: LambdaAccess.noAccess(),
        webhookAccess: LambdaAccess.apiGateway({allowedIps: LambdaAccess.githubWebhookIps()}),
    });
}
