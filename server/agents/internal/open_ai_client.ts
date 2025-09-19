import OpenAi from "openai";
import {UnknownError} from "~/shared/error/error.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

export class OpenAiClient {
    private readonly _tracer: TracerBase;
    private readonly _client: OpenAi;

    constructor(tracer: TracerBase, {apiKey}: {apiKey: string}) {
        this._tracer = tracer;
        this._client = new OpenAi({apiKey});
    }

    public createResponse(body: OpenAi.Responses.ResponseCreateParamsNonStreaming) {
        return this._tracer.withSpan("OpenAI create response", async span => {
            span.addData({
                openai: {
                    model: body.model,
                    responses: {
                        promptCacheKey: body.prompt_cache_key,
                        safetyIdentifier: body.safety_identifier,
                    },
                },
            });

            const response = await this._client.responses.create({
                ...body,
                // Never store the response. We don't want OpenAI to hold onto customer data
                // longer than necessary.
                store: false,
            });

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
}
