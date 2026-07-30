export const supportedBedrockModels = ["google.gemma-3-12b-it", "google.gemma-3-4b-it"] as const;

export type SupportedBedrockModel = (typeof supportedBedrockModels)[number];
