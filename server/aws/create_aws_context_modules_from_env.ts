import {createAwsClientFromEnv} from "~/server/aws/create_aws_client_from_env";
import {DynamoContextModule} from "~/server/dynamo/dynamo_context_module";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base";
import {NoopEmailContextModule} from "~/server/emails/noop_email_context_module";
import {SesEmailContextModule} from "~/server/emails/ses_email_context_module";
import {assertExists} from "~/shared/helpers/control/assert_exists";

/**
 * Create the context modules that depend on AWS from an environment object
 * passed into a Cloudflare Worker.
 */
export function createAwsContextModulesFromEnv(env: {
    AWS_ACCESS_KEY_ID?: string;
    AWS_SECRET_ACCESS_KEY?: string;
    DYNAMO_LOCAL_PORT?: string;
}): {
    dynamo: DynamoContextModule;
    email: EmailContextModuleBase;
} {
    const awsClient = createAwsClientFromEnv(env);

    return {
        dynamo: DynamoContextModule.new(
            awsClient,
            awsClient.accessKeyId !== "local"
                ? "https://dynamodb.us-east-1.amazonaws.com"
                : `http://localhost:${parseInt(
                      assertExists(
                          env.DYNAMO_LOCAL_PORT,
                          "Environment variable `DYNAMO_LOCAL_PORT` must be set when running DynamoDB locally",
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
