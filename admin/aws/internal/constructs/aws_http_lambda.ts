import {ParamsAndSecretsLayerVersion, ParamsAndSecretsVersions} from "aws-cdk-lib/aws-lambda";
import {ISecret} from "aws-cdk-lib/aws-secretsmanager";
import {Construct} from "constructs";
import {AwsLambda, AwsLambdaOptions} from "~/admin/aws/internal/constructs/aws_lambda.js";

export interface AwsHttpLambdaOptions extends Omit<AwsLambdaOptions, "deploymentType"> {
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
export class AwsHttpLambda extends AwsLambda {
    constructor(scope: Construct, id: string, options: AwsHttpLambdaOptions) {
        super(scope, id, {
            ...options,
            deploymentType: "container",
            environment: {
                ...options.environment,
                SECRETS_ARN: options.secret.secretArn,
            },
            currentVersionOptions: {
                provisionedConcurrentExecutions: options.provisionedConcurrentExecutions,
            },
            // Lambda recommends leveraging their extensions framework for getting secrets from
            // SecretsManager. It caches secrets and speeds up cold start times.
            // https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets_lambda.html
            //
            // NOTE(ifitzsimmons, 2025-08-14): The behavior with respect to secret rotation is
            // a bit unclear to me. This is the relevant passage from the docs:
            //
            // > When your function requests a secret, the extension first checks its cache.
            // If the secret is available and hasn't expired, it's returned immediately. Otherwise,
            // the extension retrieves it from Secrets Manager, caches it, and then returns it to
            // your function. This caching mechanism results in faster response times and reduced
            // costs by minimizing API calls to Secrets Manager. However, that only applies if
            // the secret has a long TTL. If the secret is rotated frequently, the extension will
            // have to retrieve the secret from Secrets Manager on every request, which will
            // defeat the purpose of the extension.
            //
            // Regarding "the secret is available and hasn't expired", I'm not sure what it means
            // for it to be available and not expired. Does it just mean that the secret is
            // available in the cache? And then there's this section that doesn't really help clear
            // this up: https://docs.aws.amazon.com/lambda/latest/dg/with-secrets-manager.html#lambda-secrets-manager-rotation
            // I don't believe we rotate our secrets at time of writing, so I think we should
            // follow the recommendation to use the Secrets extension, but this is worth keeping
            // an eye on.
            //
            // I also can't seem to find any information on what happens if you deploy this with a
            // container-based Lambda. Biasing toward shipping with ResizeFile lambda and testing
            // it there since it is not currently serving any traffic.
            paramsAndSecrets: ParamsAndSecretsLayerVersion.fromVersion(
                ParamsAndSecretsVersions.V1_0_103,
                // Use default options https://docs.aws.amazon.com/lambda/latest/dg/with-secrets-manager.html#lambda-secrets-manager-env-vars
            ),
        });

        // Grant the Lambda function permission to read the secret
        options.secret.grantRead(this.executionRole);
    }
}
