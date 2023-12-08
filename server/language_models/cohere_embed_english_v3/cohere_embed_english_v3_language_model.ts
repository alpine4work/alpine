import {
    LanguageModelBase,
    LanguageModelBaseClass,
} from "~/server/language_models/core/language_model_base.js";
import {UnknownError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {flatIterable} from "~/shared/helpers/iterable/flat_iterable.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

const cohereModelIdentifier = "embed-english-v3.0";

/**
 * Maximum number of `texts` we can send in one API call to Cohere.
 *
 * See: https://docs.cohere.com/reference/embed
 */
const maxCohereEmbedBatchTextCount = 96;

assertAssignableTypes<typeof CohereEmbedEnglishV3LanguageModel, LanguageModelBaseClass>();

/**
 * Interface to the Cohere `embed-english-v3.0` model.
 */
export class CohereEmbedEnglishV3LanguageModel implements LanguageModelBase {
    public readonly statics = CohereEmbedEnglishV3LanguageModel;

    public static readonly key = "cohereEmbedEnglishV3";
    public static readonly dimensionCount = 1024;
    public static readonly dimensionDataType = "byte";

    /**
     * `l2` stands for Euclidean distance and is OpenSearch's default distance
     * function. Cohere embeddings support Euclidean distance.
     *
     * From the [Cohere documentation on their v3 embedding models][1]:
     *
     * > All models return normalized embeddings and can use dot product, cosine
     * > similarity, and Euclidean distance as the similarity metric. All metrics
     * > return identical rankings.
     *
     * [1]: https://txt.cohere.com/introducing-embed-v3/
     */
    public static readonly opensearchSpaceType = "l2";

    private readonly _apiKey: string;

    constructor({apiKey}: {apiKey: string}) {
        this._apiKey = apiKey;
    }

    public async embed(
        tracer: TracerBase,
        texts: Iterable<string>,
        options: {inputType: "SearchDocument" | "SearchQuery"},
    ): Promise<Iterable<Iterable<number>>> {
        const textArray = Array.isArray(texts) ? texts : Array.from(texts);

        const textBatches: Array<Array<string>> = [];

        // Cohere supports a maximum number of `texts` per `embed()` call. If we have
        // more `texts` then batch them up.
        for (const text of textArray) {
            if (textBatches.length === 0) {
                textBatches.push([text]);
                continue;
            }

            const lastTextBatch = textBatches[textBatches.length - 1]!;

            if (lastTextBatch.length < maxCohereEmbedBatchTextCount) {
                lastTextBatch.push(text);
            } else {
                textBatches.push([text]);
            }
        }

        const embeddingBatches = await runAllPromises(
            textBatches.map(textBatch => this._embed(tracer, textBatch, options)),
        );

        return flatIterable(embeddingBatches);
    }

    private async _embed(
        tracer: TracerBase,
        texts: ReadonlyArray<string>,
        {inputType}: {inputType: "SearchDocument" | "SearchQuery"},
    ): Promise<Array<Array<number>>> {
        return fetchWithTracer(
            tracer,
            "https://api.cohere.ai/v1/embed",
            {
                serviceName: "Cohere",
                route: "/v1/embed",
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    accept: "application/json",
                    authorization: `Bearer ${this._apiKey}`,
                },
                body: JSON.stringify({
                    model: cohereModelIdentifier,
                    texts,
                    truncate: "END",
                    input_type: {
                        SearchDocument: "search_document",
                        SearchQuery: "search_query",
                    }[inputType],
                }),
            },
            async (response, span) => {
                const body: {
                    message?: string;
                    embeddings: Array<Array<number>>;
                    meta: {billed_units: {input_tokens: number}};
                } = await response.json();

                if (!response.ok) {
                    throw new UnknownError(
                        `Cohere failed to embed texts${body.message ? `: ${body.message}` : ""}`,
                    );
                }

                span.addData({
                    cohere: {
                        textCount: texts.length,
                        model: cohereModelIdentifier,
                        inputType,
                        tokenCount: body.meta.billed_units.input_tokens,
                    },
                });

                return body.embeddings.map(vector => {
                    this._quantize(vector);
                    return vector;
                });
            },
        );
    }

    /**
     * Quantize a vector from Cohere. Uses the algorithm in the [OpenSearch
     * documentation for the `l2` space type][1].
     *
     * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/knn-vector/#scalar-quantization-for-the-l2-space-type
     */
    private _quantize(vector: Array<number>) {
        for (let i = 0; i < vector.length; i++) {
            let dimension = vector[i]!;

            // Shift coordinates to be non-negative
            dimension -= cohereEmbeddingVectorDimensionLowerBound;

            // Normalize into [0, 1]
            dimension /= cohereEmbeddingVectorDimensionRange;

            // Bucket into 256 values
            dimension = Math.floor(dimension * 255) - 128;

            // Clamp to byte range
            if (dimension > 127) dimension = 127;
            if (dimension < -128) dimension = -128;

            vector[i] = dimension;
        }
    }
}

