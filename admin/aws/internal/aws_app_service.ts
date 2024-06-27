import {Duration} from "aws-cdk-lib";
import {AutoScalingGroup} from "aws-cdk-lib/aws-autoscaling";
import {Certificate, CertificateValidation} from "aws-cdk-lib/aws-certificatemanager";
import {InstanceType, Port, SubnetType, Vpc} from "aws-cdk-lib/aws-ec2";
import {
    AsgCapacityProvider,
    ContainerImage,
    Ec2Service,
    Ec2TaskDefinition,
    EcsOptimizedImage,
    Secret as EcsSecret,
    NetworkMode,
} from "aws-cdk-lib/aws-ecs";
import {ApplicationLoadBalancer, ApplicationProtocol} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {ManagedPolicy, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {Bucket, BucketEncryption} from "aws-cdk-lib/aws-s3";
import {Secret} from "aws-cdk-lib/aws-secretsmanager";
import {Construct} from "constructs";
import {join as joinPath} from "path";
import {AwsDynamo} from "~/admin/aws/internal/aws_dynamo.js";
import {AwsEcsCluster} from "~/admin/aws/internal/aws_ecs_cluster.js";
import {AwsOpensearch} from "~/admin/aws/internal/aws_opensearch.js";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {AwsTaskRealtimeService} from "~/admin/aws/internal/aws_task_realtime_service.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";

export class AwsAppService extends Construct {
    constructor(
        parentConstruct: Construct,
        {
            vpc,
            ecsCluster,
            dynamo,
            opensearch,
            sqs,
            taskRealtimeService,
        }: {
            vpc: Vpc;
            ecsCluster: AwsEcsCluster;
            dynamo: AwsDynamo;
            opensearch: AwsOpensearch;
            sqs: AwsSqs;
            taskRealtimeService: AwsTaskRealtimeService;
        },
    ) {
        super(parentConstruct, "AppService");

        const autoScalingGroup = new AutoScalingGroup(this, "AutoScalingGroup", {
            vpc,
            // First 750 hours per month of this instance type are free. That effectively
            // translates to 1 free capacity of this instance type across our AWS account.
            instanceType: new InstanceType("t3.micro"),
            machineImage: EcsOptimizedImage.amazonLinux2(),

            minCapacity: 2,
            // During a deploy, we double our capacity needs since we keep running old
            // instances to maintain availability while a new fleet of instances start.
            maxCapacity: 4,

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
            //
            // TODO(calebmer, 2023-11-05): I haven't yet implemented blocking requests from
            // unknown origins in application code. This requires knowing Cloudflare IP
            // addresses and AWS load balancer IP addresses.
            //
            // TODO(calebmer, 2023-11-05): As I'm learning more about what AWS has
            // available, security groups seem like a way to only allow certain outgoing
            // requests. More research is needed on whether they can replace our need for
            // a VPC.
            vpcSubnets: {subnetType: SubnetType.PUBLIC},
        });

        // Add the ability to connect to our EC2 instances with Session Manager.
        // https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html
        autoScalingGroup.role.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        );

        // OpenSearch is in our private VPC subnet. Allow connections from our
        // EC2 instances.
        opensearch.allowConnectionsFrom(autoScalingGroup);

        // Allow `AppService` to connect to any `TaskRealtimeService` port.
        taskRealtimeService.autoScalingGroup.connections.allowFrom(autoScalingGroup, Port.allTcp());

        const autoScalingGroupCapacityProvider = new AsgCapacityProvider(
            this,
            "AutoScalingGroupCapacityProvider",
            {autoScalingGroup},
        );

        ecsCluster.cluster.addAsgCapacityProvider(autoScalingGroupCapacityProvider);

        const port = 4000;
        const secrets = Secret.fromSecretNameV2(this, "SecretsImport", "AppServiceSecrets");

        const taskDefinition = new Ec2TaskDefinition(this, "TaskDefinition", {
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

        taskDefinition.addContainer("Container", {
            image: ContainerImage.fromTarball(
                joinPath(runfilesPath, "cyberworlds/app/app_image_tarball/tarball.tar"),
            ),
            // This appears to be the available memory for our containers. Unclear how we
            // get this number from 1024 (the instance type's memory). It makes sense that
            // we'd need some overhead for ECS.
            memoryLimitMiB: 944,
            // Send logs to AWS. Container logs are short-lived and used for debugging
            // obscure machine-level issues. Our long-lived logs are in Honeycomb.
            logging: ecsCluster.shortLivedLogDriver,
            // Increase stop timeout to five minutes so essential background processes have
            // ample time to finish. For example, task action indexing which is done in the
            // background with `context.process.waitUntil()`.
            stopTimeout: Duration.minutes(5),
            // For security, use the `www-data` user which exists on our Linux image. It
            // only has read access and execute access to files on our system.
            user: "www-data",
            portMappings: [{containerPort: port, hostPort: port}],
            secrets: {
                APP_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "appServicePublicKey",
                ),
                APP_SERVICE_PRIVATE_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "appServicePrivateKey",
                ),
                EDGE_SERVICE_FAMILY_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "edgeServiceFamilyPublicKey",
                ),
                TASK_REALTIME_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "taskRealtimeServicePublicKey",
                ),
                JOB_QUEUE_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "jobQueueServicePublicKey",
                ),
                HONEYCOMB_API_KEY: EcsSecret.fromSecretsManager(secrets, "honeycombApiKey"),
                COHERE_API_KEY: EcsSecret.fromSecretsManager(secrets, "cohereApiKey"),
                APNS_CERTIFICATE: EcsSecret.fromSecretsManager(secrets, "apnsCertificate"),
                APNS_CERTIFICATE_PRIVATE_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "apnsCertificatePrivateKey",
                ),
            },
            environment: {
                NODE_ENV: "production",
            },
            command: [
                // Running using a shell so variables like `$HONEYCOMB_API_KEY` expand to the
                // proper value.
                "sh",
                "-c",
                `/var/www/app/app ${[
                    `--port=${port}`,
                    "--edgeServiceUrl=https://cyberworlds.dev",
                    `--opensearchHost=${opensearch.opensearchHost}`,
                    `--jobQueueUrl=${sqs.getJobQueueUrl()}`,
                    `--ecsCluster=${ecsCluster.cluster.clusterName}`,
                    `--taskRealtimeServiceEcsTaskDefinitionFamily=${taskRealtimeService.taskDefinition.family}`,
                    "--honeycombApiKey=$HONEYCOMB_API_KEY",
                    "--cohereApiKey=$COHERE_API_KEY",
                    // Intentionally escape `$` here! Our key args accept either a file path
                    // or the name of an environment variable. RSA keys are too long to be included
                    // in a command line string and are hard to quote so we lookup the environment
                    // variable within the program.
                    "--appServicePublicKey=\\$APP_SERVICE_PUBLIC_KEY",
                    "--edgeServiceFamilyPublicKey=\\$EDGE_SERVICE_FAMILY_PUBLIC_KEY",
                    "--taskRealtimeServicePublicKey=\\$TASK_REALTIME_SERVICE_PUBLIC_KEY",
                    "--jobQueueServicePublicKey=\\$JOB_QUEUE_SERVICE_PUBLIC_KEY",
                    "--servicePrivateKey=\\$APP_SERVICE_PRIVATE_KEY",
                    "--apnsCertificate=\\$APNS_CERTIFICATE",
                    "--apnsCertificatePrivateKey=\\$APNS_CERTIFICATE_PRIVATE_KEY",
                ].join(" ")}`,
            ],
            healthCheck: {
                command: [
                    "CMD-SHELL",
                    // `curl` is not installed in container. Use a script with our Node.js binary to
                    // perform healthcheck.
                    `/var/www/app/app.runfiles/node_linux_amd64/bin/nodejs/bin/node --input-type module --eval "const response = await fetch('http://localhost:${port}/api/internal/healthcheck'); if (!response.ok) { throw new Error('Healthcheck failed') }"`,
                ],
            },
        });

        dynamo.grantReadWriteData(taskDefinition.taskRole);
        opensearch.grantReadWriteData(taskDefinition.taskRole);
        sqs.grantSendJobQueueMessages(taskDefinition.taskRole);

        // `AppService` sends transactional emails. Like a one-time-password sign
        // in email.
        taskDefinition.addToTaskRolePolicy(
            new PolicyStatement({
                actions: ["ses:SendEmail"],
                resources: ["arn:aws:ses:*:*:identity/cyberworlds.dev"],
            }),
        );

        // `AppService` needs to check what tasks ECS is running to appropriately route
        // task requests to the right `TaskRealtimeService`.
        taskDefinition.addToTaskRolePolicy(
            new PolicyStatement({
                actions: [
                    "ecs:ListTasks",
                    "ecs:DescribeTasks",
                    "ecs:DescribeContainerInstances",
                    "ec2:DescribeNetworkInterfaces",
                ],
                resources: ["*"],
            }),
        );

        const service = new Ec2Service(this, "Service", {
            cluster: ecsCluster.cluster,
            taskDefinition,
            desiredCount: 2,
            // Specifies the max/min task count during a deploy.
            minHealthyPercent: 50,
            maxHealthyPercent: 200,
            capacityProviderStrategies: [
                {
                    capacityProvider: autoScalingGroupCapacityProvider.capacityProviderName,
                    weight: 1,
                },
            ],
        });

        opensearch.allowConnectionsFrom(service.connections);

        const loadBalancer = new ApplicationLoadBalancer(this, "LoadBalancer", {
            vpc,
            internetFacing: true,
        });

        // TODO(calebmer): Enabling access logs to debug 502s when we deploy. I don't
        // think we need this logging long term. We receive some traces from Cloudflare
        // every request. Once we've fixed the 502s we can remove this logging.
        const loadBalancerAccessLogsBucket = new Bucket(this, "LoadBalancerAccessLogsBucket", {
            encryption: BucketEncryption.S3_MANAGED,
        });
        loadBalancer.logAccessLogs(loadBalancerAccessLogsBucket);

        const listener = loadBalancer.addListener("Listener", {
            protocol: ApplicationProtocol.HTTPS,
            port: 443,
            certificates: [
                new Certificate(this, "Certificate", {
                    domainName: "cyberworlds.dev",
                    validation: CertificateValidation.fromDns(),
                }),
            ],
        });

        listener.addTargets("TargetGroup", {
            port: port,
            protocol: ApplicationProtocol.HTTP,
            targets: [autoScalingGroup],
            healthCheck: {
                path: "/api/internal/healthcheck",
                // Speed up deployment by requiring fewer healthy checks. Should only take
                // ~1:30min to consider the service healthy.
                // https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/load-balancer-healthcheck.html
                healthyThresholdCount: 3,
            },
            // Attempt to route sessions to the same EC2 instance for a day. This is an
            // optimization that increases in-memory cache hits and not required for
            // successful operation of the product.
            stickinessCookieDuration: Duration.days(1),
        });
    }
}
