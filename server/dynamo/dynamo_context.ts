import {AwsContextModule} from "~/server/context/aws_context_module";
import {Context} from "~/server/context/context";

/**
 * Context with only the modules required by DynamoDB.
 */
export type DynamoContext = Context<{
    aws: AwsContextModule;
}>;
