import {jest} from "@jest/globals";
import {LanguageModelBase} from "~/server/language_models/core/language_model_base.js";
import {createLanguageModelsContextModuleForProcess} from "~/server/language_models/create_language_models_context_module_for_process.js";
import {LanguageModelsContextModule} from "~/server/language_models/language_models_context_module.js";
import {LanguageModelsDevelopmentContextModule} from "~/server/language_models/language_models_development_context_module.js";
import {LanguageModelsNoopDevelopmentContextModule} from "~/server/language_models/language_models_noop_development_context_module.js";

const originalNodeEnv = process.env.NODE_ENV;
const testEmbeddingModel = {
    embed: jest.fn<LanguageModelBase["embed"]>(),
    statics: {
        dimensionCount: 2,
        dimensionDataType: "float",
        key: "allMiniLmL6V2",
        opensearchSpaceType: "cosinesimil",
    },
} satisfies LanguageModelBase;

afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.clearAllMocks();
});

describe("createLanguageModelsContextModuleForProcess", () => {
    test("should use the noop module in tests", () => {
        expect(
            createLanguageModelsContextModuleForProcess({
                awsBedrockTokenForDevelopment: "test-token",
            }),
        ).toBeInstanceOf(LanguageModelsNoopDevelopmentContextModule);
    });

    test("should preserve the configured embedding model", () => {
        expect(
            createLanguageModelsContextModuleForProcess({
                embeddingModel: testEmbeddingModel,
            }).getEmbeddingModelKey(),
        ).toBe("allMiniLmL6V2");
    });

    test("should use the development module in development when a token is configured", () => {
        process.env.NODE_ENV = "development";

        expect(
            createLanguageModelsContextModuleForProcess({
                awsBedrockTokenForDevelopment: "test-token",
            }),
        ).toBeInstanceOf(LanguageModelsDevelopmentContextModule);
    });

    test("should use the IAM-backed module in production without requiring a token", () => {
        process.env.NODE_ENV = "production";

        expect(createLanguageModelsContextModuleForProcess({})).toBeInstanceOf(
            LanguageModelsContextModule,
        );
    });
});
