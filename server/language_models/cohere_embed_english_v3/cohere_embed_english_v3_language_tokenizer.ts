// Only import types from `@xenova/transformers`. We dynamically import it at
// runtime to avoid bundling the module in an `aws_lambda()`.
import type {BertTokenizer} from "@xenova/transformers";
import {join as joinPath} from "path";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {createTransformersTokenizer} from "~/server/language_models/core/create_transformers_tokenizer.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {Lazy} from "~/shared/helpers/control/lazy.open_source.js";

/**
 * Tokenizer for Cohere's `embed-english-v3.0` model. [Read more][1].
 *
 * [1]: https://txt.cohere.com/introducing-embed-v3/
 */
export class CohereEmbedEnglishV3LanguageTokenizer {
    private readonly _tokenizer: BertTokenizer;

    private constructor(tokenizer: BertTokenizer) {
        this._tokenizer = tokenizer;
    }

    private static _instancePromise = new Lazy(async () => {
        const tokenizer = await createTransformersTokenizer(
            joinPath(runfilesPath, "cohere_embed_english_v3"),
        );

        return new CohereEmbedEnglishV3LanguageTokenizer(tokenizer);
    });

    public static get() {
        return this._instancePromise.get();
    }

    /**
     * The ideal maximum number of tokens in embedding text. 512 as per the [Cohere
     * embed documentation][1].
     *
     * > We recommend reducing the length of each text to be under 512 tokens for
     * > optimal quality.
     *
     * Going above this length is fine but not recommended.
     *
     * [1]: https://docs.cohere.com/reference/embed
     */
    public readonly idealMaxEmbedTokenCount = 512;

    /**
     * Count the number of tokens for the `embed-english-light-v3.0` model. Uses the
     * tokenizer configuration from [Cohere's repo on Hugging Face][1].
     *
     * [1]: https://huggingface.co/Cohere/Cohere-embed-english-light-v3.0
     */
    public countTokens(text: string): number {
        // Comment below explains this assertion...
        assert(this._tokenizer.model.fuse_unk === false);

        // We use the private `tokenizer._encode_text()` method instead of
        // `tokenizer.encode()` or `tokenizer()` to skip unnecessary extra work that
        // doesn't affect token count. Specifically [this work][1].
        //
        // - We would have called `encode()` with `add_special_tokens: false` (we need to
        //   set that to get an accurate count according to this [StackOverflow answer][2])
        // - `tokenizer.model.convert_tokens_to_ids()` will change the token count if
        //   `tokenizer.model.fuse_unk` is true. Cohere's tokenizer does not set `fuse_unk`
        //   to true which we assert above
        //
        // [1]:
        //     https://github.com/xenova/transformers.js/blob/83dfa4718ec99c4566ec89954a0b0544a5a25d78/src/tokenizers.js#L2548-L2553
        // [2]:
        //     https://stackoverflow.com/questions/71359679/how-to-get-number-of-tokens-in-the-sentence-in-keras
        const tokens = this._tokenizer._encode_text(text);

        return tokens?.length ?? 0;
    }
}
