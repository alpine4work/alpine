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

export interface AwsLambdaOptions
    extends Omit<FunctionProps, "code" | "handler" | "runtime" | "architecture"> {
    /** A VPC is required for all of our Lambdas */
    readonly vpc: IVpc;

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
}

/**
 * A construct that wraps the AWS CDK LambdaFunction and deploys Container-based Lambdas
 * by default.
 */
export class AwsLambda extends Construct {
    protected readonly _lambdaFunction: LambdaFunctionBase;

    protected readonly _executionRole: IRole;

    constructor(scope: Construct, id: string, options: AwsLambdaOptions) {
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

        const deploymentType = options.deploymentType ?? "container";
        switch (deploymentType) {
            case "zip":
                this._lambdaFunction = this._createBasicLambdaFunction(options);
                break;
            case "container":
                this._lambdaFunction = this._createContainerLambdaFunction(options);
                break;
            default:
                throw new InvalidArgumentError(quote`Invalid deployment type: ${deploymentType}`);
        }
    }

    public get executionRole(): IRole {
        return this._executionRole;
    }

    public get lambdaFunction(): LambdaFunctionBase {
        return this._lambdaFunction;
    }

    public grantInvoke(grantee: IGrantable): Grant {
        return this._lambdaFunction.grantInvoke(grantee);
    }

    private _createBasicLambdaFunction(options: AwsLambdaOptions) {
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

    private _createContainerLambdaFunction(options: AwsLambdaOptions) {
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

    private _getCommonEnvironmentVariables(options: AwsLambdaOptions) {
        return {
            NODE_ENV: "production",
            CLOUDFLARE_ACCOUNT_ID: options.cloudflareAccountId,
            JOB_QUEUE_URL: options.sqs.getJobQueueUrl(),
            FILE_PROCESSOR_JOB_QUEUE_URL: options.sqs.getFileProcessorJobQueueUrl(),
            EDGE_SERVICE_URL: "https://alpine.inc",
        };
    }

    private _getLambdaFunctionProps(options: AwsLambdaOptions) {
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
