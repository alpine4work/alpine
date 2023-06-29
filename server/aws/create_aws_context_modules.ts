import {createAwsClient} from "~/server/aws/create_aws_client.js";
import {DynamoContextModule} from "~/server/dynamo/dynamo_context_module.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {NoopEmailContextModule} from "~/server/emails/noop_email_context_module.js";
import {SesEmailContextModule} from "~/server/emails/ses_email_context_module.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

/**
 * Create the context modules that depend on AWS from an environment object
 * passed into a Cloudflare Worker.
 */
export function createAwsContextModules({
    awsAccessKeyId,
    awsSecretAccessKey,
    dynamoLocalPort,
}: {
    awsAccessKeyId: string | undefined;
    awsSecretAccessKey: string | undefined;
    dynamoLocalPort: string | undefined;
}): {
    dynamo: DynamoContextModule;
    email: EmailContextModuleBase;
} {
    const awsClient = createAwsClient({
        awsAccessKeyId,
        awsSecretAccessKey,
    });

    return {
        dynamo: DynamoContextModule.new(
            awsClient,
            awsClient.accessKeyId !== "local"
                ? "https://dynamodb.us-east-1.amazonaws.com"
                : `http://localhost:${parseInt(
                      assertExists(
                          dynamoLocalPort,
                          "DynamoDB local port must be provided when running DynamoDB locally",
                      ),
                      10,
                  )}`,
        ),
        email:
            awsClient.accessKeyId !== "local"
                ? new SesEmailContextModule(awsClient)
                : new NoopEmailContextModule(),
    };
}
