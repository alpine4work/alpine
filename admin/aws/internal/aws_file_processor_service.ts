import {CfnParameter, Duration} from "aws-cdk-lib";
import {AutoScalingGroup, BlockDeviceVolume} from "aws-cdk-lib/aws-autoscaling";
import {Certificate, CertificateValidation} from "aws-cdk-lib/aws-certificatemanager";
import {
    InstanceClass,
    InstanceSize,
    InstanceType,
    Port,
    SubnetType,
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
    ApplicationLoadBalancer,
    ApplicationProtocol,
    ApplicationTargetGroup,
    ListenerAction,
    ListenerCondition,
    TargetType,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {LambdaTarget} from "aws-cdk-lib/aws-elasticloadbalancingv2-targets";
import {ManagedPolicy, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {Architecture, Code, Function as LambdaFunction, Runtime} from "aws-cdk-lib/aws-lambda";
import {RetentionDays} from "aws-cdk-lib/aws-logs";
import {ISecret, Secret} from "aws-cdk-lib/aws-secretsmanager";
import {Construct} from "constructs";
import {join as joinPath} from "path";
import {AwsDynamo} from "~/admin/aws/internal/aws_dynamo.js";
import {AwsEcsCluster} from "~/admin/aws/internal/aws_ecs_cluster.js";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {InternalError} from "~/shared/error/error.js";
import {fileProcessorTimeoutMs, maxFileContentLength} from "~/shared/files/file_constants.js";
import {quote} from "~/shared/helpers/string/quote.js";

// IMPORTANT: `FileProcessorService` has a pretty broad attack surface given
// all the libraries it uses to process dependencies. `FileProcessorService`
// uses (among other things):
//
// - [`sharp`][1] which itself has a bunch of dependencies including
//   [GraphicsMagick and PDFium][2]
// - [FFmpeg][3]
// - [LibreOffice][4]
//
// These libraries are massive and have many opportunities to be exploited. One
// possible simple exploit that comes to mind is using one of these libraries
// to process a file with an embedded URL that points to an image. If the file
// format goes to fetch the URL then the attack now knows
// `FileProcessorService`'s IP address and can try to perform more attacks.
// (Knowing the IP alone shouldn't give the attacker much but it does mean we
// have to be very careful about what ports we expose to the network.)
//
// As such we're very strict about what permissions we grant to
// `FileProcessorService` as an extra layer of security. If we grant the
// absolute minimum set of permissions `FileProcessorService` needs then even
// if an attacker is able to compromise a `FileProcessorService` EC2 instance
// they won't be able to do much with it. As of 2024-11-12 we only give
// `FileProcessorService` read/write to the `Files` table and no other tables.
// We do not give access to the DynamoDB `Scan` action. An attacker can't do
// too much harm with this set of permissions.
//
// To be clear, we don't know of any vulnerabilities that allow attackers to
// compromise `FileProcessorService` and if we discover any vulnerabilities we
// should fix them immediately. The permissions we grant `FileProcessorService`
// is an additional precaution.
//
// [1]: https://www.npmjs.com/package/sharp
// [2]: https://github.com/cyberworlds/sharp-libvips/blob/174959af63c6f3dd25b1339b8d3fc2bfc289a176/THIRD-PARTY-NOTICES.md
// [3]: https://www.ffmpeg.org
// [4]: https://www.libreoffice.org
export class AwsFileProcessorService extends Construct {
    private readonly resizeLambda: LambdaFunction;
    private readonly fileProcessorServiceLoadBalancer: ApplicationLoadBalancer;
    private readonly legacyFileProcessorServiceTargetGroup: ApplicationTargetGroup;
    private readonly fileProcessorServiceTargetGroup: ApplicationTargetGroup;

    constructor(
        parentConstruct: Construct,
        {
            vpc,
            ecsCluster,
            cloudflareAccountId,
            dynamo,
            sqs,
        }: {
            vpc: Vpc;
            ecsCluster: AwsEcsCluster;
            cloudflareAccountId: string;
            dynamo: AwsDynamo;
            sqs: AwsSqs;
        },
    ) {
        super(parentConstruct, "FileProcessorService");

        const secrets = Secret.fromSecretNameV2(
            this,
            "SecretsImport",
            "FileProcessorServiceSecrets",
        );

        this.fileProcessorServiceLoadBalancer = new ApplicationLoadBalancer(this, "LoadBalancer", {
            vpc,
            loadBalancerName: "cyberworlds-files",
            internetFacing: true,
        });

        // TODO(ifitzsimmons, 2025-07-30, ##file-processor-service-migration):
        // To maintain naming consistency of the File Processor Service, we created
        // all of the new resources in the `FileProcessorService` construct. When we
        // are ready to migrate to the new service, we'll remove the legacy resources
        // and replace them with the new resources. See discussion here
        // https://app.graphite.dev/github/pr/cyberworlds/cyberworlds/248/resizeFile-Lambda-with-Local-runtime#comment-PRRC_kwDOH2ktg86E_0S-
        //
        // For this particular code block, we'll remove the block scope
        // New FileProcessorService
        {
            const sharedEnvironmentVariables = this._getSharedEnvironmentVariables({
                secrets,
                cloudflareAccountId,
            });

            const {resizeLambda, resizeFileLambdaTargetGroup} = this._getResizeFileLambda({
                sharedEnvironmentVariables,
                vpc,
                dynamo,
            });
            this.resizeLambda = resizeLambda;
            this.fileProcessorServiceTargetGroup = resizeFileLambdaTargetGroup;
        }

        // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Delete this
        // Old FileProcessorService
        {
            const {fileProcessorServiceTargetGroup} = this._createLegacyFileProcessorService({
                vpc,
                ecsCluster,
                cloudflareAccountId,
                dynamo,
                sqs,
                secrets,
                loadBalancer: this.fileProcessorServiceLoadBalancer,
            });
            this.legacyFileProcessorServiceTargetGroup = fileProcessorServiceTargetGroup;
        }

        // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): remove this once we've
        // migrated to the new service
        //
        //  Set up weighted routing to the new and old services
        {
            const listener = this.fileProcessorServiceLoadBalancer.addListener("Listener", {
                protocol: ApplicationProtocol.HTTPS,
                port: 443,
                certificates: [
                    new Certificate(this, "Certificate", {
                        domainName: "files.alpine.inc",
                        validation: CertificateValidation.fromDns(),
                    }),
                ],
            });

            // Create a parameter for easy weight adjustment
            const resizeFileLambdaWeight = new CfnParameter(this, "ResizeFileServiceLambdaWeight", {
                type: "Number",
                default: 0,
                minValue: 0,
                maxValue: 100,
                description: "Percentage of traffic to send to ResizeFileService Lambda (0-100)",
            });

            const legacyFileProcessorServiceWeight = new CfnParameter(
                this,
                "LegacyFileProcessorServiceWeight",
                {
                    type: "Number",
                    default: 100,
                    minValue: 0,
                    maxValue: 100,
                    description:
                        "Percentage of traffic to send to Legacy FileProcessorService (0-100)",
                },
            );

            listener.addAction("WeightedResizeFileRouting", {
                conditions: [ListenerCondition.pathPatterns(["/*/resize/*"])],
                action: ListenerAction.weightedForward([
                    {
                        targetGroup: this.legacyFileProcessorServiceTargetGroup,
                        weight: legacyFileProcessorServiceWeight.valueAsNumber,
                    }, // 100% to existing
                    {
                        targetGroup: this.fileProcessorServiceTargetGroup,
                        weight: resizeFileLambdaWeight.valueAsNumber,
                    }, // 0% to new
                ]),
                priority: 100,
            });

            // TODO(ifitzsimmons, #file-processor-service-migration): Once we've
            // migrated, remove the weighted route action above and change the target group to
            // this.fileProcessorServiceTargetGroup. This is a default action.
            listener.addTargetGroups("FileProcessorServiceRouting", {
                targetGroups: [this.legacyFileProcessorServiceTargetGroup], // Routes to this target group
            });
        }
    }

    private _getSharedEnvironmentVariables({
        secrets,
        cloudflareAccountId,
    }: {
        secrets: ISecret;
        cloudflareAccountId: string;
    }) {
        return {
            NODE_ENV: "production",
            CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId,
            APP_SERVICE_PUBLIC_KEY: secrets
                .secretValueFromJson("appServicePublicKey")
                .unsafeUnwrap(),
            EDGE_SERVICE_FAMILY_PUBLIC_KEY: secrets
                .secretValueFromJson("edgeServiceFamilyPublicKey")
                .unsafeUnwrap(),
            TASK_REALTIME_SERVICE_PUBLIC_KEY: secrets
                .secretValueFromJson("taskRealtimeServicePublicKey")
                .unsafeUnwrap(),
            JOB_QUEUE_SERVICE_PUBLIC_KEY: secrets
                .secretValueFromJson("jobQueueServicePublicKey")
                .unsafeUnwrap(),
            FILE_PROCESSOR_SERVICE_PUBLIC_KEY: secrets
                .secretValueFromJson("fileProcessorServicePublicKey")
                .unsafeUnwrap(),
            FILE_PROCESSOR_SERVICE_PRIVATE_KEY: secrets
                .secretValueFromJson("fileProcessorServicePrivateKey")
                .unsafeUnwrap(),
            TOKEN_AGENT_SECRET: secrets.secretValueFromJson("tokenAgentSecret").unsafeUnwrap(),
            HONEYCOMB_API_KEY: secrets.secretValueFromJson("honeycombApiKey").unsafeUnwrap(),
            CLOUDFLARE_R2_ACCESS_KEY_ID: secrets
                .secretValueFromJson("cloudflareR2AccessKeyId")
                .unsafeUnwrap(),
            CLOUDFLARE_R2_SECRET_ACCESS_KEY: secrets
                .secretValueFromJson("cloudflareR2SecretAccessKey")
                .unsafeUnwrap(),
        };
    }

    private _getResizeFileLambda({
        sharedEnvironmentVariables,
        vpc,
        dynamo,
    }: {
        sharedEnvironmentVariables: Record<string, string>;
        vpc: Vpc;
        dynamo: AwsDynamo;
    }) {
        const resizeFileExectutionRole = new Role(this, "ResizeFileLambdaExecutionRole", {
            assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
                ManagedPolicy.fromAwsManagedPolicyName(
                    "service-role/AWSLambdaVPCAccessExecutionRole",
                ),
            ],
        });
        dynamo.grantReadDataForTable(resizeFileExectutionRole, "Files", {
            disallowQuery: true,
        });
        const resizeFileLambdaRelativePath =
            process.env.CDK_LITE === "true"
                ? "cyberworlds/admin/aws/empty_lambda"
                : "cyberworlds/server/files/processor/resize_file_lambda";

        const resizeFileLambdaPath = joinPath(runfilesPath, `${resizeFileLambdaRelativePath}.zip`);
        const resizeFileLambdaHandler = `${resizeFileLambdaRelativePath}.handler`;

        const resizeLambda = new LambdaFunction(this, "ResizeFile", {
            runtime: Runtime.NODEJS_22_X,
            // https://aws.amazon.com/blogs/apn/comparing-aws-lambda-arm-vs-x86-performance-cost-and-analysis-2/
            architecture: Architecture.ARM_64,
            vpc,
            role: resizeFileExectutionRole,
            code: Code.fromAsset(resizeFileLambdaPath),
            handler: resizeFileLambdaHandler,
            memorySize: 4096, // 4GB RAM (~2 vCPUs)
            // Intentionally short timeout to ensure that the lambda is killed
            // if it's not able to complete the resize operation.
            timeout: Duration.seconds(30),
            environment: sharedEnvironmentVariables,
            logRetention: RetentionDays.ONE_WEEK,
            deadLetterQueueEnabled: true,
        });

        const resizeFileLambdaTargetGroup = new ApplicationTargetGroup(
            this,
            "ResizeFileLambdaTargetGroup",
            {
                targetType: TargetType.LAMBDA,
                targets: [new LambdaTarget(resizeLambda)],
                vpc,
            },
        );

        return {resizeLambda, resizeFileLambdaTargetGroup};
    }

    private _createLegacyFileProcessorService({
        vpc,
        ecsCluster,
        cloudflareAccountId,
        dynamo,
        sqs,
        secrets,
        loadBalancer,
    }: {
        vpc: Vpc;
        ecsCluster: AwsEcsCluster;
        cloudflareAccountId: string;
        dynamo: AwsDynamo;
        sqs: AwsSqs;
        secrets: ISecret;
        loadBalancer: ApplicationLoadBalancer;
    }) {
        // File processing needs a lot of memory so we need larger instance sizes than
        // other services. We've found image resizing particularly quickly runs out of
        // memory when resizing large images.
        const instanceType = InstanceType.of(InstanceClass.R7G, InstanceSize.LARGE);
        const vCpuCount = getInstanceTypeVCpuCount(instanceType);

        // Make sure we have enough storage to process one maximum size file per vCPU.
        // `FileUploadService` only processes a max of one file per vCPU at a time. We
        // add an extra 10% overhead to be safe.
        //
        // 30 GiB is the default size for an EBS volume so use that as our minimum
        // volume size.
        const maxFileContentLengthGib = maxFileContentLength / 1024 ** 3;
        const volumeSize = Math.max(30, Math.ceil(maxFileContentLengthGib * 1.1 * vCpuCount));

        const autoScalingGroup = new AutoScalingGroup(this, "AutoScalingGroup", {
            vpc,
            instanceType,
            machineImage: EcsOptimizedImage.amazonLinux2(AmiHardwareType.ARM),

            minCapacity: 1,
            // During a deploy, we double our capacity needs since we keep running old
            // instances to maintain availability while a new fleet of instances start.
            maxCapacity: 2,

            // See the long comment in `AwsAppService` for why we use a public
            // subnet for our services. The TL;DR is sending egress traffic like Honeycomb
            // API calls through a NAT gateway can get expensive.
            vpcSubnets: {subnetType: SubnetType.PUBLIC},

            blockDevices: [
                {
                    deviceName: "/dev/xvda",
                    volume: BlockDeviceVolume.ebs(volumeSize),
                },
            ],
        });

        // Add the ability to connect to our EC2 instances with Session Manager.
        // https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html
        autoScalingGroup.role.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        );

        const autoScalingGroupCapacityProvider = new AsgCapacityProvider(
            this,
            "AutoScalingGroupCapacityProvider",
            {autoScalingGroup},
        );

        ecsCluster.cluster.addAsgCapacityProvider(autoScalingGroupCapacityProvider);

        const port = 4000;

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
                joinPath(
                    runfilesPath,
                    process.env.CDK_LITE === "true"
                        ? "cyberworlds/admin/aws/empty_image_tarball_load/tarball.tar"
                        : "cyberworlds/server/files/processor/processor_image_tarball_load/tarball.tar",
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
            memoryLimitMiB: 15810,
            // Send logs to AWS. Container logs are short-lived and used for debugging
            // obscure machine-level issues. Our long-lived logs are in Honeycomb.
            logging: ecsCluster.shortLivedLogDriver,
            // Increase stop timeout to half a minute longer than the file processing
            // timeout. Right now the file processing timeout is 5min (videos which need to
            // transcode may take a while to process) which makes this timeout 5:30min.
            // That's very long! It'll mean our deploys take longer to finish.
            //
            // Consider taking long running processing actions (e.g. video transcoding) and
            // putting them in AWS Lambdas with minimal dependencies that will very rarely
            // change on deploy to speed up deploys.
            stopTimeout: Duration.millis(fileProcessorTimeoutMs + 1000 * 30),
            // For security, use the `www-data` user which exists on our Linux image. It
            // only has read access and execute access to files on our system.
            user: "www-data",
            portMappings: [{containerPort: port, hostPort: port}],
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
                FILE_PROCESSOR_SERVICE_PRIVATE_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "fileProcessorServicePrivateKey",
                ),
                TOKEN_AGENT_SECRET: EcsSecret.fromSecretsManager(secrets, "tokenAgentSecret"),
                HONEYCOMB_API_KEY: EcsSecret.fromSecretsManager(secrets, "honeycombApiKey"),
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
                // Running using a shell so variables like `$HONEYCOMB_API_KEY` expand to the
                // proper value.
                "sh",
                "-c",
                `/var/www/server/files/processor/processor ${[
                    `--port=${port}`,
                    "--temporaryDirectoryPath=/var/www-data/files",
                    `--jobQueueUrl=${sqs.getJobQueueUrl()}`,
                    `--fileProcessorJobQueueUrl=${sqs.getFileProcessorJobQueueUrl()}`,
                    "--honeycombApiKey=$HONEYCOMB_API_KEY",
                    `--cloudflareAccountId=${cloudflareAccountId}`,
                    `--cloudflareR2AccessKeyId=$CLOUDFLARE_R2_ACCESS_KEY_ID`,
                    `--cloudflareR2SecretAccessKey=$CLOUDFLARE_R2_SECRET_ACCESS_KEY`,
                    // Intentionally escape `$` here! Our key args accept either a file path
                    // or the name of an environment variable. RSA keys are too long to be included
                    // in a command line string and are hard to quote so we lookup the environment
                    // variable within the program.
                    "--appServicePublicKey=\\$APP_SERVICE_PUBLIC_KEY",
                    "--edgeServiceFamilyPublicKey=\\$EDGE_SERVICE_FAMILY_PUBLIC_KEY",
                    "--taskRealtimeServicePublicKey=\\$TASK_REALTIME_SERVICE_PUBLIC_KEY",
                    "--jobQueueServicePublicKey=\\$JOB_QUEUE_SERVICE_PUBLIC_KEY",
                    "--fileProcessorServicePublicKey=\\$FILE_PROCESSOR_SERVICE_PUBLIC_KEY",
                    "--servicePrivateKey=\\$FILE_PROCESSOR_SERVICE_PRIVATE_KEY",
                    "--tokenAgentSecret=\\$TOKEN_AGENT_SECRET",
                ].join(" ")}`,
            ],
            healthCheck: {
                command: [
                    "CMD-SHELL",
                    // `curl` is not installed in container. Use a script with our Node.js binary to
                    // perform healthcheck.
                    //
                    // eslint-disable-next-line string-quotes
                    `/var/www/server/files/processor/processor.runfiles/nodejs_linux_arm64/bin/nodejs/bin/node --input-type module --eval "const response = await fetch('http://localhost:${port}/healthcheck'); if (!response.ok) { throw new Error('Healthcheck failed') }"`,
                ],
            },
        });

        // IMPORTANT: Only grant `FileProcessorService` the ability to send/receive
        // messages on the file processor job queue. Being able to send messages to the
        // default queue is dangerous since jobs are executed with a system context
        // which is a privilege escalation.
        sqs.grantSendAndReceiveJobQueueMessagesForOnlyFileProcessorQueue(taskDefinition.taskRole);

        // IMPORTANT: Only grant `FileProcessorService` access to the tables it uses.
        // This reduces what an attacker can do with a compromised
        // `FileProcessorService`.
        //
        // Disallow queries so you can't read all files for a space.
        dynamo.grantReadWriteDataForTable(taskDefinition.taskRole, "Files", {disallowQuery: true});

        const service = new Ec2Service(this, "Service", {
            cluster: ecsCluster.cluster,
            taskDefinition,
            desiredCount: 1,
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

        // Make sure the load balancer can make requests against our service.
        autoScalingGroup.connections.allowFrom(loadBalancer, Port.tcp(4000));

        const fileProcessorServiceTargetGroup = new ApplicationTargetGroup(
            this,
            "LegacyTargetGroup",
            {
                targetGroupName: "legacy-files-target-group",
                port: port,
                protocol: ApplicationProtocol.HTTP,
                targets: [service],
                vpc,
                healthCheck: {
                    path: "/healthcheck",
                    // Speed up deployment by requiring fewer healthy checks. Should only take
                    // ~15 seconds to consider the service healthy.
                    // https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/load-balancer-healthcheck.html
                    interval: Duration.seconds(5),
                    timeout: Duration.seconds(3),
                    healthyThresholdCount: 3,
                },
                // See our comment on `stopTimeout`. File upload processing is potentially quite
                // slow so we need to increase the deregistration delay to make sure we don't
                // close connections that are still uploading during a deploy.
                deregistrationDelay: Duration.millis(fileProcessorTimeoutMs),
            },
        );

        return {fileProcessorServiceTargetGroup};
    }
}

