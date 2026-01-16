import {SqsEventSource, SqsEventSourceProps} from "aws-cdk-lib/aws-lambda-event-sources";
import {ISecret} from "aws-cdk-lib/aws-secretsmanager";
import {IQueue} from "aws-cdk-lib/aws-sqs";
import {Duration} from "aws-cdk-lib/core";
import {Construct} from "constructs";
import {
    AwsLambdaBase,
    AwsLambdaBaseOptions,
} from "~/admin/aws/internal/constructs/internal/aws_lambda_base.js";

const defaultEventSourceOptions: SqsEventSourceProps = {
    batchSize: 1, // Process one message at a time
    maxBatchingWindow: Duration.seconds(0),
    reportBatchItemFailures: true,
};

export interface AwsSqsLambdaSubscriberOptions extends Omit<
    AwsLambdaBaseOptions,
    "deploymentType" | "honeycombApiKey"
> {
    /**
     * AWS Secrets Manager secret containing application secrets (API keys, database credentials, etc.)
     * The secret ARN will be passed to the Lambda via SECRETS_ARN environment variable.
     * Your Lambda code should use the AWS Secrets Manager client to retrieve secret values.
     */
    readonly secret: ISecret;

    /** The SQS queue to which the Lambda will subscribe. */
    readonly queue: IQueue;

    readonly eventSourceOptions?: SqsEventSourceProps;
    /**
     * Number of concurrent Lambda instances to keep "warm" to reduce cold start latency.
     * For async jobs (all SQS lambda functions are technically async jobs), this property should
     * be undefined. However, there are some async jobs that impact the user experience.
     *
     * For instance, when a user uploads a file, the file upload will not complete until the Lambda
     * SQS subscribers process the file -- from the user's perspective, these Lambda's are
     * synchronous.
     *
     * Note: Provisioned concurrency incurs additional costs even when not in use.
     */
    readonly provisionedConcurrentExecutions?: number;
}

/**
 * A specialized Lambda construct for subscribing to an SQS queue.
 *
 * Required Lambda Code Pattern:
 * Your Lambda function MUST be built using `createLambdaSqsSubscriptionHandler()` from
 * server/lambda helpers. This ensures proper integration with the secrets management
 * and SQS subscription.
 */
export class AwsSqsLambdaSubscriber extends AwsLambdaBase {
    constructor(scope: Construct, id: string, options: AwsSqsLambdaSubscriberOptions) {
        super(scope, id, {
            ...options,
            deploymentType: "container",
            environment: {
                ...options.environment,
                SECRET_ARN: options.secret.secretArn,
            },
            honeycombApiKey: options.secret.secretValueFromJson("honeycombApiKey").unsafeUnwrap(),
        });

        const eventHandler = options.provisionedConcurrentExecutions
            ? this._lambdaFunction.addAlias("latest", {
                  provisionedConcurrentExecutions: options.provisionedConcurrentExecutions,
              })
            : this._lambdaFunction;

        // NOTE(ifitzsimmons, 2025-09-04): I can't think of a way to ensure that the queue has
        // a DLQ set up. In the future, maybe we can make an AwsSqs construct that takes in a
        // queue name and creates a DLQ. We can then pass our custom AwsSqs construct as the
        // `queue` to this construct. For now, we'll just trust that the queue has a DLQ set up.
        eventHandler.addEventSource(
            new SqsEventSource(
                options.queue,
                options.eventSourceOptions ?? defaultEventSourceOptions,
            ),
        );

        // Grant the Lambda function permission to read the secret
        options.secret.grantRead(this.executionRole);
    }
}
