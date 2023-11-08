import {App, Stack} from "aws-cdk-lib";
import {fileURLToPath} from "url";
import {AwsAppService} from "~/admin/aws/internal/aws_app_service.js";
import {AwsDynamo} from "~/admin/aws/internal/aws_dynamo.js";
import {AwsEcsCluster} from "~/admin/aws/internal/aws_ecs_cluster.js";
import {AwsOpensearch} from "~/admin/aws/internal/aws_opensearch.js";
import {AwsTaskRealtimeService} from "~/admin/aws/internal/aws_task_realtime_service.js";
import {AwsVpc} from "~/admin/aws/internal/aws_vpc.js";

const outputDirectoryPath = fileURLToPath(new URL("output", import.meta.url));

export async function createAwsApp() {
    const app = new App({autoSynth: false, outdir: outputDirectoryPath});
    const stack = new Stack(app, "CyberworldsStack", {env: {region: "us-east-1"}});
    await addAwsResources(stack);
    return app;
}

async function addAwsResources(stack: Stack) {
    const vpc = new AwsVpc(stack);

    const ecsCluster = new AwsEcsCluster(stack, vpc);
    const opensearch = new AwsOpensearch(stack, vpc);

    const dynamo = await AwsDynamo.new(stack);

    const taskRealtimeService = new AwsTaskRealtimeService(stack, {
        vpc,
        ecsCluster,
        dynamo,
        opensearch,
    });

    new AwsAppService(stack, {
        vpc,
        ecsCluster,
        dynamo,
        opensearch,
        taskRealtimeService,
    });
}
