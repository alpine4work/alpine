import * as cdk from "aws-cdk-lib";
import {Construct} from "constructs";
import path from "path";
import {addAllDynamoAwsResources} from "~/server/dynamo/add-all-dynamo-aws-resources";
import {repoDirectoryPath} from "~/server/helpers/repo-directory-path";

const outputDirectoryPath = path.join(repoDirectoryPath, "admin/aws/output");

export async function createAwsApp() {
    const app = new cdk.App({autoSynth: false, outdir: outputDirectoryPath});
    const stack = new cdk.Stack(app, "CyberworldsStack");
    await addAwsResources(stack);
    return app;
}

async function addAwsResources(scope: Construct) {
    await addAllDynamoAwsResources(scope);
}
