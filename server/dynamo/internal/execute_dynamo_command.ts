import {AwsClient} from "aws4fetch";
import {classifyDynamoError} from "~/server/dynamo/internal/classify_dynamo_error";
import {TracerSpan} from "~/shared/tracer/tracer_span";

/**
 * Low-level function for executing DynamoDB command.
 */
export async function executeDynamoCommand<Input = never, Output = unknown>(
    span: TracerSpan | null,
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

        if (typeof output.__type === "string") {
            span?.addData({
                dynamodb: {
                    exception: {
                        type: output.__type,
                        cancellationReasons: output.CancellationReasons
                            ? JSON.stringify(output.CancellationReasons)
                            : undefined,
                    },
                },
            });
        }

        throw classifyDynamoError(output);
    }

    return output;
}
