import {Duration, Stack} from "aws-cdk-lib";
import {AutoScalingGroup} from "aws-cdk-lib/aws-autoscaling";
import {Certificate, CertificateValidation} from "aws-cdk-lib/aws-certificatemanager";
import {
    InstanceSize,
    InstanceType,
    LaunchTemplate,
    Port,
    SecurityGroup,
    SubnetType,
    UserData,
    Vpc,
} from "aws-cdk-lib/aws-ec2";
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
import {ManagedPolicy, PolicyStatement, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {Secret} from "aws-cdk-lib/aws-secretsmanager";
import {Construct} from "constructs";
import {join as joinPath} from "path";
import {AwsDynamo} from "~/admin/aws/internal/aws_dynamo.js";
import {AwsEcsCluster} from "~/admin/aws/internal/aws_ecs_cluster.js";
import {AwsObservability} from "~/admin/aws/internal/aws_observability.js";
import {AwsOpensearch} from "~/admin/aws/internal/aws_opensearch.js";
import {awsServiceInstanceClass} from "~/admin/aws/internal/aws_service_instance_class.js";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {AwsTaskRealtimeService} from "~/admin/aws/internal/aws_task_realtime_service.js";
import {AwsApplicationLoadBalancerFromCloudflare} from "~/admin/aws/internal/constructs/aws_application_load_balancer_from_cloudflare.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {ecsStopTimeoutMs} from "~/server/helpers/node/shutdown_timeouts.js";

/**
 * Creates either the API service or the App service.
 *
 * App service and API service have near identical workloads (stateless HTTP
 * requests) and run the same server code. App service also runs React SSR `client`
 * code which API service doesn't.
 */
export function createAwsAppOrApiService(
    parentConstruct: Construct,
    {
        dynamo,
        opensearch,
        taskRealtimeService,
        observability,
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
        observability: AwsObservability;
        vpc: Vpc;
        cloudflareAccountId: string;
    },
    {
        serviceName,
        secretsName,
        autoScalingGroup: autoScalingGroupOptions,
        taskDefinition: taskDefinitionOptions,
        loadBalancer: loadBalancerOptions,
        withAgentServiceUrl,
        withStripeSecrets,
        withSlackSecrets,
        withLogoDevSecrets,
        withCookieNameSuffixOption,
        importUploadsBucketName,
        importerService,
    }: {
        serviceName: string;
        secretsName: string;
        autoScalingGroup: {
            minCapacity: number;
            maxCapacity: number;
        };
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
        withStripeSecrets?: boolean;
        withSlackSecrets?: boolean;
        withLogoDevSecrets?: boolean;
        withCookieNameSuffixOption?: boolean;
        importUploadsBucketName?: string;
        importerService?: {
            taskDefinitionArn: string;
            subnetIds: Array<string>;
            securityGroupId: string;
            ebsVolumeRoleArn: string;
        };
    },
) {
    const launchTemplate = new LaunchTemplate(parentConstruct, "LaunchTemplate", {
        instanceType: InstanceType.of(awsServiceInstanceClass, InstanceSize.LARGE),
        machineImage: EcsOptimizedImage.amazonLinux2023(AmiHardwareType.ARM),
        role: new Role(parentConstruct, "LaunchTemplateRole", {
            assumedBy: new ServicePrincipal("ec2.amazonaws.com"),

            managedPolicies: [
                // Add the ability to connect to our EC2 instances with Session Manager.
                // https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html
                ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
                // Add the ability to send logs to CloudWatch.
                // https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/prerequisites.html
                ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy"),
            ],
        }),
        securityGroup: new SecurityGroup(parentConstruct, "LaunchTemplateSecurityGroup", {
            vpc,
            allowAllOutbound: true,
        }),
        userData: UserData.forLinux(),
        detailedMonitoring: true,
    });

    const autoScalingGroup = new AutoScalingGroup(parentConstruct, "AutoScalingGroup", {
        vpc,
        launchTemplate,

        minCapacity: autoScalingGroupOptions.minCapacity,
        maxCapacity: autoScalingGroupOptions.maxCapacity,

        // Run our service instances on a public subnet. This means we can send outgoing
        // connections to anyone on the internet, but it also means anyone on the internet
        // has access to our instances!
        //
        // We're ok with this tradeoff since the alternative is to create NAT gateways
        // which can get quite expensive when sending data out to services like Honeycomb.
        //
        // We gain back security by:
        //
        // - In application code, only allowing requests from a trusted proxy chain
        //   including the AWS load balancer and our Cloudflare proxy.
        // - Only sending external HTTPS requests to trusted domains (e.g. Honeycomb and
        //   Cloudflare). This means an attacker would need to guess IPs to send them
        //   requests. Security by obscurity.
        //
        // We should be very careful about sending HTTP requests to arbitrary domains! It
        // probably should NOT be done from `AppService` but instead some other service
        // inside a VPC. (We should add some protections to make sure outbound HTTP
        // requests are only for certain domains.)
        //
        // This is probably fine for now but likely needs to be locked down in the future.
        // e.g. Allowlist domains we can send outgoing requests to. Or only allow incoming
        // requests at an infrastructure level instead of an application code level. Or
        // putting our services behind a VPC and use VPC endpoints (for DynamoDB) +
        // [PrivateLink][1] to connect to external partners.
        //
        // [1]: https://docs.honeycomb.io/integrations/aws/aws-privatelink/
        //
        // TODO(calebmer, 2023-11-05): I haven't yet implemented blocking requests from
        // unknown origins in application code. This requires knowing Cloudflare IP
        // addresses and AWS load balancer IP addresses.
        //
        // TODO(calebmer, 2023-11-05): As I'm learning more about what AWS has available,
        // security groups seem like a way to only allow certain outgoing requests. More
        // research is needed on whether they can replace our need for a VPC.
        vpcSubnets: {subnetType: SubnetType.PUBLIC},
    });

    observability.installCloudWatchAgent(autoScalingGroup);

    opensearch.allowConnectionsFrom(autoScalingGroup);

    // Allow service to connect to any `TaskRealtimeService` port.
    taskRealtimeService.autoScalingGroup.connections.allowFrom(autoScalingGroup, Port.allTcp());

    const autoScalingGroupCapacityProvider = new AsgCapacityProvider(
        parentConstruct,
        "AutoScalingGroupCapacityProvider",
        {
            autoScalingGroup,
            enableManagedDraining: true,
            enableManagedScaling: true,
            enableManagedTerminationProtection: true,
        },
    );

    ecsCluster.cluster.addAsgCapacityProvider(autoScalingGroupCapacityProvider);

    const port = 4000;
    const secrets = Secret.fromSecretNameV2(parentConstruct, "SecretsImport", secretsName);

    const taskDefinition = new Ec2TaskDefinition(parentConstruct, "TaskDefinition", {
        // According to the docs:
        //
        // > The host and awsvpc network modes offer the highest networking performance for
        // > containers because they use the Amazon EC2 network stack.
        //
        // Also:
        //
        // > Important: When running tasks that use the host network mode, do not run
        // > containers using the root user (UID 0) for better security.
        //
        // We use the host network mode for performance. We're running on public VPC
        // subnets so that means anyone on the internet can send a request to our instance.
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
        // Memory available to our container. We can't use the full available memory (1024
        // MiB for `t4g.micro` instances) because the ECS agent needs some memory to
        // function.
        //
        // The right value is available on the container instance screen in the AWS
        // console. Specifically under the "Resources & networking" tab. You want to look
        // at "Total capacity" and make sure we're reserving all of it.
        //
        // NOTE(calebmer, 2024-11-25): I've observed that if you reserve too much memory on
        // `t4g.nano` instances you don't get an error. Instead the tasks are stuck in the
        // "Provisioning" status forever.
        memoryLimitMiB: 3906,
        // Send logs to AWS. Container logs are short-lived and used for debugging obscure
        // machine-level issues. Our long-lived logs are in Honeycomb.
        logging: ecsCluster.shortLivedLogDriver,
        // Increase stop timeout to two minutes so essential background processes have
        // ample time to finish. For example, task action indexing which is done in the
        // background with `context.process.waitUntil()`.
        stopTimeout: Duration.millis(ecsStopTimeoutMs),
        // For security, use the `www-data` user which exists on our Linux image. It only
        // has read access and execute access to files on our system.
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
            IMPORTER_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                secrets,
                "importerServicePublicKey",
            ),
            TOKEN_AGENT_SECRET: EcsSecret.fromSecretsManager(secrets, "tokenAgentSecret"),
            HONEYCOMB_API_KEY: EcsSecret.fromSecretsManager(secrets, "honeycombApiKey"),
            COHERE_API_KEY: EcsSecret.fromSecretsManager(secrets, "cohereApiKey"),
            APNS_CERTIFICATE: EcsSecret.fromSecretsManager(secrets, "apnsCertificate"),
            APNS_CERTIFICATE_PRIVATE_KEY: EcsSecret.fromSecretsManager(
                secrets,
                "apnsCertificatePrivateKey",
            ),
            WEB_PUSH_VAPID_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                secrets,
                "webPushVapidPublicKey",
            ),
            WEB_PUSH_VAPID_PRIVATE_KEY: EcsSecret.fromSecretsManager(
                secrets,
                "webPushVapidPrivateKey",
            ),
            CLOUDFLARE_R2_ACCESS_KEY_ID: EcsSecret.fromSecretsManager(
                secrets,
                "cloudflareR2AccessKeyId",
            ),
            CLOUDFLARE_R2_SECRET_ACCESS_KEY: EcsSecret.fromSecretsManager(
                secrets,
                "cloudflareR2SecretAccessKey",
            ),
            ...(withStripeSecrets
                ? {
                      STRIPE_SECRET_KEY: EcsSecret.fromSecretsManager(secrets, "stripeSecretKey"),
                      STRIPE_SIGNING_SECRET: EcsSecret.fromSecretsManager(
                          secrets,
                          "stripeSigningSecret",
                      ),
                  }
                : {}),
            ...(withLogoDevSecrets
                ? {
                      LOGO_DEV_SECRET_KEY: EcsSecret.fromSecretsManager(
                          secrets,
                          "logoDevSecretKey",
                      ),
                      LOGO_DEV_PUBLISHABLE_KEY: EcsSecret.fromSecretsManager(
                          secrets,
                          "logoDevPublishableKey",
                      ),
                  }
                : {}),
            ...(withSlackSecrets
                ? {
                      SLACK_CLIENT_ID: EcsSecret.fromSecretsManager(secrets, "slackClientId"),
                      SLACK_CLIENT_SECRET: EcsSecret.fromSecretsManager(
                          secrets,
                          "slackClientSecret",
                      ),
                  }
                : {}),
        },
        environment: {
            NODE_ENV: "production",
            AWS_REGION: Stack.of(parentConstruct).region,
        },
        command: [
            // NOTE(calebmer): We're not using a shell (e.g. `sh -c`) here because it breaks
            // ECS process termination. The `SIGTERM` signal is sent to the shell (e.g.
            // `sh -c`) not our process.
            //
            // `runService()` implements env variable substitution which is why we can use env
            // variable syntax like `$HONEYCOMB_API_KEY`.
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
            `--kinesisTracerStreamName=${observability.tracerEventStreamName}`,
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
            "--importerServicePublicKey=$IMPORTER_SERVICE_PUBLIC_KEY",
            `--servicePrivateKey=$${secretKeyEnvironmentVariableName}`,
            "--tokenAgentSecret=$TOKEN_AGENT_SECRET",
            "--apnsCertificate=$APNS_CERTIFICATE",
            "--apnsCertificatePrivateKey=$APNS_CERTIFICATE_PRIVATE_KEY",
            "--webPushVapidPublicKey=$WEB_PUSH_VAPID_PUBLIC_KEY",
            "--webPushVapidPrivateKey=$WEB_PUSH_VAPID_PRIVATE_KEY",
            ...(withSlackSecrets
                ? ["--slackClientId=$SLACK_CLIENT_ID", "--slackClientSecret=$SLACK_CLIENT_SECRET"]
                : []),
            ...(withStripeSecrets
                ? [
                      "--stripeSecretKey=$STRIPE_SECRET_KEY",
                      "--stripeSigningSecret=$STRIPE_SIGNING_SECRET",
                  ]
                : []),
            ...(withLogoDevSecrets
                ? [
                      "--logoDevSecretKey=$LOGO_DEV_SECRET_KEY",
                      "--logoDevPublishableKey=$LOGO_DEV_PUBLISHABLE_KEY",
                  ]
                : []),
            ...(withCookieNameSuffixOption
                ? [
                      "--cookieNameSuffix=", // Cookie names don't have a suffix in production.
                  ]
                : []),
            ...(importUploadsBucketName
                ? [`--importUploadsBucketName=${importUploadsBucketName}`]
                : []),
            ...(importerService
                ? [
                      `--importerServiceEcsTaskDefinition=${importerService.taskDefinitionArn}`,
                      `--importerServiceSubnets=${importerService.subnetIds.join(",")}`,
                      `--importerServiceSecurityGroups=${importerService.securityGroupId}`,
                      `--importerServiceEbsVolumeRoleArn=${importerService.ebsVolumeRoleArn}`,
                  ]
                : []),
        ],
        healthCheck: {
            command: [
                "CMD-SHELL",
                // `curl` is not installed in container. Use a script with our Node.js binary to
                // perform healthcheck.
                //
                // eslint-disable-next-line cyberworlds/string-quotes
                `${taskDefinitionOptions.containerCommandPath}.runfiles/nodejs_linux_arm64/bin/nodejs/bin/node --input-type module --eval "const response = await fetch('http://localhost:${port}${loadBalancerOptions.healthCheckPath}'); if (!response.ok) { throw new Error('Healthcheck failed') }"`,
            ],
        },
    });

    dynamo.grantReadWriteData(taskDefinition.taskRole);
    opensearch.grantReadWriteData(taskDefinition.taskRole);
    sqs.grantSendJobQueueMessages(taskDefinition.taskRole);

    // Allow the task to write to the tracer event stream.
    observability.grantPutToTracerEventStream(taskDefinition.taskRole);

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
        desiredCount: autoScalingGroupOptions.minCapacity,
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
    // deploy we created `LoadBalancer2` alongside the original `LoadBalancer`, updated
    // our DNS record, waited for all requests to move to `LoadBalancer2` then deleted
    // `LoadBalancer`.
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

    loadBalancer.logAccessLogs(
        observability.loggingBucket,
        `${observability.logsBucketPrefix}${serviceName.toLowerCase()}Service`,
    );
    loadBalancer.logConnectionLogs(
        observability.loggingBucket,
        `${observability.logsBucketPrefix}${serviceName.toLowerCase()}Service`,
    );

    // Make sure the load balancer can make requests against our service.
    autoScalingGroup.connections.allowFrom(loadBalancer, Port.tcp(4000));

    const listener = loadBalancer.addListener("Listener", {
        protocol: ApplicationProtocol.HTTPS,
        port: 443,
        // We only allow requests from Cloudflare IPs. This defaults to true and when true
        // it updates the security group to allow connections from 0.0.0.0/0.
        open: false,
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
            // Speed up deployment by requiring fewer healthy checks. Should only take ~10
            // seconds to consider the service healthy.
            // https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/load-balancer-healthcheck.html
            interval: Duration.seconds(5),
            timeout: Duration.seconds(2),
            healthyThresholdCount: 2,
            unhealthyThresholdCount: 2,
        },
        // Break connections after 5 seconds when EC2 instances are being deregistered. Any
        // long lived connections longer than 5 seconds will be aborted.
        // https://docs.aws.amazon.com/AmazonECS/latest/developerguide/load-balancer-connection-draining.html
        deregistrationDelay: Duration.seconds(5),
        ...loadBalancerOptions.listenerTarget,
    });

    return {taskDefinition};
}
