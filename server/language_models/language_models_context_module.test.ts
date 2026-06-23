import {jest} from "@jest/globals";
import {LanguageModelBase} from "~/server/language_models/core/language_model_base.js";
import {SupportedBedrockModel} from "~/server/language_models/supported_bedrock_model.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const testBedrockModel: SupportedBedrockModel = "google.gemma-3-12b-it";
const testEmbeddingModelStatics = {
    dimensionCount: 2,
    dimensionDataType: "float",
    key: "allMiniLmL6V2",
    opensearchSpaceType: "cosinesimil",
} as const;

const generateTextFromLanguageModelMock: jest.MockedFunction<
    (options: unknown) => Promise<unknown>
> = jest.fn();

jest.unstable_mockModule("./internal/generate_text_from_language_model.js", () => ({
    generateTextFromLanguageModel: generateTextFromLanguageModelMock,
}));

// Must be dynamically imported after the mock is set up.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _generateTextFromLanguageModelModule =
    await import("./internal/generate_text_from_language_model.js");
const {LanguageModelsContextModule} = await import("./language_models_context_module.js");
const {LanguageModelsNoopDevelopmentContextModule} =
    await import("./language_models_noop_development_context_module.js");

afterEach(() => {
    jest.clearAllMocks();
});

describe("LanguageModelsContextModule", () => {
    test("should delegate embeddings to the configured embedding model", async () => {
        const embed = jest.fn<LanguageModelBase["embed"]>().mockResolvedValue([[1, 2]]);
        const context = Context.new({
            languageModels: new LanguageModelsContextModule({
                embeddingModel: {
                    embed,
                    statics: testEmbeddingModelStatics,
                },
            }),
            tracer: new TracerContextModule(testTracer),
        });

        const result = await context.languageModels.embed(["hello"], {inputType: "SearchQuery"});

        expect({
            key: context.languageModels.getEmbeddingModelKey(),
            result,
        }).toMatchObject({
            key: "allMiniLmL6V2",
            result: [[1, 2]],
        });
        expect(embed).toHaveBeenCalledWith(expect.anything(), ["hello"], {
            inputType: "SearchQuery",
        });
    });

    test("should delegate text generation to the shared helper", async () => {
        generateTextFromLanguageModelMock.mockResolvedValue({text: "hello from gemma"});

        const context = Context.new({
            languageModels: new LanguageModelsContextModule(),
            tracer: new TracerContextModule(testTracer),
        });

        const result = await context.languageModels.generateText({
            messages: [{content: [{text: "Say hello"}], role: "user"}],
            model: testBedrockModel,
        });

        expect(result).toMatchObject({text: "hello from gemma"});
        expect(generateTextFromLanguageModelMock).toHaveBeenCalledWith(
            expect.objectContaining({
                messages: [{content: [{text: "Say hello"}], role: "user"}],
                model: testBedrockModel,
                tracer: expect.anything(),
            }),
        );
    });

    test("should return empty text from the noop module", async () => {
        const module = new LanguageModelsNoopDevelopmentContextModule();
        await expect(
            module.generateText({messages: [], model: testBedrockModel}),
        ).resolves.toMatchObject({text: ""});
    });
});
