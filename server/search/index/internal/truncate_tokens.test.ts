import {CohereEnglishLightLanguageModel} from "~/server/search/index/internal/cohere_english_light_language_model.js";
import {truncateTokens} from "~/server/search/index/internal/truncate_tokens.js";

test("truncates document titles appropriately", async () => {
    const model = await CohereEnglishLightLanguageModel.get();

    expect(truncateTokens(model, "The quick brown fox jumps over the lazy dog", 16)).toEqual(
        "The quick brown fox jumps over the lazy dog",
    );

    expect(
        truncateTokens(model, "How we’re designing our personal task management product", 16),
    ).toEqual("How we’re designing our personal task management product");

    // https://www.theverge.com/23966325/openai-sam-altman-fired-turmoil-chatgpt
    expect(
        truncateTokens(
            model,
            "Turmoil at OpenAI: after firing Sam Altman, what’s next for the creators of ChatGPT?",
            16,
        ),
    ).toEqual("Turmoil at OpenAI: after firing Sam Altman, what’s next…");
});
