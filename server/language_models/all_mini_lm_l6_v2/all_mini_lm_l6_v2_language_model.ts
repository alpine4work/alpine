// Only import types from `@xenova/transformers`. We dynamically import it at
// runtime to avoid bundling the module in an `aws_lambda()`.
import type {FeatureExtractionPipeline} from "@xenova/transformers";
import fsSync from "fs";
import {join as joinPath} from "path";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {createTransformersModel} from "~/server/language_models/core/create_transformers_model.js";
import {createTransformersTokenizer} from "~/server/language_models/core/create_transformers_tokenizer.js";
import {
    LanguageModelBase,
    LanguageModelBaseClass,
} from "~/server/language_models/core/language_model_base.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {TestCounter} from "~/shared/helpers/test/test_counter.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

assertAssignableTypes<typeof AllMiniLmL6V2LanguageModel, LanguageModelBaseClass>();

export const allMiniLmL6V2LanguageModelEmbedTextTestCounter = new TestCounter();

// eslint-disable-next-line @typescript-eslint/unbound-method
const originalProcessNextTick = process.nextTick;

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
export class AllMiniLmL6V2LanguageModel implements LanguageModelBase {
    public readonly statics = AllMiniLmL6V2LanguageModel;

    public static readonly key = "allMiniLmL6V2";
    public static readonly dimensionCount = 384;

    // This model is only used in development/test environments and has a small
    // dimension count. Don't bother quantizing like we do for production models.
    //
    // Another reason we don't quantize is we haven't found or produced a dataset
    // to compute dimension bounds from. [Qdrant][1] recommends using p99 or p95
    // bounds.
    //
    // [1]: https://qdrant.tech/articles/scalar-quantization/
    public static readonly dimensionDataType = "float";

    /**
     * > The all-MiniLM-L6-v2 model was trained using cosine similarity-so using
     * > cosine similarity for the index will produce the most accurate result.
     *
     * ([Source][1])
     *
     * Unfortunately, the [OpenSearch Faiss engine does not support cosine
     * similarity (`cosinesimil`)][2] so we use `l2` which is the OpenSearch
     * default space type.
     *
     * [1]: https://www.pinecone.io/learn/vector-similarity/
     * [2]: https://opensearch.org/docs/latest/field-types/supported-field-types/knn-methods-engines/#faiss-engine
     */
    public static readonly opensearchSpaceType = "l2";

    private readonly _extractor: FeatureExtractionPipeline;

    private constructor(extractor: FeatureExtractionPipeline) {
        this._extractor = extractor;
    }

    public static async new(basePath: string = joinPath(runfilesPath, "all_mini_lm_l6_v2")) {
        if (!fsSync.existsSync(`${basePath}_config`)) {
            throw new InternalError(
                "Couldn\u2019t find runfiles, you must include `//server/language_models/all_mini_lm_l6_v2:all_mini_lm_l6_v2_data` in `data` to use this model (avoid using this model in production)",
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

        // We dynamically import this models at runtime to avoid bundling
        // `@xenova/transformers`'s native libraries in an `aws_lambda()`.
        //
        // We do the funky `string + cast(string)` syntax so the import path can't
        // be statically analyzed by esbuild.
        const {FeatureExtractionPipeline}: typeof import("@xenova/transformers") = await import(
            /* @vite-ignore */ "@xenova/" + cast("transformers")
        );

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
    public embed(tracer: TracerBase, texts: Iterable<string>): Promise<Iterable<Iterable<number>>> {
        return tracer.withSpan("all-MiniLM-L6-v2 embed", async span => {
            const textArray = Array.isArray(texts) ? texts : Array.from(texts);

            allMiniLmL6V2LanguageModelEmbedTextTestCounter.incrementForTest(
                undefined,
                textArray.length,
            );

            span.addData({
                common: {count: textArray.length},
            });

            // NOTE(calebmer): [Annoyingly, `onnxruntime-node` calls `process.nextTick()`][1]
            // before running the model with a native library that runs synchronously. They
            // probably call `process.nextTick()` to create the illusion of asynchrony.
            // Anyway, when Jest fake timers are on (`jest.useFakeTimers()`) we wait
            // forever at the `process.nextTick()` call. To avoid this, let's install the
            // original unmocked `process.nextTick()` function when we perform our
            // embedding so it doesn't wait for Jest.
            //
            // If other code is running concurrently it may use the unmocked
            // `process.nextTick()` which is a tradeoff we accept to not have to think
            // about fake timers when calling `embed()`.
            //
            // [1]: https://github.com/microsoft/onnxruntime/blob/8931854528b1b2a3f320d012c78d37186fbbdab8/js/node/lib/backend.ts#L39
            let embeddingsPromise;
            let previousProcessNextTick: typeof process.nextTick | null = null;
            try {
                if (import.meta.jest && process.nextTick !== originalProcessNextTick) {
                    // eslint-disable-next-line @typescript-eslint/unbound-method
                    previousProcessNextTick = process.nextTick;
                    process.nextTick = originalProcessNextTick;
                }

                embeddingsPromise = await this._extractor(textArray, {
                    pooling: "mean",
                    normalize: true,
                });
            } finally {
                if (previousProcessNextTick !== null) {
                    process.nextTick = previousProcessNextTick;
                }
            }

            return embeddingsPromise;
        });
    }
}
