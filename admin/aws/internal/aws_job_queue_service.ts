import {ArnFormat, Duration, Stack} from "aws-cdk-lib";
import {AutoScalingGroup} from "aws-cdk-lib/aws-autoscaling";
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
import {Effect, ManagedPolicy, PolicyStatement, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {Secret} from "aws-cdk-lib/aws-secretsmanager";
import {Construct} from "constructs";
import {join as joinPath} from "path";
import {AwsDynamo} from "~/admin/aws/internal/aws_dynamo.js";
import {AwsEcsCluster} from "~/admin/aws/internal/aws_ecs_cluster.js";
import {AwsImportUploadsData} from "~/admin/aws/internal/aws_import_uploads_data.js";
import {AwsObservability} from "~/admin/aws/internal/aws_observability.js";
import {AwsOpensearch} from "~/admin/aws/internal/aws_opensearch.js";
import {awsServiceInstanceClass} from "~/admin/aws/internal/aws_service_instance_class.js";
import {AwsSes} from "~/admin/aws/internal/aws_ses.js";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {AwsTaskRealtimeService} from "~/admin/aws/internal/aws_task_realtime_service.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {ecsStopTimeoutMs} from "~/server/helpers/node/shutdown_timeouts.js";

export class AwsJobQueueService extends Construct {
    constructor(
        parentConstruct: Construct,
        {
            vpc,
            ecsCluster,
            cloudflareAccountId,
            dynamo,
            opensearch,
            sqs,
            ses,
            taskRealtimeService,
            observability,
            importUploads,
        }: {
            vpc: Vpc;
            ecsCluster: AwsEcsCluster;
            cloudflareAccountId: string;
            dynamo: AwsDynamo;
            opensearch: AwsOpensearch;
            sqs: AwsSqs;
            ses: AwsSes;
            taskRealtimeService: AwsTaskRealtimeService;
            observability: AwsObservability;
            importUploads: AwsImportUploadsData;
        },
    ) {
        super(parentConstruct, "JobQueueService");

        const stack = Stack.of(this);

        const launchTemplate = new LaunchTemplate(this, "LaunchTemplate", {
            instanceType: InstanceType.of(awsServiceInstanceClass, InstanceSize.LARGE),
            machineImage: EcsOptimizedImage.amazonLinux2(AmiHardwareType.ARM),
            role: new Role(this, "LaunchTemplateRole", {
                assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
                managedPolicies: [
                    ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
                    ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy"),
                ],
            }),
            securityGroup: new SecurityGroup(this, "LaunchTemplateSecurityGroup", {
                vpc,
                allowAllOutbound: true,
            }),
            userData: UserData.forLinux(),
        });

        const autoScalingGroup = new AutoScalingGroup(this, "AutoScalingGroup", {
            vpc,
            launchTemplate,

            minCapacity: 2,
            // During a deploy, we double our capacity needs since we keep running old
            // instances to maintain availability while a new fleet of instances start.
            maxCapacity: 4,

            // See the long comment in `AwsAppService` for why we use a public subnet for our
            // services. The TL;DR is sending egress traffic like Honeycomb API calls through a
            // NAT gateway can get expensive.
            vpcSubnets: {subnetType: SubnetType.PUBLIC},
        });

        observability.installCloudWatchAgent(autoScalingGroup);

        // Add the ability to connect to our EC2 instances with Session Manager.
        // https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html
        autoScalingGroup.role.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        );

        opensearch.allowConnectionsFrom(autoScalingGroup);

        // Allow `JobQueueService` to connect to any `TaskRealtimeService` port.
        taskRealtimeService.autoScalingGroup.connections.allowFrom(autoScalingGroup, Port.allTcp());

        const autoScalingGroupCapacityProvider = new AsgCapacityProvider(
            this,
            "AutoScalingGroupCapacityProvider",
            {
                autoScalingGroup,
                enableManagedDraining: true,
                enableManagedScaling: true,
                enableManagedTerminationProtection: true,
            },
        );

        ecsCluster.cluster.addAsgCapacityProvider(autoScalingGroupCapacityProvider);

        const secrets = Secret.fromSecretNameV2(this, "SecretsImport", "JobQueueServiceSecrets");

        const taskDefinition = new Ec2TaskDefinition(this, "TaskDefinition", {
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

        const schedulerRole = new Role(this, "SchedulerRole", {
            assumedBy: new ServicePrincipal("scheduler.amazonaws.com"),
        });

        // Allow scheduling deploys with AWS EventBridge Scheduler. We need to allow
        // `iam:PassRole` in addition to `scheduler:CreateSchedule`. Since the scheduler
        // will need to use the role on execution.
        {
            sqs.grantSendJobQueueMessages(schedulerRole);

            taskDefinition.addToTaskRolePolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["scheduler:CreateSchedule"],
                    resources: [
                        stack.formatArn({
                            arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
                            service: "scheduler",
                            region: stack.region,
                            account: stack.account,
                            resource: "schedule",
                            resourceName: "default/ScheduleDeployMaintenanceJob",
                        }),
                    ],
                }),
            );

            taskDefinition.addToTaskRolePolicy(
                new PolicyStatement({
                    actions: ["iam:PassRole"],
                    resources: [schedulerRole.roleArn],
                }),
            );
        }

        taskDefinition.addContainer("Container", {
            image: ContainerImage.fromTarball(
                joinPath(
                    runfilesPath,
                    process.env.CDK_LITE === "true"
                        ? "cyberworlds/admin/aws/empty_image_tarball_load/tarball.tar"
                        : "cyberworlds/server/jobs/queue/queue_image_tarball_load/tarball.tar",
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
            secrets: {
                APP_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "appServicePublicKey",
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
                API_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "apiServicePublicKey",
                ),
                RESOURCE_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "resourceServicePublicKey",
                ),
                IMPORTER_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "importerServicePublicKey",
                ),
                JOB_QUEUE_SERVICE_PRIVATE_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "jobQueueServicePrivateKey",
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
                SLACK_CLIENT_ID: EcsSecret.fromSecretsManager(secrets, "slackClientId"),
                SLACK_CLIENT_SECRET: EcsSecret.fromSecretsManager(secrets, "slackClientSecret"),
                GITHUB_APP_ID: EcsSecret.fromSecretsManager(secrets, "githubAppId"),
                GITHUB_APP_PRIVATE_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "githubAppPrivateKey",
                ),
                GITHUB_APP_CLIENT_ID: EcsSecret.fromSecretsManager(secrets, "githubAppClientId"),
                GITHUB_APP_CLIENT_SECRET: EcsSecret.fromSecretsManager(
                    secrets,
                    "githubAppClientSecret",
                ),
                GITHUB_APP_INSTALLATION_ID: EcsSecret.fromSecretsManager(
                    secrets,
                    "githubAppInstallationId",
                ),
                CLOUDFLARE_R2_ACCESS_KEY_ID: EcsSecret.fromSecretsManager(
                    secrets,
                    "cloudflareR2AccessKeyId",
                ),
                CLOUDFLARE_R2_SECRET_ACCESS_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "cloudflareR2SecretAccessKey",
                ),
                LOOPS_API_KEY: EcsSecret.fromSecretsManager(secrets, "loopsApiKey"),
            },
            environment: {
                NODE_ENV: "production",
                AWS_REGION: stack.region,
            },
            command: [
                // NOTE(calebmer): We're not using a shell (e.g. `sh -c`) here because it breaks
                // ECS process termination. The `SIGTERM` signal is sent to the shell (e.g.
                // `sh -c`) not our process.
                //
                // `runService()` implements env variable substitution which is why we can use env
                // variable syntax like `$HONEYCOMB_API_KEY`.
                "/var/www/server/jobs/queue/queue",
                `--opensearchDomainEndpoint=${opensearch.domainEndpoint}`,
                `--jobQueueUrl=${sqs.getJobQueueUrl()}`,
                `--fileProcessorJobQueueUrl=${sqs.getFileProcessorJobQueueUrl()}`,
                `--fileProcessorHeavyJobQueueUrl=${sqs.getFileProcessorHeavyJobQueueUrl()}`,
                `--fileProcessorLightJobQueueUrl=${sqs.getFileProcessorLightJobQueueUrl()}`,
                `--jobQueueArn=${sqs.getJobQueueArn()}`,
                `--schedulerJobQueueRoleArn=${schedulerRole.roleArn}`,
                "--edgeServiceUrl=https://alpine.inc",
                "--resourceServiceUrl=https://resources.alpine.inc",
                `--ecsCluster=${ecsCluster.cluster.clusterName}`,
                `--taskRealtimeServiceEcsTaskDefinitionFamily=${taskRealtimeService.taskDefinition.family}`,
                `--taskRealtimeServiceSecurityGroupId=${taskRealtimeService.securityGroup.securityGroupId}`,
                "--honeycombApiKey=$HONEYCOMB_API_KEY",
                "--cohereApiKey=$COHERE_API_KEY",
                `--kinesisTracerStreamName=${observability.tracerEventStreamName}`,
                "--githubAppId=$GITHUB_APP_ID",
                "--githubAppClientId=$GITHUB_APP_CLIENT_ID",
                "--githubAppClientSecret=$GITHUB_APP_CLIENT_SECRET",
                "--githubAppInstallationId=$GITHUB_APP_INSTALLATION_ID",
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
                "--servicePrivateKey=$JOB_QUEUE_SERVICE_PRIVATE_KEY",
                "--tokenAgentSecret=$TOKEN_AGENT_SECRET",
                "--apnsCertificate=$APNS_CERTIFICATE",
                "--apnsCertificatePrivateKey=$APNS_CERTIFICATE_PRIVATE_KEY",
                "--webPushVapidPublicKey=$WEB_PUSH_VAPID_PUBLIC_KEY",
                "--webPushVapidPrivateKey=$WEB_PUSH_VAPID_PRIVATE_KEY",
                "--slackClientId=$SLACK_CLIENT_ID",
                "--slackClientSecret=$SLACK_CLIENT_SECRET",
                "--githubAppPrivateKey=$GITHUB_APP_PRIVATE_KEY",
                "--loopsApiKey=$LOOPS_API_KEY",
            ],
            healthCheck: {
                command: [
                    "CMD-SHELL",
                    // `curl` is not installed in container. Use a script with our Node.js binary to
                    // perform healthcheck.
                    //
                    // eslint-disable-next-line cyberworlds/string-quotes
                    `/var/www/server/jobs/queue/queue.runfiles/nodejs_linux_arm64/bin/nodejs/bin/node --input-type module --eval "import fs from 'fs'; if (fs.readFileSync('/var/www-data/server_jobs_queue_healthcheck.txt', 'utf8').trim() !== 'Healthy') { throw new Error('Healthcheck failed') }"`,
                ],
            },
        });

        dynamo.grantReadWriteData(taskDefinition.taskRole);
        opensearch.grantReadWriteData(taskDefinition.taskRole);
        sqs.grantSendAndReceiveJobQueueMessages(taskDefinition.taskRole);
        ses.grantSendEmailFromAlpineIdentity(taskDefinition.taskRole);

        // Grant read access to the import uploads bucket for processing Notion imports.
        importUploads.grantRead(taskDefinition.taskRole);

        // Allow writing to the tracer event stream.
        observability.grantPutToTracerEventStream(taskDefinition.taskRole);

        // `JobQueueService` needs to check what tasks ECS is running to appropriately
        // route task requests to the right `TaskRealtimeService`.
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

        new Ec2Service(this, "Service", {
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
    }
}
