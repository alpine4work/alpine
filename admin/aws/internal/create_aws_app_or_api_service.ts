import {Duration} from "aws-cdk-lib";
import {AutoScalingGroup} from "aws-cdk-lib/aws-autoscaling";
import {Certificate, CertificateValidation} from "aws-cdk-lib/aws-certificatemanager";
import {InstanceSize, InstanceType, Port, SubnetType, Vpc} from "aws-cdk-lib/aws-ec2";
import {
    AmiHardwareType,
    AsgCapacityProvider,
    ContainerImage,
    Ec2Service,
    Ec2TaskDefinition,
    EcsOptimizedImage,
    Secret as EcsSecret,
    NetworkMode,
} from "aws-cdk-lib/aws-ecs";
import {
    ApplicationProtocol,
    ApplicationTargetGroupProps,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {ManagedPolicy, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {Secret} from "aws-cdk-lib/aws-secretsmanager";
import {Construct} from "constructs";
import {join as joinPath} from "path";
import {AwsDynamo} from "~/admin/aws/internal/aws_dynamo.js";
import {AwsEcsCluster} from "~/admin/aws/internal/aws_ecs_cluster.js";
import {AwsLoggingService} from "~/admin/aws/internal/aws_logging_service.js";
import {AwsOpensearch} from "~/admin/aws/internal/aws_opensearch.js";
import {awsServiceInstanceClass} from "~/admin/aws/internal/aws_service_instance_class.js";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {AwsTaskRealtimeService} from "~/admin/aws/internal/aws_task_realtime_service.js";
import {AwsApplicationLoadBalancerFromCloudflare} from "~/admin/aws/internal/constructs/aws_application_load_balancer_from_cloudflare.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";

/**
 * Creates either the API service or the App service.
 *
 * App service and API service have near identical workloads (stateless HTTP
 * requests) and run the same server code. App service also runs React SSR
 * `client` code which API service doesn't.
 */
export function createAwsAppOrApiService(
    parentConstruct: Construct,
    {
        dynamo,
        opensearch,
        taskRealtimeService,
        loggingService,
        ecsCluster,
        sqs,
        vpc,
        cloudflareAccountId,
    }: {
        dynamo: AwsDynamo;
        ecsCluster: AwsEcsCluster;
        opensearch: AwsOpensearch;
        sqs: AwsSqs;
        taskRealtimeService: AwsTaskRealtimeService;
        loggingService: AwsLoggingService;
        vpc: Vpc;
        cloudflareAccountId: string;
    },
    {
        serviceName,
        secretsName,
        taskDefinition: taskDefinitionOptions,
        loadBalancer: loadBalancerOptions,
        withAgentServiceUrl,
    }: {
        serviceName: string;
        secretsName: string;
        taskDefinition: {
            tarballPath: string;
            containerCommandPath: string;
        };
        loadBalancer: {
            domainName: string;
            healthCheckPath: string;
            listenerTarget?: Partial<ApplicationTargetGroupProps>;
            logicalName?: string;
        };
        withAgentServiceUrl?: boolean;
    },
) {
    const autoScalingGroup = new AutoScalingGroup(parentConstruct, "AutoScalingGroup", {
        vpc,
        // First 750 hours per month of this instance type are free. That effectively
        // translates to 1 free capacity of this instance type across our AWS account.
        instanceType: InstanceType.of(awsServiceInstanceClass, InstanceSize.MICRO),
        machineImage: EcsOptimizedImage.amazonLinux2(AmiHardwareType.ARM),

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

    opensearch.allowConnectionsFrom(autoScalingGroup);

    // Allow service to connect to any `TaskRealtimeService` port.
    taskRealtimeService.autoScalingGroup.connections.allowFrom(autoScalingGroup, Port.allTcp());

    const autoScalingGroupCapacityProvider = new AsgCapacityProvider(
        parentConstruct,
        "AutoScalingGroupCapacityProvider",
        {autoScalingGroup},
    );

    ecsCluster.cluster.addAsgCapacityProvider(autoScalingGroupCapacityProvider);

    const port = 4000;
    const secrets = Secret.fromSecretNameV2(parentConstruct, "SecretsImport", secretsName);

    const taskDefinition = new Ec2TaskDefinition(parentConstruct, "TaskDefinition", {
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

    const secretKeyEnvironmentVariableName = `${serviceName.toUpperCase()}_SERVICE_PRIVATE_KEY`;
    const servicePrivateKeySecretName = `${serviceName.toLowerCase()}ServicePrivateKey`;
    taskDefinition.addContainer("Container", {
        image: ContainerImage.fromTarball(
            joinPath(
                runfilesPath,
                process.env.CDK_LITE === "true"
                    ? "cyberworlds/admin/aws/empty_image_tarball_load/tarball.tar"
                    : taskDefinitionOptions.tarballPath,
            ),
        ),
        cpu: 2048,
        // Memory available to our container. We can't use the full available memory
        // (1024 MiB for `t4g.micro` instances) because the ECS agent needs some memory
        // to function.
        //
        // The right value is available on the container instance screen in the AWS
        // console. Specifically under the "Resources & networking" tab. You want to
        // look at "Total capacity" and make sure we're reserving all of it.
        //
        // NOTE(calebmer, 2024-11-25): I've observed that if you reserve too much
        // memory on `t4g.nano` instances you don't get an error. Instead the tasks are
        // stuck in the "Provisioning" status forever.
        memoryLimitMiB: 936,
        // Send logs to AWS. Container logs are short-lived and used for debugging
        // obscure machine-level issues. Our long-lived logs are in Honeycomb.
        logging: ecsCluster.shortLivedLogDriver,
        // Increase stop timeout to two minutes so essential background processes
        // have ample time to finish. For example, task action indexing which is done
        // in the background with `context.process.waitUntil()`.
        stopTimeout: Duration.minutes(2),
        // For security, use the `www-data` user which exists on our Linux image. It
        // only has read access and execute access to files on our system.
        user: "www-data",
        portMappings: [{containerPort: port, hostPort: port}],
        secrets: {
            API_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(secrets, "apiServicePublicKey"),
            APP_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(secrets, "appServicePublicKey"),
            [secretKeyEnvironmentVariableName]: EcsSecret.fromSecretsManager(
                secrets,
                servicePrivateKeySecretName,
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
            FILE_PROCESSOR_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                secrets,
                "fileProcessorServicePublicKey",
            ),
            RESOURCE_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                secrets,
                "resourceServicePublicKey",
            ),
            TOKEN_AGENT_SECRET: EcsSecret.fromSecretsManager(secrets, "tokenAgentSecret"),
            HONEYCOMB_API_KEY: EcsSecret.fromSecretsManager(secrets, "honeycombApiKey"),
            COHERE_API_KEY: EcsSecret.fromSecretsManager(secrets, "cohereApiKey"),
            APNS_CERTIFICATE: EcsSecret.fromSecretsManager(secrets, "apnsCertificate"),
            APNS_CERTIFICATE_PRIVATE_KEY: EcsSecret.fromSecretsManager(
                secrets,
                "apnsCertificatePrivateKey",
            ),
            CLOUDFLARE_R2_ACCESS_KEY_ID: EcsSecret.fromSecretsManager(
                secrets,
                "cloudflareR2AccessKeyId",
            ),
            CLOUDFLARE_R2_SECRET_ACCESS_KEY: EcsSecret.fromSecretsManager(
                secrets,
                "cloudflareR2SecretAccessKey",
            ),
        },
        environment: {
            NODE_ENV: "production",
        },
        command: [
            // NOTE(calebmer): We're not using a shell (e.g. `sh -c`) here because it
            // breaks ECS process termination. The `SIGTERM` signal is sent to the shell
            // (e.g. `sh -c`) not our process.
            //
            // `runService()` implements env variable substitution which is why we can use
            // env variable syntax like `$HONEYCOMB_API_KEY`.
            taskDefinitionOptions.containerCommandPath,
            `--port=${port}`,
            "--edgeServiceUrl=https://alpine.inc",
            ...(withAgentServiceUrl
                ? ["--agentServiceUrl=https://agent-service.cyberworlds.workers.dev"]
                : []),
            `--resourceServiceUrl=https://resources.alpine.inc`,
            `--opensearchDomainEndpoint=${opensearch.domainEndpoint}`,
            `--jobQueueUrl=${sqs.getJobQueueUrl()}`,
            `--fileProcessorJobQueueUrl=${sqs.getFileProcessorJobQueueUrl()}`,
            `--fileProcessorHeavyJobQueueUrl=${sqs.getFileProcessorHeavyJobQueueUrl()}`,
            `--fileProcessorLightJobQueueUrl=${sqs.getFileProcessorLightJobQueueUrl()}`,
            `--ecsCluster=${ecsCluster.cluster.clusterName}`,
            `--taskRealtimeServiceEcsTaskDefinitionFamily=${taskRealtimeService.taskDefinition.family}`,
            `--taskRealtimeServiceSecurityGroupId=${taskRealtimeService.securityGroup.securityGroupId}`,
            "--honeycombApiKey=$HONEYCOMB_API_KEY",
            "--cohereApiKey=$COHERE_API_KEY",
            `--cloudflareAccountId=${cloudflareAccountId}`,
            `--cloudflareR2AccessKeyId=$CLOUDFLARE_R2_ACCESS_KEY_ID`,
            `--cloudflareR2SecretAccessKey=$CLOUDFLARE_R2_SECRET_ACCESS_KEY`,
            "--appServicePublicKey=$APP_SERVICE_PUBLIC_KEY",
            "--edgeServiceFamilyPublicKey=$EDGE_SERVICE_FAMILY_PUBLIC_KEY",
            "--taskRealtimeServicePublicKey=$TASK_REALTIME_SERVICE_PUBLIC_KEY",
            "--jobQueueServicePublicKey=$JOB_QUEUE_SERVICE_PUBLIC_KEY",
            "--fileProcessorServicePublicKey=$FILE_PROCESSOR_SERVICE_PUBLIC_KEY",
            "--apiServicePublicKey=$API_SERVICE_PUBLIC_KEY",
            "--resourceServicePublicKey=$RESOURCE_SERVICE_PUBLIC_KEY",
            `--servicePrivateKey=$${secretKeyEnvironmentVariableName}`,
            "--tokenAgentSecret=$TOKEN_AGENT_SECRET",
            "--apnsCertificate=$APNS_CERTIFICATE",
            "--apnsCertificatePrivateKey=$APNS_CERTIFICATE_PRIVATE_KEY",
        ],
        healthCheck: {
            command: [
                "CMD-SHELL",
                // `curl` is not installed in container. Use a script with our Node.js binary to
                // perform healthcheck.
                //
                // eslint-disable-next-line string-quotes
                `${taskDefinitionOptions.containerCommandPath}.runfiles/nodejs_linux_arm64/bin/nodejs/bin/node --input-type module --eval "const response = await fetch('http://localhost:${port}${loadBalancerOptions.healthCheckPath}'); if (!response.ok) { throw new Error('Healthcheck failed') }"`,
            ],
        },
    });

    dynamo.grantReadWriteData(taskDefinition.taskRole);
    opensearch.grantReadWriteData(taskDefinition.taskRole);
    sqs.grantSendJobQueueMessages(taskDefinition.taskRole);

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

    const service = new Ec2Service(parentConstruct, "Service", {
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
        circuitBreaker: {
            enable: true,
            rollback: true,
        },
    });

    // NOTE(calebmer, 2024-11-13): This is `LoadBalancer2` because we had an old
    // `LoadBalancer` with an automatically generated `loadBalancerName`. When we
    // switched to an opinionated `loadBalancerName` in order to do a zero downtime
    // deploy we created `LoadBalancer2` alongside the original `LoadBalancer`,
    // updated our DNS record, waited for all requests to move to `LoadBalancer2`
    // then deleted `LoadBalancer`.
    const {applicationLoadBalancer: loadBalancer} = new AwsApplicationLoadBalancerFromCloudflare(
        parentConstruct,
        loadBalancerOptions.logicalName ?? "LoadBalancer",
        {
            vpc,
            loadBalancerName: `cyberworlds-${serviceName.toLowerCase()}`,
            internetFacing: true,
            deletionProtection: true,
        },
    );

    loadBalancer.logAccessLogs(loggingService.loggingBucket, `${serviceName.toLowerCase()}Service`);
    loadBalancer.logConnectionLogs(
        loggingService.loggingBucket,
        `${serviceName.toLowerCase()}Service`,
    );

    // Make sure the load balancer can make requests against our service.
    autoScalingGroup.connections.allowFrom(loadBalancer, Port.tcp(4000));

    const listener = loadBalancer.addListener("Listener", {
        protocol: ApplicationProtocol.HTTPS,
        port: 443,
        certificates: [
            new Certificate(parentConstruct, "Certificate", {
                domainName: loadBalancerOptions.domainName,
                validation: CertificateValidation.fromDns(),
            }),
        ],
    });

    listener.addTargets("TargetGroup", {
        targetGroupName: `cyberworlds-${serviceName.toLowerCase()}-target-group`,
        port: port,
        protocol: ApplicationProtocol.HTTP,
        targets: [service],
        healthCheck: {
            path: loadBalancerOptions.healthCheckPath,
            // Speed up deployment by requiring fewer healthy checks. Should only take
            // ~10 seconds to consider the service healthy.
            // https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/load-balancer-healthcheck.html
            interval: Duration.seconds(5),
            timeout: Duration.seconds(3),
            healthyThresholdCount: 2,
        },
        // Break connections after 5 seconds when EC2 instances are being
        // deregistered. Any long lived connections longer than 5 seconds will be
        // aborted.
        // https://docs.aws.amazon.com/AmazonECS/latest/developerguide/load-balancer-connection-draining.html
        deregistrationDelay: Duration.seconds(5),
        ...loadBalancerOptions.listenerTarget,
    });

    return {taskDefinition};
}
