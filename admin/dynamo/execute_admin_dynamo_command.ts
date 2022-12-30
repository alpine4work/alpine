import {AwsClient} from "aws4fetch";
import {InternalError} from "~/shared/error/error";

/**
 * Executes a DynamoDB command in admin code.
 *
 * Mostly the same as the execute function in `DynamoClientInternal` but
 * without tracing, error classification, and other production necessities.
 */
export async function executeAdminDynamoCommand<Input = never, Output = unknown>(
    client: AwsClient,
    url: string,
    command: string,
    input: Input,
): Promise<Output> {
    const response = await client.fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-amz-json-1.0",
            "X-Amz-Target": `DynamoDB_20120810.${command}`,
        },
        body: JSON.stringify(input),
    });

    const output: any = await response.json();

    if (response.status !== 200) {
        // When talking to production DynamoDB (vs local DynamoDB), error types are of
        // the form `com.amazonaws.dynamodb.v20120810#TransactionCanceledException`
        // instead of `TransactionCanceledException`. Remove the version number so we
        // just have the error type.
        if (typeof output.__type === "string" && output.__type.includes("#")) {
            output.__type = output.__type.split("#")[1];
        }

        const message = `DynamoDB ${output.__type ?? "unknown error"}${
            output.message ? `: ${output.message}` : output.Message ? `: ${output.Message}` : ""
        }`;

        throw new InternalError(message, {cause: output});
    }

    return output;
}
