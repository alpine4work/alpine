import {FeatureExtractionPipeline} from "@xenova/transformers";
import fs from "fs-extra";
import {join as joinPath} from "path";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {createTransformersModel} from "~/server/language_models/core/create_transformers_model.js";
import {createTransformersTokenizer} from "~/server/language_models/core/create_transformers_tokenizer.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

/**
 * Interface to the `all-MiniLM-L6-v2` model. It is not a very good model
 * (ranked 50 out of 121 as of 2023-11-30 on the [Hugging Face MTEB
 * leaderboard][1]), but it's small and can run locally. Which makes it great
 * for local development and test environments. We don't use this model in
 * production.
 *
 * The model is [originally from `sentence-transformers`][2] but we use a [fork
 * from `Xenova`][3] that adds JavaScript compatibility.
 *
 * [1]: https://huggingface.co/spaces/mteb/leaderboard
 * [2]: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
 * [3]: https://huggingface.co/Xenova/all-MiniLM-L6-v2
 */
export class AllMiniLmL6V2LanguageModel {
    private readonly _extractor: FeatureExtractionPipeline;

    private constructor(extractor: FeatureExtractionPipeline) {
        this._extractor = extractor;
    }

    public static async new() {
        const basePath = joinPath(runfilesPath, "all_mini_lm_l6_v2");

        if (!(await fs.pathExists(`${basePath}_config`))) {
            throw new InternalError(
                "Couldn't find runfiles, you must include `//server/language_models/all_mini_lm_l6_v2:all_mini_lm_l6_v2_data` in `data` to use this model (avoid using this model in production)",
            );
        }

        // In constructing the `extractor`, we do the same thing `pipeline()` does
        // automatically. But we don't want to download the files in this process.
        // Instead we've downloaded and cached the files with Bazel. So we manually
        // reverse engineer what `pipeline()` is doing with files already downloaded
        // (by Bazel) to disk.
        //
        // See: https://github.com/xenova/transformers.js/blob/83dfa4718ec99c4566ec89954a0b0544a5a25d78/src/pipelines.js#L2439-L2525
        const [tokenizer, model] = await runAllPromises([
            createTransformersTokenizer(basePath),
            createTransformersModel(basePath),
        ]);

        const extractor = new FeatureExtractionPipeline({
            task: "feature-extraction",
            tokenizer,
            model,
        });

        return new AllMiniLmL6V2LanguageModel(extractor);
    }

    /**
     * Embeds some text with this model. Returns a vector for each text.
     */
    public embed(texts: ReadonlyArray<string>): Promise<Iterable<Iterable<number>>> {
        return this._extractor(texts, {pooling: "mean", normalize: true});
    }
}
