import OpenAi, {APIConnectionTimeoutError, APIError} from "openai";
import {SupportedAgentModels} from "~/server/agents/internal/supported_agent_models.js";
import {InternalError, UnknownError} from "~/shared/error/error.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

const retryableResponseErrorCodes: ReadonlySet<OpenAi.Responses.ResponseError["code"]> = new Set([
    "rate_limit_exceeded",
    "server_error",
]);

export class OpenAiClient {
    private readonly _client: OpenAi;

    constructor({apiKey}: {apiKey: string}) {
        this._client = new OpenAi({apiKey});
    }

    public createResponse(
        tracer: TracerBase,
        body: OpenAi.Responses.ResponseCreateParamsNonStreaming,
    ): Promise<OpenAi.Responses.Response> {
        return tracer.withSpan("OpenAI create response", async span => {
            span.addData({
                openai: {
                    model: body.model,
                    responses: {
                        promptCacheKey: body.prompt_cache_key,
                        safetyIdentifier: body.safety_identifier,
                    },
                },
            });

            const response = await retryWithExponentialBackoff(
                async retry => {
                    try {
                        const response = await this._client.responses.create(body);

                        if (
                            response.error &&
                            retryableResponseErrorCodes.has(response.error.code)
                        ) {
                            throw retry(response.error);
                        }

                        return response;
                    } catch (error) {
                        if (error instanceof OpenAi.APIError && isRetryableApiError(error)) {
                            throw retry(error);
                        }

                        throw error;
                    }
                },
                {maxAttemptCount: 3},
            );

            span.addData({
                openai: {
                    responses: {
                        id: response.id,
                        status: response.status,
                        incompleteDetails: {reason: response.incomplete_details?.reason},
                        usage: {
                            inputTokens: response.usage?.input_tokens,
                            cachedInputTokens: response.usage?.input_tokens_details.cached_tokens,
                            outputTokens: response.usage?.output_tokens,
                            reasoningOutputTokens:
                                response.usage?.output_tokens_details.reasoning_tokens,
                            totalTokens: response.usage?.total_tokens,
                        },
                    },
                },
            });

            if (response.error) {
                throw new UnknownError(
                    `OpenAI \`${response.error.code}\`: ${response.error.message}`,
                    {cause: response.error},
                );
            }

            return response;
        });
    }

    public async *createResponseWithStreaming(
        tracer: TracerBase,
        body: OpenAi.Responses.ResponseCreateParamsStreaming & {
            model: SupportedAgentModels["openai"];
        },
    ): AsyncIterableIterator<OpenAi.Responses.ResponseStreamEvent> {
        const {span, finishSpan} = tracer.startSpan("OpenAI create response (streaming)");

        span.addData({
            openai: {
                model: body.model,
                responses: {
                    promptCacheKey: body.prompt_cache_key,
                    safetyIdentifier: body.safety_identifier,
                },
            },
        });

        const outputItemSpanByIndex = new Map<number, {span: TracerSpan; finishSpan: () => void}>();

        try {
            const responseStream = await retryWithExponentialBackoff(
                async retry => {
                    try {
                        return this._client.responses.create(body);
                    } catch (error) {
                        if (error instanceof OpenAi.APIError && isRetryableApiError(error)) {
                            throw retry(error);
                        }

                        throw error;
                    }
                },
                {maxAttemptCount: 3},
            );

            for await (const event of responseStream) {
                switch (event.type) {
                    case "error": {
                        throw new UnknownError(`OpenAI \`${event.code}\`: ${event.message}`, {
                            cause: event,
                        });
                    }
                    case "response.output_item.added": {
                        assert(!outputItemSpanByIndex.has(event.output_index));

                        outputItemSpanByIndex.set(
                            event.output_index,
                            span.startSpan(`OpenAI output item ${event.item.type}`),
                        );
                        break;
                    }
                    case "response.output_item.done": {
                        assertExists(outputItemSpanByIndex.get(event.output_index)).finishSpan();
                        outputItemSpanByIndex.delete(event.output_index);
                        break;
                    }
                    case "response.completed": {
                        const {response} = event;

                        span.addData({
                            openai: {
                                responses: {
                                    id: response.id,
                                    status: response.status,
                                    incompleteDetails: {
                                        reason: response.incomplete_details?.reason,
                                    },
                                    usage: {
                                        inputTokens: response.usage?.input_tokens,
                                        cachedInputTokens:
                                            response.usage?.input_tokens_details.cached_tokens,
                                        outputTokens: response.usage?.output_tokens,
                                        reasoningOutputTokens:
                                            response.usage?.output_tokens_details.reasoning_tokens,
                                        totalTokens: response.usage?.total_tokens,
                                    },
                                },
                            },
                        });
                        break;
                    }
                }

                yield event;
            }
        } catch (error) {
            span.addException(error);
            throw error;
        } finally {
            for (const outputItemSpan of outputItemSpanByIndex.values()) {
                outputItemSpan.span.addException(
                    new InternalError("OpenAI response completed before output item could finish"),
                );
                outputItemSpan.finishSpan();
            }

            outputItemSpanByIndex.clear();

            finishSpan();
        }
    }
}

// NOTE(ifitzsimmons, 2025-12-04): See OpenAI's error code documentation [1] You
// won't see 400s or 404s in the docs, but we saw them in the wild [2]. Typically,
// we wouldn't retry 400s or 404s as they usually indicate an issue with the
// request itself, but the errors we saw actually looked like issues on OpenAI's
// side. It's unlikely that they'll retry successfully frequently, but we retry
// them anyway just in case. Otherwise, we follow OpenAI's guidance [3] on retries.
//
// [1]: https://platform.openai.com/docs/guides/error-codes
// [2]: https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/t6adyjshd5qaq256ks12yp395w
// [3]: https://platform.openai.com/docs/guides/error-codes#python-library-error-types
function isRetryableApiError(error: APIError): boolean {
    // Looking at the OpenAI source code, it looks like this exception is not given
    // a status, so we check for it outside of the switch statement.
    if (error instanceof APIConnectionTimeoutError) return true;

    switch (error.status) {
        case 400: // APIError.BadRequestError
        case 404: // APIError.NotFoundError
        case 409: // APIError.ConflictError
        case 422: // APIError.UnprocessableEntityError
        case 429: // APIError.RateLimitError
        case 500: // APIError.InternalServerError
            return true;
        default:
            return false;
    }
}
