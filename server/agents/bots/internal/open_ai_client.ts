import OpenAi, {APIConnectionTimeoutError, APIError} from "openai";
import {SupportedAgentModels} from "~/server/agents/bots/internal/supported_agent_models.js";
import {InternalError, UnknownError} from "~/shared/error/error.open_source.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.open_source.js";
import {TracerBase} from "~/shared/tracer/tracer_base.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

const retryableResponseErrorCodes: ReadonlySet<OpenAi.Responses.ResponseError["code"]> = new Set([
    "rate_limit_exceeded",
    "server_error",
]);

export interface OpenAiClientInterface {
    createResponse(
        tracer: TracerBase,
        body: OpenAi.Responses.ResponseCreateParamsNonStreaming,
    ): Promise<OpenAi.Responses.Response>;

    createResponseWithStreaming(
        tracer: TracerBase,
        body: OpenAi.Responses.ResponseCreateParamsStreaming & {
            model: SupportedAgentModels["openai"];
        },
    ): AsyncIterableIterator<{
        span: TracerSpan;
        event: OpenAi.Responses.ResponseStreamEvent;
    }>;
}

export class OpenAiClient implements OpenAiClientInterface {
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
    ): AsyncIterableIterator<{
        span: TracerSpan;
        event: OpenAi.Responses.ResponseStreamEvent;
    }> {
        const {span: parentSpan, finishSpan} = tracer.startSpan(
            "OpenAI create response (streaming)",
        );

        parentSpan.addData({
            openai: {
                model: body.model,
                responses: {
                    promptCacheKey: body.prompt_cache_key,
                    safetyIdentifier: body.safety_identifier,
                },
            },
        });

        const outputItemSpanByIndex = new Map<number, {span: TracerSpan; finishSpan: () => void}>();

        const reasoningSummaryPartSpanById = new Map<
            string,
            {span: TracerSpan; finishSpan: () => void}
        >();

        try {
            const responseStream = await retryWithExponentialBackoff(
                async retry => {
                    try {
                        // TODO: Re-enable `@typescript-eslint/return-await` after
                        // deciding whether this `try`/`catch` should handle async
                        // OpenAI request failures.
                        // eslint-disable-next-line @typescript-eslint/return-await
                        return this._client.responses.create(body, {
                            // NOTE(ifitzsimmons, 2026-01-13): We've had several instances where the agent ran
                            // for 15 minutes [1] while stuck waiting for a response from OpenAI (which
                            // allegedly sets a default of 10 minutes). Ultimately, OpenAI connection timeouts
                            // will lead to "dropped" requests because the maximum durable object execution
                            // time is 15 minutes (e.g. the durable object dies while waiting on a response
                            // from OpenAI).
                            //
                            // By adding a hard 2 minute timeout, we can avoid this issue. If OpenAI doesn't
                            // respond within 2 minutes, it will throw a retryable `APIConnectionTimeoutError`
                            //
                            // [1]:
                            //     https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/9edwdyz9r9h7aeqpnbd152a0y0
                            timeout: 120_000, // 2 minutes
                        });
                    } catch (error) {
                        if (error instanceof APIError && isRetryableApiError(error)) {
                            throw retry(error);
                        }

                        throw error;
                    }
                },
                {maxAttemptCount: 3},
            );

            for await (const event of responseStream) {
                let span = parentSpan;

                // Set the span as the output item's if one exists.
                if (hasOwnProperty(event, "output_index")) {
                    span = outputItemSpanByIndex.get(event.output_index)?.span ?? span;
                }

                // Set the span as the reasoning summary's if one exists.
                if (hasOwnProperty(event, "item_id")) {
                    span = reasoningSummaryPartSpanById.get(event.item_id)?.span ?? span;
                }

                // Set this to finish a span after yielding.
                let finishSpan: (() => void) | null = null;

                switch (event.type) {
                    case "error": {
                        throw new UnknownError(`OpenAI \`${event.code}\`: ${event.message}`, {
                            cause: event,
                        });
                    }
                    case "response.output_item.added": {
                        assert(!outputItemSpanByIndex.has(event.output_index));

                        const childSpan = span.startSpan(`OpenAI output item ${event.item.type}`);
                        span = childSpan.span;

                        outputItemSpanByIndex.set(event.output_index, childSpan);
                        break;
                    }
                    case "response.output_item.done": {
                        ({finishSpan} = assertExists(
                            outputItemSpanByIndex.get(event.output_index),
                        ));
                        outputItemSpanByIndex.delete(event.output_index);
                        break;
                    }
                    case "response.reasoning_summary_part.added": {
                        assert(!reasoningSummaryPartSpanById.has(event.item_id));

                        const childSpan = span.startSpan("OpenAI reasoning summary part");
                        span = childSpan.span;

                        reasoningSummaryPartSpanById.set(event.item_id, childSpan);
                        break;
                    }
                    case "response.reasoning_summary_part.done": {
                        ({finishSpan} = assertExists(
                            reasoningSummaryPartSpanById.get(event.item_id),
                        ));
                        reasoningSummaryPartSpanById.delete(event.item_id);
                        break;
                    }
                    case "response.completed": {
                        const {response} = event;

                        parentSpan.addData({
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

                try {
                    yield {span, event};
                } finally {
                    finishSpan?.();
                }
            }
        } catch (error) {
            parentSpan.addException(error);
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
// [2]:
//     https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/t6adyjshd5qaq256ks12yp395w
// [3]:
//     https://platform.openai.com/docs/guides/error-codes#python-library-error-types
function isRetryableApiError(error: APIError): boolean {
    // Looking at the OpenAI source code, it looks like this exception is not given a
    // status, so we check for it outside of the switch statement.
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
