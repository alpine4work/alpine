import {
    Stack,
    aws_ec2 as ec2,
    aws_ecs as ecs,
    aws_secretsmanager as secretsmanager,
} from "aws-cdk-lib";
import {AutoScalingGroup} from "aws-cdk-lib/aws-autoscaling";
import {RetentionDays} from "aws-cdk-lib/aws-logs";
import {join as joinPath} from "path";
import {runfilesPath} from "~/admin/helpers/runfiles_path.js";

export function addAllContainerAwsResources(stack: Stack) {
    // TODO(calebmer): Write decision log entries on infrastructure choices here.
    // Some quotes from blog posts that helped me:
    //
    // > **Where AWS Fargate is best**
    // >
    // > If you are working in a startup that has not yet acheived product market
    // > fit then the most important thing for engineers to be working on is new
    // > features, and iterating on new features. Spending significant effort on
    // > infrastructure is wasteful and can reduce your chance of finding that
    // > crucial product market fit. In this situation AWS Fargate is better than
    // > using EC2 capacity.
    // >
    // > Additionally, even if you have acheived product market fit, if the most
    // > expensive part of the infrastructure is still the paychecks for your
    // > engineers, then AWS Fargate is also a good choice, as it reduces the
    // > burden on your engineers, allowing them to focus on other high value
    // > things which grow the business.
    //
    // Source: https://containersonaws.com/blog/2023/ec2-or-aws-fargate/
    //
    // > Companies often choose EKS over ECS because they fear cloud vendor
    // > lock-in.
    // >
    // > They believe that if they build their applications using only the building
    // > blocks provided by Kubernetes, they will have maximum portability. In
    // > other words, if there’s an issue with their cloud provider, they can pick
    // > up all their containers and move to a different cloud provider.
    // >
    // > However, the most cost-effective, efficient, and well-architected systems
    // > are the ones that instead treat the cloud provider as the operating system
    // > and they make a clear commitment to the platform.
    // >
    // > Making this definitive choice will save the team a lot of engineering time
    // > that would have otherwise gone into pursuing a multi-cloud strategy. The
    // > time saved would allow them to build functionality faster and deliver more
    // > features to market.
    //
    // Source: https://www.cloudzero.com/blog/ecs-vs-eks
    //
    // We choose great services like DynamoDB and Cloudflare Durable Objects
    // despite the lock-in. This should apply to our container strategy too.

    const vpc = new ec2.Vpc(stack, "Vpc", {
        // NAT gateways are expensive, don't run any. Right now our EC2 instances use
        // the public subnet. See why below.
        natGateways: 0,
    });

    const cluster = new ecs.Cluster(stack, "Cluster", {vpc});

    const defaultAutoScalingGroup = new AutoScalingGroup(stack, "DefaultAutoScalingGroup", {
        vpc,
        // First 750 hours per month of this instance type are free. That effectively
        // translates to 1 free capacity of this instance type.
        instanceType: new ec2.InstanceType("t3.micro"),
        machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
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
        vpcSubnets: {subnetType: ec2.SubnetType.PUBLIC},
    });

    const defaultAutoScalingGroupCapacityProvider = new ecs.AsgCapacityProvider(
        stack,
        "DefaultAutoScalingGroupCapacityProvider",
        {autoScalingGroup: defaultAutoScalingGroup},
    );

    cluster.addAsgCapacityProvider(defaultAutoScalingGroupCapacityProvider);

    const appServicePort = 4000;
    const appServiceSecrets = secretsmanager.Secret.fromSecretNameV2(
        stack,
        "AppServiceSecretsImport",
        "AppServiceSecrets",
    );

    const appServiceTaskDefinition = new ecs.Ec2TaskDefinition(stack, "AppServiceTaskDefinition", {
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
        networkMode: ecs.NetworkMode.HOST,
    });

    appServiceTaskDefinition.addContainer("AppServiceContainer", {
        image: ecs.ContainerImage.fromTarball(
            joinPath(runfilesPath, "cyberworlds/app/app_image_tarball/tarball.tar"),
        ),
        // This appears to be the available memory for our containers. Unclear how we
        // get this number from 1024 (the instance type's memory). It makes sense that
        // we'd need some overhead for ECS.
        memoryLimitMiB: 944,
        // Send logs to AWS. Container logs are short-lived and used for debugging
        // obscure machine-level issues. Our long-lived logs are in Honeycomb.
        logging: ecs.LogDrivers.awsLogs({
            streamPrefix: stack.stackName,
            logRetention: RetentionDays.TWO_WEEKS,
        }),
        // For security, use the `www-data` user which exists on our Linux image. It
        // only has read access and execute access to files on our system.
        user: "www-data",
        portMappings: [{containerPort: appServicePort, hostPort: appServicePort}],
        secrets: {
            APP_SERVICE_PUBLIC_KEY: ecs.Secret.fromSecretsManager(
                appServiceSecrets,
                "appServicePublicKey",
            ),
            APP_SERVICE_PRIVATE_KEY: ecs.Secret.fromSecretsManager(
                appServiceSecrets,
                "appServicePrivateKey",
            ),
            EDGE_SERVICE_FAMILY_PUBLIC_KEY: ecs.Secret.fromSecretsManager(
                appServiceSecrets,
                "edgeServiceFamilyPublicKey",
            ),
            HONEYCOMB_API_KEY: ecs.Secret.fromSecretsManager(appServiceSecrets, "honeycombApiKey"),
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

    new ecs.Ec2Service(stack, "AppService", {
        cluster,
        taskDefinition: appServiceTaskDefinition,
        desiredCount: 2,
    });

    // NOCOMMIT: Security group?
}
