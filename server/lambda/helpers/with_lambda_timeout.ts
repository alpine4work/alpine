import {Context as LambdaContext} from "aws-lambda";
import {DeadlineExceededError} from "~/shared/error/error.open_source.js";
import {createTimeout} from "~/shared/helpers/async/timeout.open_source.js";

// NOTE(ifitzsimmons, 2025-07-30): Because of the way the node event loop schedules
// timers, all we can do is guarantee that this will run somewhere between T and
// (T-500ms) where T is the time that the Lambda will timeout. This should be more
// than enough time to pick up the callback from the event loop and run the cleanup
// code (likely emitting an exception and finishing span)
const cleanupBufferMs = 500;

// NOTE(ifitzsimmons, 2025-07-30): One common "gotcha" when it comes to AWS Lambda
// is the mishandling of timeouts. For instance, we expect to call `finishSpan()`
// at the end of most of our processes. However, if the Lambda times out,
// finishSpan() will never be called - the Lambda will simply exit and stop the
// program wherever it is.
//
// This wrapper should always be used for our Lambda functions. It will raise a
// `DeadlineExceededError` 500 ms before the Lambda times out.
export function withLambdaTimeout<T>(
    context: LambdaContext,
    abortController: AbortController,
    processEvent: () => Promise<T>,
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timeout = createTimeout(() => {
            abortController.abort();
            reject(
                new DeadlineExceededError(
                    "Lambda execution timed out before completing the request",
                ),
            );
        }, context.getRemainingTimeInMillis() - cleanupBufferMs);

        processEvent()
            .then(
                result => resolve(result),
                error => reject(error),
            )
            .finally(() => {
                timeout.clear();
            });
    });
}
