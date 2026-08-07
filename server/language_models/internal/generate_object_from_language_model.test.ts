import {jest} from "@jest/globals";
import {SupportedBedrockModel} from "~/server/language_models/supported_bedrock_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {Schema} from "~/shared/schema/schema.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const testBedrockModel: SupportedBedrockModel = "google.gemma-3-12b-it";

const languageModelsBedrockConverseMock: jest.MockedFunction<(input: unknown) => Promise<unknown>> =
    jest.fn();
const extractTextFromLanguageModelsBedrockConverseResponseMock: jest.MockedFunction<
    (response: unknown) => string
> = jest.fn();

jest.unstable_mockModule("./bedrock_converse.js", () => ({
    extractTextFromLanguageModelsBedrockConverseResponse:
        extractTextFromLanguageModelsBedrockConverseResponseMock,
    getLanguageModelsBedrockSupportedAwsRegionIfExists: () => "us-east-1",
    languageModelsBedrockConverse: languageModelsBedrockConverseMock,
}));

// Must be dynamically imported after the mock is set up.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _languageModelsBedrockConverseModule = await import("./bedrock_converse.js");
const {generateObjectFromLanguageModel} = await import("./generate_object_from_language_model.js");

afterEach(() => {
    jest.clearAllMocks();
});

describe("generateObjectFromLanguageModel", () => {
    test("should prefix the system prompt with schema instructions and deserialize the result", async () => {
        const {span, finishSpan} = testTracer.startSpan("Test generate object");
        const objectSchema = Schema.object({
            description: Schema.string.trim(),
            tags: Schema.array(Schema.string.trim()).minLength(1),
        });
        const responseJson = JSON.stringify({
            description: "A cat on a couch",
            tags: ["cat", "couch"],
        });
        const objectTypeFragment = JSON.stringify({type: "Object"}).slice(1, -1);

        languageModelsBedrockConverseMock.mockResolvedValue({
            response: {output: {message: {content: []}}},
            usage: {inputTokens: 12, outputTokens: 8, totalTokens: 20},
        });
        extractTextFromLanguageModelsBedrockConverseResponseMock.mockReturnValue(
            `\`\`\`json\n${responseJson}\n\`\`\``,
        );

        try {
            const result = await generateObjectFromLanguageModel({
                inferenceConfig: {maxTokens: 120},
                messages: [
                    {
                        content: [{text: "Analyze this image."}],
                        role: "user",
                    },
                ],
                model: testBedrockModel,
                schema: objectSchema,
                system: "Respond for search indexing.",
                tracer: span,
            });

            expect(result).toMatchObject({
                object: {
                    description: "A cat on a couch",
                    tags: ["cat", "couch"],
                },
                text: `\`\`\`json\n${responseJson}\n\`\`\``,
            });
            expect(languageModelsBedrockConverseMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    inferenceConfig: {maxTokens: 120},
                    messages: [{content: [{text: "Analyze this image."}], role: "user"}],
                    model: testBedrockModel,
                    system: expect.stringContaining(
                        "Return only JSON that deserializes with the Alpine schema description below.",
                    ),
                    tracer: span,
                }),
            );
            const languageModelsBedrockConverseCall = assertExists(
                languageModelsBedrockConverseMock.mock.calls[0],
            );
            const languageModelsBedrockConverseInput = languageModelsBedrockConverseCall[0] as {
                readonly system: string;
            };
            expect(languageModelsBedrockConverseInput.system).toContain(
                "Respond for search indexing.",
            );
            expect(languageModelsBedrockConverseInput.system).toContain(objectTypeFragment);
        } finally {
            finishSpan();
        }
    });
});
