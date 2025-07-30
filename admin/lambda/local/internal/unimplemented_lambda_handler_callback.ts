import {UnimplementedError} from "~/shared/error/error.js";

// NOTE(ifitzsimmons, ##unimplemented-lambda-handler-callback)
// From the AWS Lambda runtime docs:
// https://docs.aws.amazon.com/lambda/latest/dg/nodejs-handler.html#nodejs-handler-signatures
//
// NodeJS-style completion callback that the AWS Lambda runtime will provide that can
// be used to provide the lambda result payload value, or any execution error. Can
// instead return a promise that resolves with the result payload value or rejects
// with the execution error.
//
// I believe this is a mostly outdated pattern that predates async handler support.
// We should always use the async/await pattern unless there is a strong reason not to.
export function unimplementedLambdaHandlerCallback() {
    throw new UnimplementedError("Unimplemented lambda handler callback");
}
