import OpenAi from "openai";
import {InternalError, UnknownError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

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

            const response = await this._client.responses.create(body);

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
        body: OpenAi.Responses.ResponseCreateParamsStreaming,
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
            const responseStream = await this._client.responses.create(body);

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