/**
 * We apply scalar quantization on our vectors from Cohere so dimensions are
 * one byte large instead of a 32-bit float. This improves memory usage and
 * query speed for a small recall sacrifice. To quantize we need bounds to
 * translate a 32-bit float into a byte. [Qdrant recommends p99 bounds][1],
 * the [Cohere team recommends p99.8 bounds][2].
 *
 * From the Cohere team (2023-12-06):
 *
 * > We will release something in Jan that will make this much easier.
 * >
 * > We found that p99.8 works quite well with no drop in search quality.
 * >
 * > We currently upload more datasets with the emb model. There are two
 * > already that can be used to compute p99.8
 * >
 * > https://huggingface.co/datasets/Cohere/msmarco-v2-embed-multilingual-v3
 * > https://huggingface.co/datasets/Cohere/msmarco-v2-embed-english-v3
 * >
 * > It is sufficient to approximate p99.8 on a subset of e.g. 1m embeddings
 *
 * ([Source][2])
 *
 * I (@calebmer) used the `Cohere/msmarco-v2-embed-english-v3` dataset to compute p99.8 bounds with the following script:
 *
 * ```py
 * from math import floor
 * from datasets import load_dataset
 * from sortedcontainers import SortedList
 * from transformers import AutoTokenizer
 *
 * dataset = load_dataset("Cohere/msmarco-v2-embed-english-v3", split = "train", streaming = True)
 * dimensions = SortedList()
 * tokenizer = AutoTokenizer.from_pretrained("Cohere/Cohere-embed-english-v3.0")
 *
 * # Derived from:
 * # https://stackoverflow.com/questions/48719873/how-to-get-median-and-quartiles-percentiles-of-an-array-in-javascript-or-php
 * def percentile(percent):
 *     dimension_count = len(dimensions)
 *     index = (dimension_count - 1) * percent
 *     index_base = floor(index)
 *     index_rest = index - index_base
 *
 *     dimension_base = dimensions[index_base]
 *
 *     if index_base + 1 < dimension_count:
 *         return dimension_base + index_rest * (dimensions[index_base + 1] - dimension_base)
 *     else:
 *         return dimension_base
 *
 * i = 0
 * token_count = 0
 *
 * for item in dataset:
 *     i += 1
 *     token_count += len(tokenizer.tokenize(item["text"]))
 *
 *     embedding = item["emb"]
 *     for dimension in embedding:
 *         dimensions.add(dimension)
 *
 *     if i % 1000 == 0:
 *         message = "p00.2 = {}, p99.8 = {}, samples = {:,}, tokens = {:,}".format(
 *             percentile(0.002),
 *             percentile(0.998),
 *             i,
 *             token_count
 *         )
 *         print(message)
 * ```
 *
 * After running overnight the final output was:
 *
 * ```
 * p00.2 = -0.1009521484375, p99.8 = 0.1007080078125, samples = 2,266,000, tokens = 144,793,493
 * ```
 *
 * So these are the bounds of 2.3M vectors in the `Cohere/msmarco-v2-embed-english-v3`
 * dataset.
 *
 * [1]: https://qdrant.tech/articles/scalar-quantization/
 * [2]: https://discord.com/channels/954421988141711382/1181993977927434240/1182012403731415190
 */
const [cohereEmbeddingVectorDimensionLowerBound, cohereEmbeddingVectorDimensionUpperBound] = [
    -0.1009521484375, 0.1007080078125,
];

const cohereEmbeddingVectorDimensionRange =
    cohereEmbeddingVectorDimensionUpperBound - cohereEmbeddingVectorDimensionLowerBound;
