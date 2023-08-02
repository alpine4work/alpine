import {DeadlineExceededError} from "~/shared/error/error.js";

const originalSetTimeout = setTimeout;

/**
 * Waits for an HTTP server to start listening at the provided host.
 *
 * This was written to wait for our development servers starting up. We don't
 * think there's a use case for this in production.
 */
export async function waitForHttpServer(host: string) {
    const url = new URL("/", host);
    const startTime = Date.now();

    let attemptNumber = 0;
    while (true) {
        attemptNumber++;

        let error;
        try {
            // eslint-disable-next-line no-global-fetch
            const response = await fetch(url, {method: "HEAD"});
            await response.text();
            break;
        } catch (_error) {
            // Ignore errors...
            error = _error;
        }

        if (Date.now() - startTime > 60 * 1000) {
            throw DeadlineExceededError.from(
                error,
                `Timed out waiting for HTTP server on port ${url.toString()}`,
            );
        }

        // If our server hasn't started, try checking again with exponential backoff.
        const delayMs = 10 ** ((attemptNumber - 1) / 100 + 1);

        // See: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter
        const delayMsWithJitter = Math.floor(Math.random() * delayMs);

        // We can't use `wait()` or `setTimeout()` since Jest will override
        // `setTimeout()` when `jest.useFakeTimers()` is on. But we want to wait the
        // timeout anyway.
        await new Promise(resolve => originalSetTimeout(resolve, delayMsWithJitter));
    }
}
