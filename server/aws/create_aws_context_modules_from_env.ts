import {createAwsClientFromEnv} from "~/server/aws/create_aws_client_from_env";
import {DynamoContextModule} from "~/server/dynamo/dynamo_context_module";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base";
import {NoopEmailContextModule} from "~/server/emails/noop_email_context_module";
import {SesEmailContextModule} from "~/server/emails/ses_email_context_module";

/**
 * Create the context modules that depend on AWS from an environment object
 * passed into a Cloudflare Worker.
 */
export function createAwsContextModulesFromEnv(env: {
    AWS_ACCESS_KEY_ID?: string;
    AWS_SECRET_ACCESS_KEY?: string;
}): {
    dynamo: DynamoContextModule;
    email: EmailContextModuleBase;
} {
    const awsClient = createAwsClientFromEnv(env);

    return {
        dynamo: new DynamoContextModule(
            awsClient,
            awsClient.accessKeyId !== "localstack"
                ? "https://dynamodb.us-east-1.amazonaws.com"
                : "http://127.0.0.1:4566",
        ),
        email:
            awsClient.accessKeyId !== "localstack"
                ? new SesEmailContextModule(awsClient)
                : new NoopEmailContextModule(),
    };
}
