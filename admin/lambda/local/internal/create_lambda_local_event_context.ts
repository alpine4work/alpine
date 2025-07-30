import {Context as LambdaContext} from "aws-lambda";
import {createLambdaEventMockWithUnimplementedErrors} from "~/admin/lambda/local/internal/create_lambda_event_mock_with_unimplemented_errors.js";

export function createLambdaLocalEventContext({
    functionName,
    requestId,
    timeoutMs,
}: {
    functionName: string;
    requestId: string;
    timeoutMs: number;
}): LambdaContext {
    const now = new Date();
    const timeoutTime = now.getTime() + timeoutMs;

    // Create the base context object with implemented properties
    const implementedContextProperties: Partial<LambdaContext> = {
        functionName,
        awsRequestId: requestId,
        getRemainingTimeInMillis: () => Math.max(timeoutTime - Date.now(), 0),
    };

    return createLambdaEventMockWithUnimplementedErrors(
        implementedContextProperties,
        "LambdaContext",
    );
}
