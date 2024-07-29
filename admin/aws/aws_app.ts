import {App, CfnOutput, Fn, Stack} from "aws-cdk-lib";
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
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";

export async function createAwsApp() {
    const app = new App({autoSynth: false});

    const stack = new Stack(app, "CyberworldsStack", {env: {region: "us-east-1"}});
    await addAwsResources(stack);

    // Resources related to continuous integration and continuous deployment live in
    // this stack. The term "lifecycle" is from the industry term
    // "software development lifecycle" (SDLC).
    const lifecycleStack = new Stack(app, "CyberworldsLifecycleStack", {
        env: {region: "us-east-1"},
    });
    addAwsLifecycleResources(lifecycleStack);

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

    return {importVpc: exportVpc(stack, vpc)};
}

/**
 * Manually export VPC through CloudFormation instead of using the CDK's auto
 * export capabilities. We were finding ourselves running into issues when
 * trying to change how the VPC is used in dependent stacks.
 *
 * For example, if we remove a VPC reference from a dependant stack like
 * `CyberworldsLifecycleStack` we'd get an error trying to deploy
 * `CyberworldsStack` since it was trying to delete the CloudFormation output
 * while the output was still in use by `CyberworldsLifecycleStack`.
 *
 * By explicitly exporting the VPC we:
 *
 * - Ensure the output name never changes
 * - Ensure the output is never implicitly deleted
 */
function exportVpc(exportStack: Stack, vpc: IVpc) {
    assert(isIdentifier(exportStack.stackName));

    new CfnOutput(exportStack, "VpcIdExport", {
        value: vpc.vpcId,
        exportName: `${exportStack.stackName}:VpcId`,
    });

    vpc.publicSubnets.forEach((subnet, index) => {
        new CfnOutput(exportStack, `VpcPublicSubnet${index + 1}IdExport`, {
            value: subnet.subnetId,
            exportName: `${exportStack.stackName}:VpcPublicSubnet${index + 1}Id`,
        });

        new CfnOutput(exportStack, `VpcPublicSubnet${index + 1}RouteTableIdExport`, {
            value: subnet.routeTable.routeTableId,
            exportName: `${exportStack.stackName}:VpcPublicSubnet${index + 1}RouteTableId`,
        });
    });

    vpc.privateSubnets.forEach((subnet, index) => {
        new CfnOutput(exportStack, `VpcPrivateSubnet${index + 1}IdExport`, {
            value: subnet.subnetId,
            exportName: `${exportStack.stackName}:VpcPrivateSubnet${index + 1}Id`,
        });

        new CfnOutput(exportStack, `VpcPrivateSubnet${index + 1}RouteTableIdExport`, {
            value: subnet.routeTable.routeTableId,
            exportName: `${exportStack.stackName}:VpcPrivateSubnet${index + 1}RouteTableId`,
        });
    });

    vpc.isolatedSubnets.forEach((subnet, index) => {
        new CfnOutput(exportStack, `VpcIsolatedSubnet${index + 1}IdExport`, {
            value: subnet.subnetId,
            exportName: `${exportStack.stackName}:VpcIsolatedSubnet${index + 1}Id`,
        });

        new CfnOutput(exportStack, `VpcIsolatedSubnet${index + 1}RouteTableIdExport`, {
            value: subnet.routeTable.routeTableId,
            exportName: `${exportStack.stackName}:VpcIsolatedSubnet${index + 1}RouteTableId`,
        });
    });

    return (importStack: Stack): IVpc => {
        const vpcIdImport = Fn.importValue(`${exportStack.stackName}:VpcId`);

        const publicSubnetIdImports = createArrayWithLength(vpc.publicSubnets.length, index =>
            Fn.importValue(`${exportStack.stackName}:VpcPublicSubnet${index + 1}Id`),
        );

        const publicSubnetRouteTableIdImports = createArrayWithLength(
            vpc.publicSubnets.length,
            index =>
                Fn.importValue(`${exportStack.stackName}:VpcPublicSubnet${index + 1}RouteTableId`),
        );

        const privateSubnetIdImports = createArrayWithLength(vpc.privateSubnets.length, index =>
            Fn.importValue(`${exportStack.stackName}:VpcPrivateSubnet${index + 1}Id`),
        );

        const privateSubnetRouteTableIdImports = createArrayWithLength(
            vpc.privateSubnets.length,
            index =>
                Fn.importValue(`${exportStack.stackName}:VpcPrivateSubnet${index + 1}RouteTableId`),
        );

        const isolatedSubnetIdImports = createArrayWithLength(vpc.isolatedSubnets.length, index =>
            Fn.importValue(`${exportStack.stackName}:VpcIsolatedSubnet${index + 1}Id`),
        );

        const isolatedSubnetRouteTableIdImports = createArrayWithLength(
            vpc.isolatedSubnets.length,
            index =>
                Fn.importValue(
                    `${exportStack.stackName}:VpcIsolatedSubnet${index + 1}RouteTableId`,
                ),
        );

        return Vpc.fromVpcAttributes(importStack, "VpcImport", {
            vpcId: vpcIdImport,
            availabilityZones: vpc.availabilityZones,
            publicSubnetIds: publicSubnetIdImports,
            publicSubnetRouteTableIds: publicSubnetRouteTableIdImports,
            privateSubnetIds: privateSubnetIdImports,
            privateSubnetRouteTableIds: privateSubnetRouteTableIdImports,
            isolatedSubnetIds: isolatedSubnetIdImports,
            isolatedSubnetRouteTableIds: isolatedSubnetRouteTableIdImports,
        });
    };
}

function addAwsLifecycleResources(stack: Stack) {
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

    new AwsGithubRunners(stack, {vpc});
}
