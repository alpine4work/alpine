import {jest} from "@jest/globals";
import {SupportedBedrockModel} from "~/server/language_models/supported_bedrock_model.js";
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
const {generateTextFromLanguageModel} = await import("./generate_text_from_language_model.js");

afterEach(() => {
    jest.clearAllMocks();
});

describe("generateTextFromLanguageModel", () => {
    test("should forward the request to Bedrock and return the extracted text", async () => {
        const {span, finishSpan} = testTracer.startSpan("Test generate text");
        languageModelsBedrockConverseMock.mockResolvedValue({
            response: {output: {message: {content: []}}},
            usage: {inputTokens: 10, outputTokens: 4, totalTokens: 14},
        });
        extractTextFromLanguageModelsBedrockConverseResponseMock.mockReturnValue(
            "hello from gemma",
        );

        try {
            const result = await generateTextFromLanguageModel({
                inferenceConfig: {
                    maxTokens: 42,
                    temperature: 0.2,
                },
                messages: [{content: [{text: "Say hello"}], role: "user"}],
                model: testBedrockModel,
                system: "You are terse.",
                tracer: span,
            });

            expect(result).toMatchObject({text: "hello from gemma"});
            expect(languageModelsBedrockConverseMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    inferenceConfig: {
                        maxTokens: 42,
                        temperature: 0.2,
                    },
                    messages: [{content: [{text: "Say hello"}], role: "user"}],
                    model: testBedrockModel,
                    system: "You are terse.",
                    tracer: span,
                }),
            );
        } finally {
            finishSpan();
        }
    });
});
