import {
    LanguageModelsBedrockConverseResponse,
    LanguageModelsBedrockConverseResult,
    createLanguageModelsBedrockSystemBlocks,
} from "~/server/language_models/internal/bedrock_converse.js";
import {
    BedrockSupportedAwsRegion,
    bedrockSupportedAwsRegions,
    getBedrockTokenUsage,
    getBedrockTracerData,
} from "~/server/language_models/internal/bedrock_tracer_data.js";
import {LanguageModelsGenerateTextOptions} from "~/server/language_models/language_models_types.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

/**
 * Send a Bedrock `converse` request using a Bedrock API key bearer token.
 *
 * This code path is for local development only. In production we use the normal
 * AWS SDK credentials flow instead of API-key auth.
 *
 * We intentionally do not route this through `BedrockRuntimeClient`. AWS's Bedrock
 * API-key documentation shows this auth mode as a bearer-token HTTP request,
 * including an `Authorization: Bearer ...` header on the Bedrock Runtime
 * endpoint.[1] That same documentation also calls out direct HTTP requests as the
 * supported wire format for API-key usage.[1]
 *
 * [1]:
 *     https://docs.aws.amazon.com/en_us/bedrock/latest/userguide/api-keys-use.html
 */
export async function sendLanguageModelsBedrockConverseRequestWithBearerToken({
    awsBedrockTokenForDevelopment,
    inferenceConfig,
    messages,
    model,
    signal,
    system,
    tracer,
}: {
    readonly awsBedrockTokenForDevelopment: string;
    readonly tracer: TracerBase;
} & LanguageModelsGenerateTextOptions): Promise<LanguageModelsBedrockConverseResult> {
    assert(
        process.env.NODE_ENV === "development",
        "Bedrock bearer-token calls are only supported in development",
    );

    let region: BedrockSupportedAwsRegion = "us-east-1";
    if (process.env.AWS_REGION) {
        // We only allow regions that have explicit pricing/support metadata in our shared
        // Bedrock utilities. This keeps local development behavior aligned with the
        // regions we know how to reason about elsewhere.
        assert(
            bedrockSupportedAwsRegions.includes(
                process.env.AWS_REGION as BedrockSupportedAwsRegion,
            ),
            "Invalid AWS region",
        );

        region = process.env.AWS_REGION as BedrockSupportedAwsRegion;
    }

    return await tracer.withSpan("Amazon Bedrock converse", async span => {
        const result = await fetchWithTracer(
            span,
            [
                `https://bedrock-runtime.${region}.amazonaws.com/model/`,
                `${encodeURIComponent(model)}/converse`,
            ].join(""),
            {
                body: serializeLanguageModelsBedrockConverseDevelopmentRequestBody({
                    inferenceConfig,
                    messages,
                    system: createLanguageModelsBedrockSystemBlocks(system),
                }),
                fetch: globalThis.fetch,
                headers: {
                    authorization: `Bearer ${awsBedrockTokenForDevelopment}`,
                    "content-type": "application/json",
                },
                method: "POST",
                route: "/model/:modelId/converse",
                signal,
                serviceName: "FileProcessorService",
            },
            async response => {
                if (!response.ok) {
                    throw new InternalError(
                        `Bedrock bearer token request failed (${response.status}): ${await response.text()}`,
                    );
                }

                const responseJson = cast<LanguageModelsBedrockConverseResponse>(
                    await response.json(),
                );
                const usage = getBedrockTokenUsage(responseJson);

                return {
                    response: responseJson,
                    usage,
                };
            },
        );

        span.addData({
            bedrock: getBedrockTracerData({
                model,
                region,
                usage: result.usage,
            }),
        });

        return result;
    });
}

/**
 * Serializes the Bedrock request body for the raw development HTTP path.
 *
 * The SDK handles binary image encoding for us in production, but the direct
 * bearer-token path must base64 encode any `Uint8Array` payloads before sending
 * JSON to Bedrock.
 */
function serializeLanguageModelsBedrockConverseDevelopmentRequestBody(body: unknown): string {
    return JSON.stringify(body, (_key, value) => {
        if (value instanceof Uint8Array) {
            return Buffer.from(value).toString("base64");
        }

        return value;
    });
}
