import {
    extractTextFromLanguageModelsBedrockConverseResponse,
    languageModelsBedrockConverse,
} from "~/server/language_models/internal/bedrock_converse.js";
import {
    LanguageModelsGenerateObjectOptions,
    LanguageModelsGenerateObjectResult,
} from "~/server/language_models/language_models_types.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {
    SchemaSerializedValue,
    SchemaWithoutValidation,
} from "~/shared/schema/schema.open_source.js";
import {serializeSchemaDescriptionToJsonSafeValue} from "~/shared/schema/schema_description_json.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

/**
 * Generate a typed object response from a shared Alpine model wrapper.
 */
export async function generateObjectFromLanguageModel<ObjectType>({
    inferenceConfig,
    messages,
    model,
    schema,
    signal,
    system,
    tracer,
}: {
    readonly tracer: TracerSpan;
} & LanguageModelsGenerateObjectOptions<ObjectType>): Promise<
    LanguageModelsGenerateObjectResult<ObjectType>
> {
    const result = await languageModelsBedrockConverse({
        inferenceConfig,
        messages,
        model,
        signal,
        system: createGenerateObjectFromLanguageModelSystemPrompt({schema, system}),
        tracer,
    });

    const text = extractTextFromLanguageModelsBedrockConverseResponse(result.response);
    return {
        object: deserializeGeneratedObjectFromLanguageModel(schema, text),
        text,
    };
}

export function createGenerateObjectFromLanguageModelSystemPrompt<ObjectType>({
    schema,
    system,
}: {
    readonly schema: SchemaWithoutValidation<ObjectType>;
    readonly system?: string;
}): string {
    const schemaJson = JSON.stringify(
        serializeSchemaDescriptionToJsonSafeValue(cast(schema.getDescription())),
    );

    return [
        "Return only JSON that deserializes with the Alpine schema description below.",
        `Schema description: ${schemaJson}`,
        system,
    ]
        .filter((part): part is string => part !== undefined)
        .join("\n\n");
}

export function deserializeGeneratedObjectFromLanguageModel<ObjectType>(
    schema: SchemaWithoutValidation<ObjectType>,
    text: string,
): ObjectType {
    return schema.deserialize(parseGeneratedObjectJson(text) as SchemaSerializedValue);
}

function parseGeneratedObjectJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        const fencedCodeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/u);
        if (fencedCodeBlockMatch !== null) {
            return JSON.parse(fencedCodeBlockMatch[1]!);
        }

        const objectMatch = text.match(/\{[\s\S]*\}/u);
        if (objectMatch !== null) {
            return JSON.parse(objectMatch[0]);
        }

        throw new InternalError("Expected LLM response to contain JSON");
    }
}
