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
    public static readonly dimensionDataType = "float";

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

        // Cohere supports a maximum number of `texts` per `embed()` call. If we have more
        // `texts` then batch them up.
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

                return body.embeddings;
            },
        );
    }
}
