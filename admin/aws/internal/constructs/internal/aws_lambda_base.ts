import {IVpc} from "aws-cdk-lib/aws-ec2";
import {TarballImageAsset} from "aws-cdk-lib/aws-ecr-assets";
import {Grant, IGrantable, IRole, ManagedPolicy, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {
    Architecture,
    Code,
    DockerImageCode,
    DockerImageFunction,
    FunctionProps,
    Function as LambdaFunctionBase,
    Runtime,
} from "aws-cdk-lib/aws-lambda";
import {RetentionDays} from "aws-cdk-lib/aws-logs";
import {Construct} from "constructs";
import {join as joinPath} from "path";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {quote} from "~/shared/helpers/string/quote.js";

export interface AwsLambdaBaseOptions
    extends Omit<FunctionProps, "code" | "handler" | "runtime" | "architecture" | "vpc"> {
    /**
     * Lambda + VPC guidance
     *
     * Default: **Do NOT attach a Lambda to a VPC** unless it must reach private resources
     * (e.g., RDS, ElastiCache in private subnets, internal ALBs). VPC attachment adds
     * NAT/proxy requirements and cost for public internet egress.
     *
     * When to attach to a VPC
     * - The function must access resources that are only reachable inside our VPC
     *   (e.g., RDS, internal services on private subnets).
     */
    // NOTE(ifitzsimmons, 08/20/2025, ##deploy-lambdas-without-vpc): Lambda functions never
    // receive public IPs. If placed in a VPC and they need internet access, provision NAT
    // (Gateway or instance) or an egress proxy. The upside is stronger egress control (no
    // internet by default), the downside is cost and system complexity.
    //
    // Our HTTP Lambdas behind ALB: when an ALB target group is of type "lambda", the ALB
    // invokes the function via the Lambda service. This works whether or not the function
    // is attached to a VPC; the ALB's own VPC networking does not determine Lambda reachability.
    //
    // From a security standpoint, Lambdas (VPC or not) have no inbound network exposure (invocation-only).
    // By contrast, ECS tasks with public IPs are internet-reachable unless locked down with
    // security groups/NACLs/WAF.
    readonly vpc: IVpc | null;

    /**
     * Configuration for the Bazel build rule that builds the Lambda function
     *
     * example for //server/files/processor:resize_file_lambda
     * ```
     * {
     *     bazelTarget: "//server/files/processor:resize_file_lambda",
     *     handlerFilePath: "lambda/resize_file_lambda",
     * }
     * ```
     */
    readonly bazelConfiguration: {
        /** Bazel target for the Lambda function */
        readonly bazelTarget: string;

        /** Relative path to the handler file from the BUILD file */
        readonly handlerFilePath: string;
    };

    readonly sqs: AwsSqs;

    readonly cloudflareAccountId: string;

    /**
     * Deployment type - determines whether to use ZIP archive or container image
     * - "container": Container image deployment (default)
     * - "zip": Traditional ZIP-based deployment
     *
     * For container deployments, use the `aws_lambda` rule.
     * For zip deployments, use `aws_lambda_deprecated`.
     */
    readonly deploymentType?: "zip" | "container";

    // NOTE(ifitzsimmons, 2025-09-07): Expose Honeycomb API key as environment variable
    // to enable tracing from Lambda startup. This allows us to trace Lambda
    // initialization and async resource allocation (secrets, tokens) instead of
    // waiting until after secrets are retrieved from AWS Secrets Manager.
    //
    // You can set this to `null` if you don't need tracing from Lambda startup.
    readonly honeycombApiKey: string | null;
}

/**
 * A construct that wraps the AWS CDK LambdaFunction and deploys Container-based Lambdas
 * by default.
 */
export class AwsLambdaBase extends Construct {
    protected readonly _lambdaFunction: LambdaFunctionBase;

    protected readonly _executionRole: IRole;

    constructor(scope: Construct, id: string, options: AwsLambdaBaseOptions) {
        super(scope, id);

        this._executionRole = new Role(this, "ExecutionRole", {
            assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
                ManagedPolicy.fromAwsManagedPolicyName(
                    "service-role/AWSLambdaVPCAccessExecutionRole",
                ),
            ],
        });

        this._lambdaFunction = (() => {
            const deploymentType = options.deploymentType ?? "container";
            switch (deploymentType) {
                case "zip":
                    return this._createBasicLambdaFunction(options);
                case "container":
                    return this._createContainerLambdaFunction(options);
                default:
                    throw new InvalidArgumentError(
                        quote`Invalid deployment type: ${deploymentType}`,
                    );
            }
        })();
    }

    public get executionRole(): IRole {
        return this._executionRole;
    }

    public grantInvoke(grantee: IGrantable): Grant {
        return this._lambdaFunction.grantInvoke(grantee);
    }

    private _createBasicLambdaFunction(options: AwsLambdaBaseOptions) {
        const {bazelTarget} = options.bazelConfiguration;
        const {buildFilePath, targetName} =
            this._getBazelFilePathAndTargetNameFromTarget(bazelTarget);

        const lambdaZipRelativePath =
            process.env.CDK_LITE === "true"
                ? "cyberworlds/admin/aws/empty_lambda"
                : `cyberworlds/${buildFilePath}/${targetName}`;

        return new LambdaFunctionBase(this, "Function", {
            ...this._getLambdaFunctionProps(options),
            role: this._executionRole,
            runtime: Runtime.NODEJS_22_X,
            code: Code.fromAsset(joinPath(runfilesPath, `${lambdaZipRelativePath}.zip`)),
            handler: `${lambdaZipRelativePath}.handler`,
            environment: {
                ...options.environment,
                ...this._getCommonEnvironmentVariables(options),
            },
        });
    }

    private _createContainerLambdaFunction(options: AwsLambdaBaseOptions) {
        const {bazelTarget} = options.bazelConfiguration;
        const {buildFilePath, targetName} =
            this._getBazelFilePathAndTargetNameFromTarget(bazelTarget);

        const relativeImageTarballPath =
            process.env.CDK_LITE === "true"
                ? "cyberworlds/admin/aws/empty_image_tarball_load"
                : // should be something like
                  // `cyberworlds/server/files/processor/resize_file_lambda_image_layers_tarball_load`
                  `cyberworlds/${buildFilePath}/${targetName}_image_layers_tarball_load`;

        const imageAsset = new TarballImageAsset(this, "ImageAsset", {
            tarballFile: joinPath(runfilesPath, `${relativeImageTarballPath}/tarball.tar`),
            displayName: `cyberworlds-${targetName}`,
        });

        return new DockerImageFunction(this, "Function", {
            ...this._getLambdaFunctionProps(options),
            code: DockerImageCode.fromEcr(imageAsset.repository, {
                tagOrDigest: imageAsset.imageTag,
            }),
            environment: {
                ...options.environment,
                ...this._getCommonEnvironmentVariables(options),
                // NOTE(#lambda-container-runfile-dir)
                RUNFILES: joinPath("/var/task", `${buildFilePath}/${targetName}_binary.runfiles`),
            },
        });
    }

    private _getCommonEnvironmentVariables(options: AwsLambdaBaseOptions) {
        return {
            NODE_ENV: "production",
            CLOUDFLARE_ACCOUNT_ID: options.cloudflareAccountId,
            JOB_QUEUE_URL: options.sqs.getJobQueueUrl(),
            FILE_PROCESSOR_JOB_QUEUE_URL: options.sqs.getFileProcessorJobQueueUrl(),
            FILE_PROCESSOR_LIGHT_JOB_QUEUE_URL: options.sqs.getFileProcessorLightJobQueueUrl(),
            FILE_PROCESSOR_HEAVY_JOB_QUEUE_URL: options.sqs.getFileProcessorHeavyJobQueueUrl(),
            EDGE_SERVICE_URL: "https://alpine.inc",
            ...(options.honeycombApiKey ? {HONEYCOMB_API_KEY: options.honeycombApiKey} : {}),
        };
    }

    private _getLambdaFunctionProps(options: AwsLambdaBaseOptions) {
        return {
            logRetention: RetentionDays.ONE_WEEK,
            // https://aws.amazon.com/blogs/apn/comparing-aws-lambda-arm-vs-x86-performance-cost-and-analysis-2/
            architecture: Architecture.ARM_64,
            deadLetterQueueEnabled: true,
            ...omitObject(options, [
                "bazelConfiguration",
                "deploymentType",
                "sqs",
                "cloudflareAccountId",
            ]),
            role: this._executionRole,
            vpc: options.vpc ?? undefined,
        };
    }

    private _getBazelFilePathAndTargetNameFromTarget(bazelTarget: string) {
        const [buildFilePath, targetName] = bazelTarget.split(":");
        return {
            buildFilePath: assertExists(buildFilePath).replace("//", ""),
            targetName: assertExists(targetName),
        };
    }
}
