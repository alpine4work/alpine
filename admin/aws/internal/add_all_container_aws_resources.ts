import {Stack} from "aws-cdk-lib";
import {AutoScalingGroup} from "aws-cdk-lib/aws-autoscaling";
import {Certificate, CertificateValidation} from "aws-cdk-lib/aws-certificatemanager";
import {Table} from "aws-cdk-lib/aws-dynamodb";
import {InstanceType, SubnetType, Vpc} from "aws-cdk-lib/aws-ec2";
import {
    AsgCapacityProvider,
    Cluster,
    ContainerImage,
    Ec2Service,
    Ec2TaskDefinition,
    EcsOptimizedImage,
    Secret as EcsSecret,
    LogDrivers,
    NetworkMode,
} from "aws-cdk-lib/aws-ecs";
import {ApplicationLoadBalancer, ApplicationProtocol} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {PolicyStatement} from "aws-cdk-lib/aws-iam";
import {RetentionDays} from "aws-cdk-lib/aws-logs";
import {Secret} from "aws-cdk-lib/aws-secretsmanager";
import {join as joinPath} from "path";
import {runfilesPath} from "~/admin/helpers/runfiles_path.js";
import {DynamoClientAction} from "~/server/dynamo/helpers/dynamo_client_action.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {filterMapArray} from "~/shared/helpers/iterable/filter_map_array.js";

