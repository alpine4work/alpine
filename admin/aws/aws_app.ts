import {App, Stack} from "aws-cdk-lib";
import {fileURLToPath} from "url";
import {addAllContainerAwsResources} from "~/admin/aws/internal/add_all_container_aws_resources.js";
import {addAllDynamoAwsResources} from "~/admin/aws/internal/add_all_dynamo_aws_resources.js";

const outputDirectoryPath = fileURLToPath(new URL("output", import.meta.url));

export function createAwsApp() {
    const app = new App({autoSynth: false, outdir: outputDirectoryPath});
    const stack = new Stack(app, "CyberworldsStack", {env: {region: "us-east-1"}});
    addAwsResources(stack);
    return app;
}

function addAwsResources(stack: Stack) {
    const {dynamoTables} = addAllDynamoAwsResources(stack);
    addAllContainerAwsResources(stack, {dynamoTables});
}
