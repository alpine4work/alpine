import {Alias} from "aws-cdk-lib/aws-lambda";
import {ISecret} from "aws-cdk-lib/aws-secretsmanager";
import {Construct} from "constructs";
import {
    AwsLambdaBase,
    AwsLambdaBaseOptions,
} from "~/admin/aws/internal/constructs/internal/aws_lambda_base.js";

export interface AwsHttpLambdaOptions extends Omit<AwsLambdaBaseOptions, "deploymentType"> {
    /**
     * AWS Secrets Manager secret containing application secrets (API keys, database credentials, etc.)
     * The secret ARN will be passed to the Lambda via SECRETS_ARN environment variable.
     * Your Lambda code should use the AWS Secrets Manager client to retrieve secret values.
     */
    readonly secret: ISecret;

    /**
     * Number of concurrent Lambda instances to keep "warm" to reduce cold start latency.
     *
     * Recommended values:
     * - Production HTTP APIs: 5-10 (depends on traffic patterns)
     * - Background jobs: 0-2 (cold starts are usually acceptable)
     * - High-traffic APIs: 10+ (measure and adjust based on metrics)
     *
     * Note: Provisioned concurrency incurs additional costs even when not in use.
     */
    readonly provisionedConcurrentExecutions: number;
}

/**
 * A specialized Lambda construct for HTTP-facing Lambda functions. Always builds container-based
 * Lambdas.
 *
 * Required Lambda Code Pattern:
 * Your Lambda function MUST be built using `createHttpLambdaHandler()` from
 * server/lambda helpers. This ensures proper integration with the secrets management
 * and HTTP request handling.
 *
 * Secrets Extension Behavior:
 * - Secrets are cached within the Lambda execution environment
 * - Cache reduces API calls to Secrets Manager (cost optimization)
 */
export class AwsHttpLambda extends AwsLambdaBase {
    private readonly _lambdaFunctionAlias: Alias;

    constructor(scope: Construct, id: string, options: AwsHttpLambdaOptions) {
        super(scope, id, {
            ...options,
            deploymentType: "container",
            environment: {
                ...options.environment,
                SECRET_ARN: options.secret.secretArn,
            },
        });

        // Grant the Lambda function permission to read the secret
        options.secret.grantRead(this.executionRole);

        this._lambdaFunctionAlias = this._lambdaFunction.addAlias("latest", {
            provisionedConcurrentExecutions: options.provisionedConcurrentExecutions,
        });
    }

    // Use the Lambda alias instead of the function directly to take advantage of provisioned
    // concurrency. This also enables us to use canary and A/B deployments in the future.
    public get lambdaFunctionAlias(): Alias {
        return this._lambdaFunctionAlias;
    }
}
