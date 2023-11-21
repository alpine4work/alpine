import {BertTokenizer} from "@xenova/transformers";
import fs from "fs-extra";
import {join as joinPath} from "path";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {LanguageModelBase} from "~/server/search/index/internal/language_model_base.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";

const cohereEnglishLightTokenizerConfigPath = joinPath(
    runfilesPath,
    "cohere_embed_english_light_v3_0_tokenizer_config/file/tokenizer_config.json",
);

const cohereEnglishLightTokenizerJsonPath = joinPath(
    runfilesPath,
    "cohere_embed_english_light_v3_0_tokenizer/file/tokenizer.json",
);

/**
 * API for Cohere's `embed-english-light-v3.0` model. [Read more][1].
 *
 * [1]: https://txt.cohere.com/introducing-embed-v3/
 */
export class CohereEnglishLightLanguageModel implements LanguageModelBase {
    private readonly _tokenizer: BertTokenizer;

    private constructor(tokenizer: BertTokenizer) {
        this._tokenizer = tokenizer;
    }

    private static readonly _promise = new Lazy(async () => {
        const [configContents, jsonContents] = await runAllPromises([
            fs.readFile(cohereEnglishLightTokenizerConfigPath, "utf8"),
            fs.readFile(cohereEnglishLightTokenizerJsonPath, "utf8"),
        ]);

        const config = JSON.parse(configContents);
        const json = JSON.parse(jsonContents);

        // Used by `AutoTokenizer` to figure out the right tokenizer class. Since this
        // is specifically for Cohere tokens, we hardcode `BertTokenizer`.
        // https://github.com/xenova/transformers.js/blob/83dfa4718ec99c4566ec89954a0b0544a5a25d78/src/tokenizers.js#L3881-L3908
        assert(config.tokenizer_class === "BertTokenizer");

        const tokenizer = new BertTokenizer(json, config);

        return new CohereEnglishLightLanguageModel(tokenizer);
    });

    public static get() {
        return this._promise.get();
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
     * Count the number of tokens for the `embed-english-light-v3.0` model. Uses
     * the tokenizer configuration from [Cohere's repo on Hugging Face][1].
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
        // - We would have called `encode()` with `add_special_tokens: false` (we need
        //   to set that to get an accurate count according to this [StackOverflow
        //   answer][2])
        // - `tokenizer.model.convert_tokens_to_ids()` will change the token count if
        //   `tokenizer.model.fuse_unk` is true. Cohere's tokenizer does not set
        //   `fuse_unk` to true which we assert above
        //
        // [1]: https://github.com/xenova/transformers.js/blob/83dfa4718ec99c4566ec89954a0b0544a5a25d78/src/tokenizers.js#L2548-L2553
        // [2]: https://stackoverflow.com/questions/71359679/how-to-get-number-of-tokens-in-the-sentence-in-keras
        const tokens = this._tokenizer._encode_text(text);

        return tokens?.length ?? 0;
    }
}
