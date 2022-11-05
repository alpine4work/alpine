import * as cdk from "aws-cdk-lib";
import {Construct} from "constructs";
import path from "path";
import {addAllDynamoAwsResources} from "~/admin/aws/internal/add_all_dynamo_aws_resources";
import {workspacePath} from "~/admin/helpers/workspace_path";

const outputDirectoryPath = path.join(workspacePath, "admin/aws/output");

export async function createAwsApp() {
    const app = new cdk.App({autoSynth: false, outdir: outputDirectoryPath});
    const stack = new cdk.Stack(app, "CyberworldsStack");
    await addAwsResources(stack);
    return app;
}

async function addAwsResources(scope: Construct) {
    await addAllDynamoAwsResources(scope);
}
