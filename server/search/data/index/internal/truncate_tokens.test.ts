import {CohereEmbedEnglishV3LanguageTokenizer} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_tokenizer.js";
import {truncateTokens} from "~/server/search/data/index/internal/truncate_tokens.js";

test("truncates document titles appropriately", async () => {
    const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

    expect(truncateTokens(tokenizer, "The quick brown fox jumps over the lazy dog", 16)).toEqual(
        "The quick brown fox jumps over the lazy dog",
    );

    expect(
        truncateTokens(
            tokenizer,
            "How we\u2019re designing our personal task management product",
            16,
        ),
    ).toEqual("How we\u2019re designing our personal task management product");

    // https://www.theverge.com/23966325/openai-sam-altman-fired-turmoil-chatgpt
    expect(
        truncateTokens(
            tokenizer,
            "Turmoil at OpenAI: after firing Sam Altman, what\u2019s next for the creators of ChatGPT?",
            16,
        ),
    ).toEqual("Turmoil at OpenAI: after firing Sam Altman, what\u2019s next…");
});
