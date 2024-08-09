import {App, CfnOutput, Fn, Stack} from "aws-cdk-lib";
import {ITable} from "aws-cdk-lib/aws-dynamodb";
import {IVpc, SubnetType, Vpc} from "aws-cdk-lib/aws-ec2";
import {AwsAppService} from "~/admin/aws/internal/aws_app_service.js";
import {AwsCronJobs} from "~/admin/aws/internal/aws_cron_jobs.js";
import {AwsDynamo} from "~/admin/aws/internal/aws_dynamo.js";
import {AwsEcsCluster} from "~/admin/aws/internal/aws_ecs_cluster.js";
import {AwsGithubRunners} from "~/admin/aws/internal/aws_github_runners.js";
import {AwsJobQueueService} from "~/admin/aws/internal/aws_job_queue_service.js";
import {AwsMigrationService} from "~/admin/aws/internal/aws_migration_service.js";
import {AwsOpensearch} from "~/admin/aws/internal/aws_opensearch.js";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {AwsTaskRealtimeService} from "~/admin/aws/internal/aws_task_realtime_service.js";
import {AwsVpc} from "~/admin/aws/internal/aws_vpc.js";

export async function createAwsApp() {
    // Hardcoded. We only have one production environment for now.
    const cloudflareAccountId = "d496846050bfc973d24617456c59242b";

    const app = new App({autoSynth: false});

    const stack = new Stack(app, "CyberworldsStack", {env: {region: "us-east-1"}});
    const {importOpensearchHost, importJobQueueUrl, importDeployTable} = await addAwsResources(
        stack,
    );

    // Resources related to continuous integration and continuous deployment live in
    // this stack. The term "lifecycle" is from the industry term
    // "software development lifecycle" (SDLC).
    const lifecycleStack = new Stack(app, "CyberworldsLifecycleStack", {
        env: {region: "us-east-1"},
    });
    addAwsLifecycleResources(lifecycleStack, {
        cloudflareAccountId,
        importOpensearchHost,
        importJobQueueUrl,
        importDeployTable,
    });

    return app;
}

async function addAwsResources(stack: Stack): Promise<{
    importVpc: (stack: Stack) => IVpc;
    importOpensearchHost: (stack: Stack) => string;
    importJobQueueUrl: (stack: Stack) => string;
    importDeployTable: (stack: Stack) => ITable;
}> {
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

    new CfnOutput(stack, "OpensearchHostExport", {
        value: opensearch.opensearchHost,
        exportName: `${stack.stackName}:OpensearchHost`,
    });

    new CfnOutput(stack, "JobQueueUrlExport", {
        value: sqs.getJobQueueUrl(),
        exportName: `${stack.stackName}:JobQueueUrl`,
    });

    // Manually export resources through CloudFormation instead of using the CDK's
    // auto export capabilities. We were finding ourselves running into issues when
    // trying to change how exported resources are used in dependent stacks.
    //
    // For example, if we remove a VPC reference from a dependant stack like
    // `CyberworldsLifecycleStack` we'd get an error trying to deploy
    // `CyberworldsStack` since it was trying to delete the CloudFormation output
    // while the output was still in use by `CyberworldsLifecycleStack`.
    //
    // By explicitly exporting the VPC we:
    //
    // - Ensure the output name never changes
    // - Ensure the output is never implicitly deleted
    return {
        importVpc: vpc.export(),
        importOpensearchHost: () => Fn.importValue(`${stack.stackName}:OpensearchHost`),
        importJobQueueUrl: () => Fn.importValue(`${stack.stackName}:JobQueueUrl`),
        importDeployTable: dynamo.export("Deploy"),
    };
}

function addAwsLifecycleResources(
    stack: Stack,
    {
        cloudflareAccountId,
        importOpensearchHost,
        importJobQueueUrl,
        importDeployTable,
    }: {
        cloudflareAccountId: string;
        importOpensearchHost: (stack: Stack) => string;
        importJobQueueUrl: (stack: Stack) => string;
        importDeployTable: (stack: Stack) => ITable;
    },
) {
    const opensearchHost = importOpensearchHost(stack);
    const jobQueueUrl = importJobQueueUrl(stack);
    const deployTable = importDeployTable(stack);

    // Create our own VPC for lifecycle resources. Right now, we put most resources
    // in public subnets anyway so this doesn't add too much security. What this
    // does that's really useful is allows us to launch GitHub runner instances in
    // all availability zones. In case the first few availability zone we try don't
    // have capacity.
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
        opensearchHost,
        jobQueueUrl,
        deployTable,
    });
}
