import {ContentBlock, InferenceConfiguration, Message} from "@aws-sdk/client-bedrock-runtime";
import {SupportedBedrockModel} from "~/server/language_models/supported_bedrock_model.js";
import {SchemaWithoutValidation} from "~/shared/schema/schema.js";

export type LanguageModelsMessage = Message;
export type LanguageModelsInferenceConfig = InferenceConfiguration;
export type LanguageModelsContentBlock = ContentBlock;

export type LanguageModelsGenerateTextOptions = {
    readonly signal?: AbortSignal;
    readonly inferenceConfig?: LanguageModelsInferenceConfig;
    readonly messages: Array<LanguageModelsMessage>;
    readonly model: SupportedBedrockModel;
    readonly system?: string;
};

export type LanguageModelsGenerateTextResult = {
    readonly text: string;
};

export type LanguageModelsGenerateObjectOptions<ObjectType> = LanguageModelsGenerateTextOptions & {
    readonly schema: SchemaWithoutValidation<ObjectType>;
};

export type LanguageModelsGenerateObjectResult<ObjectType> = {
    readonly object: ObjectType;
    readonly text: string;
};
