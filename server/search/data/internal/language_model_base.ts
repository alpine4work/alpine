/**
 * Interface for a large language model. Useful if we want to test different
 * models with our data.
 */
export interface LanguageModelBase {
    readonly idealMaxEmbedTokenCount: number;
    countTokens(text: string): number;
}