export function addAllContainerAwsResources(
    stack: Stack,
    {dynamoTables}: {dynamoTables: ReadonlyArray<Table>},
) {
    const vpc = new Vpc(stack, "Vpc", {
        // NAT gateways are expensive, don't run any. Right now our EC2 instances use
        // the public subnet. See why below.
        natGateways: 0,
    });

    const cluster = new Cluster(stack, "Cluster", {vpc});

    const defaultAutoScalingGroup = new AutoScalingGroup(stack, "DefaultAutoScalingGroup", {
        vpc,
        // First 750 hours per month of this instance type are free. That effectively
        // translates to 1 free capacity of this instance type.
        instanceType: new InstanceType("t3.micro"),
        machineImage: EcsOptimizedImage.amazonLinux2(),
        // We haven't configured auto scaling parameters yet so stay within our
        // desired capacity.
        maxCapacity: 2,
        minCapacity: 2,

        // Run our service instances on a public subnet. This means we can send
        // outgoing connections to anyone on the internet, but it also means anyone on
        // the internet has access to our instances!
        //
        // We're ok with this tradeoff since the alternative is to create NAT gateways
        // which can get quite expensive when sending data out to services like
        // Honeycomb.
        //
        // We gain back security by:
        //
        // - In application code, only allowing requests from a trusted proxy chain
        //   including the AWS load balancer and our Cloudflare proxy.
        // - Only sending external HTTPS requests to trusted domains (e.g. Honeycomb
        //   and Cloudflare). This means an attacker would need to guess IPs to send
        //   them requests. Security by obscurity.
        //
        // We should be very careful about sending HTTP requests to arbitrary domains!
        // It probably should NOT be done from `AppService` but instead some other
        // service inside a VPC. (We should add some protections to make sure outbound
        // HTTP requests are only for certain domains.)
        //
        // This is probably fine for now but likely needs to be locked down in the
        // future. e.g. Allowlist domains we can send outgoing requests to. Or only
        // allow incoming requests at an infrastructure level instead of an application
        // code level. Or putting our services behind a VPC and use VPC endpoints (for
        // DynamoDB) + [PrivateLink][1] to connect to external partners.
        //
        // [1]: https://docs.honeycomb.io/integrations/aws/aws-privatelink/
        vpcSubnets: {subnetType: SubnetType.PUBLIC},
    });

    const defaultAutoScalingGroupCapacityProvider = new AsgCapacityProvider(
        stack,
        "DefaultAutoScalingGroupCapacityProvider",
        {autoScalingGroup: defaultAutoScalingGroup},
    );

    cluster.addAsgCapacityProvider(defaultAutoScalingGroupCapacityProvider);

    const appServicePort = 4000;
    const appServiceSecrets = Secret.fromSecretNameV2(
        stack,
        "AppServiceSecretsImport",
        "AppServiceSecrets",
    );

    const appServiceTaskDefinition = new Ec2TaskDefinition(stack, "AppServiceTaskDefinition", {
        // According to the docs:
        //
        // > The host and awsvpc network modes offer the highest networking performance
        // > for containers because they use the Amazon EC2 network stack.
        //
        // Also:
        //
        // > Important: When running tasks that use the host network mode, do not run
        // > containers using the root user (UID 0) for better security.
        //
        // We use the host network mode for performance. We're running on public VPC
        // subnets so that means anyone on the internet can send a request to our
        // instance.
        //
        // https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html
        networkMode: NetworkMode.HOST,
    });

    appServiceTaskDefinition.addContainer("AppServiceContainer", {
        image: ContainerImage.fromTarball(
            joinPath(runfilesPath, "cyberworlds/app/app_image_tarball/tarball.tar"),
        ),
        // This appears to be the available memory for our containers. Unclear how we
        // get this number from 1024 (the instance type's memory). It makes sense that
        // we'd need some overhead for ECS.
        memoryLimitMiB: 944,
        // Send logs to AWS. Container logs are short-lived and used for debugging
        // obscure machine-level issues. Our long-lived logs are in Honeycomb.
        logging: LogDrivers.awsLogs({
            streamPrefix: stack.stackName,
            logRetention: RetentionDays.TWO_WEEKS,
        }),
        // For security, use the `www-data` user which exists on our Linux image. It
        // only has read access and execute access to files on our system.
        user: "www-data",
        portMappings: [{containerPort: appServicePort, hostPort: appServicePort}],
        secrets: {
            APP_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                appServiceSecrets,
                "appServicePublicKey",
            ),
            APP_SERVICE_PRIVATE_KEY: EcsSecret.fromSecretsManager(
                appServiceSecrets,
                "appServicePrivateKey",
            ),
            EDGE_SERVICE_FAMILY_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                appServiceSecrets,
                "edgeServiceFamilyPublicKey",
            ),
            HONEYCOMB_API_KEY: EcsSecret.fromSecretsManager(appServiceSecrets, "honeycombApiKey"),
        },
        environment: {
            BAZEL_BINDIR: ".",
        },
        command: [
            // Running using a shell so variables like `$HONEYCOMB_API_KEY` expand to the
            // proper value.
            "sh",
            "-c",
            `/var/www/app/app.runfiles/cyberworlds/app/app.sh ${[
                `--port=${appServicePort}`,
                "--edgeServiceUrl=https://cyberworlds.dev",
                "--honeycombApiKey=$HONEYCOMB_API_KEY",
                // Intentionally escape `$` here! Our key args accept either a file path
                // or the name of an environment variable. RSA keys are too long to be included
                // in a command line string and are hard to quote so we lookup the environment
                // variable within the program.
                "--appServicePublicKey=\\$APP_SERVICE_PUBLIC_KEY",
                "--appServicePrivateKey=\\$APP_SERVICE_PRIVATE_KEY",
                "--edgeServiceFamilyPublicKey=\\$EDGE_SERVICE_FAMILY_PUBLIC_KEY",
            ].join(" ")}`,
        ],
    });

    // Allow sending emails from `AppService`.
    appServiceTaskDefinition.addToTaskRolePolicy(
        new PolicyStatement({
            actions: ["ses:SendEmail"],
            resources: ["arn:aws:ses:*:*:identity/cyberworlds.dev"],
        }),
    );

    // Allow DynamoDB usage in `AppService`.
    {
        const allowedDynamoClientActionsForAppService = filterMapArray(
            Object.entries(
                cast<{[K in DynamoClientAction]: boolean}>({
                    // Allowed
                    GetItem: true,
                    BatchGetItem: true,
                    PutItem: true,
                    DeleteItem: true,
                    BatchWriteItem: true,
                    TransactWriteItems: true,
                    TransactGetItems: true,
                    Query: true,

                    // Not allowed
                    //
                    // Think: If an attacker somehow got access to our container, how could we limit
                    // their damage? Not allowing them to `Scan` to see every item in the table is a
                    // big limitation. They must know item keys or queries to see the relevant data.
                    Scan: false,
                    CreateTable: false,
                    DescribeTable: false,
                    DescribeTimeToLive: false,
                    UpdateTimeToLive: false,
                }),
            ),
            ([action, isAllowed]) => (isAllowed ? action : null),
        );

        appServiceTaskDefinition.addToTaskRolePolicy(
            new PolicyStatement({
                actions: [
                    ...allowedDynamoClientActionsForAppService,
                    // Write transaction entries that aren't top-level DynamoDB actions.
                    "UpdateItem",
                    "ConditionCheckItem",
                ].map(action => `dynamodb:${action}`),
                resources: dynamoTables.flatMap(dynamoTable => [
                    dynamoTable.tableArn,
                    `${dynamoTable.tableArn}/index/*`,
                ]),
            }),
        );
    }

    new Ec2Service(stack, "AppService", {
        cluster,
        taskDefinition: appServiceTaskDefinition,
        desiredCount: 2,
    });

    const loadBalancer = new ApplicationLoadBalancer(stack, "LoadBalancer", {
        vpc,
        internetFacing: true,
    });

    const listener = loadBalancer.addListener("Listener", {
        protocol: ApplicationProtocol.HTTPS,
        port: 443,
        certificates: [
            new Certificate(stack, "Certificate", {
                domainName: "cyberworlds.dev",
                validation: CertificateValidation.fromDns(),
            }),
        ],
    });

    listener.addTargets("TargetGroup", {
        port: appServicePort,
        protocol: ApplicationProtocol.HTTP,
        targets: [defaultAutoScalingGroup],
    });
}
