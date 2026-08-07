import {jest} from "@jest/globals";
import {SupportedBedrockModel} from "~/server/language_models/supported_bedrock_model.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {Schema} from "~/shared/schema/schema.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const testBedrockModel: SupportedBedrockModel = "google.gemma-3-12b-it";

const sendLanguageModelsBedrockConverseRequestWithBearerTokenMock: jest.MockedFunction<
    (options: unknown) => Promise<unknown>
> = jest.fn();

jest.unstable_mockModule("./internal/bedrock_converse_development.js", () => ({
    sendLanguageModelsBedrockConverseRequestWithBearerToken:
        sendLanguageModelsBedrockConverseRequestWithBearerTokenMock,
}));

// Must be dynamically imported after the mock is set up.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _bedrockConverseDevelopmentModule =
    await import("./internal/bedrock_converse_development.js");
const {LanguageModelsDevelopmentContextModule} =
    await import("./language_models_development_context_module.js");

afterEach(() => {
    jest.clearAllMocks();
});

describe("LanguageModelsDevelopmentContextModule", () => {
    test("should use the bearer-token transport for text generation", async () => {
        sendLanguageModelsBedrockConverseRequestWithBearerTokenMock.mockResolvedValue({
            response: {output: {message: {content: [{text: "hello from gemma"}]}}},
            usage: {inputTokens: 10, outputTokens: 4, totalTokens: 14},
        });

        const context = Context.new({
            languageModels: new LanguageModelsDevelopmentContextModule({
                awsBedrockTokenForDevelopment: "test-token",
            }),
            tracer: new TracerContextModule(testTracer),
        });

        const result = await context.languageModels.generateText({
            messages: [{content: [{text: "Say hello"}], role: "user"}],
            model: testBedrockModel,
        });

        expect(result).toMatchObject({text: "hello from gemma"});
        expect(sendLanguageModelsBedrockConverseRequestWithBearerTokenMock).toHaveBeenCalledWith(
            expect.objectContaining({
                awsBedrockTokenForDevelopment: "test-token",
                messages: [{content: [{text: "Say hello"}], role: "user"}],
                model: testBedrockModel,
                tracer: expect.anything(),
            }),
        );
    });

    test("should use the bearer-token transport for object generation", async () => {
        sendLanguageModelsBedrockConverseRequestWithBearerTokenMock.mockResolvedValue({
            response: {
                output: {
                    message: {
                        content: [
                            {
                                text: JSON.stringify({description: "A cat", tags: ["cat"]}),
                            },
                        ],
                    },
                },
            },
            usage: {inputTokens: 12, outputTokens: 6, totalTokens: 18},
        });

        const context = Context.new({
            languageModels: new LanguageModelsDevelopmentContextModule({
                awsBedrockTokenForDevelopment: "test-token",
            }),
            tracer: new TracerContextModule(testTracer),
        });

        const result = await context.languageModels.generateObject({
            messages: [{content: [{text: "Describe this image"}], role: "user"}],
            model: testBedrockModel,
            schema: Schema.object({
                description: Schema.string,
                tags: Schema.array(Schema.string),
            }),
        });

        expect(result).toMatchObject({
            object: {description: "A cat", tags: ["cat"]},
            text: JSON.stringify({description: "A cat", tags: ["cat"]}),
        });
        expect(sendLanguageModelsBedrockConverseRequestWithBearerTokenMock).toHaveBeenCalledWith(
            expect.objectContaining({
                awsBedrockTokenForDevelopment: "test-token",
                model: testBedrockModel,
                tracer: expect.anything(),
            }),
        );
    });
});