/**
 * Return the vCPU count for the given AWS EC2 instance type. Unfortunately
 * this information isn't available in the AWS CDK so we have to hard code it
 * based on the [documentation][1].
 *
 * [1]: https://aws.amazon.com/ec2/instance-types/
 */
function getInstanceTypeVCpuCount(instanceType: InstanceType): number {
    const instanceTypeString = instanceType.toString();

    switch (instanceTypeString) {
        case "t4g.micro":
        case "t4g.small":
        case "t4g.medium":
        case "t4g.large":
            return 2;
        case "t4g.xlarge":
            return 4;
        case "t4g.2xlarge":
            return 8;
        case "m7g.medium":
            return 1;
        case "m7g.large":
            return 2;
        case "m7g.xlarge":
            return 4;
        case "m7g.2xlarge":
            return 8;
        case "c7g.medium":
            return 1;
        case "c7g.large":
            return 2;
        case "c7g.xlarge":
            return 4;
        case "c7g.2xlarge":
            return 8;
        case "r7g.medium":
            return 1;
        case "r7g.large":
            return 2;
        case "r7g.xlarge":
            return 4;
        case "r7g.2xlarge":
            return 8;
        default: {
            throw new InternalError(
                quote`Unknown vCPU count for instance type ${instanceTypeString}, please update \`getInstanceTypeVCpuCount()\` to handle this instance type`,
            );
        }
    }
}
