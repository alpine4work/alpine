import {OpensearchIndexKnnVectorTypeConfig} from "~/server/opensearch/opensearch_index_type.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

/**
 * Static class interface for a language model.
 */
export interface LanguageModelBaseClass {
    /**
     * An identifier for the language model in our codebase.
     */
    readonly key: "allMiniLmL6V2" | "cohereEmbedEnglishV3";

    /**
     * How many dimensions are in an embedding?
     */
    readonly dimensionCount: number;

    /**
     * See the documentation on the type below for what each of the space
     * types mean.
     */
    readonly opensearchSpaceType: OpensearchIndexKnnVectorTypeConfig["method"]["spaceType"];
}

/**
 * Interface for a language model. Useful for swapping out language
 * model implementations.
 */
export interface LanguageModelBase {
    readonly statics: LanguageModelBaseClass;

    /**
     * Embed some texts into vector representations with this model.
     *
     * `inputType` is [required by Cohere][1] and unused by other models. Other
     * models ignore the option.
     *
     * [1]: https://docs.cohere.com/reference/embed
     */
    embed(
        tracer: TracerBase,
        texts: Iterable<string>,
        options: {inputType: "SearchDocument" | "SearchQuery"},
    ): Promise<Iterable<Iterable<number>>>;

    /**
     * Quantize a vector produced by our language model to a signed 8-bit integer
     * for OpenSearch. Minimum being -128 and maximum being 127.
     *
     * This way we can store a byte vector in our database improve space efficiency
     * for minimal recall loss ([source 1][1], [source 2][2]).
     *
     * How we quantize is important and depends on the `opensearchSpaceType` for
     * the language model. [See pseudo-code here][3].
     *
     * How you quantize is also based on the range of dimensions values for your
     * language model. It's different if the range is [0, 1) or [-100, 100].
     *
     * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/knn-vector/#lucene-byte-vector
     * [2]: https://www.elastic.co/blog/save-space-with-byte-sized-vectors
     * [3]: https://opensearch.org/docs/latest/field-types/supported-field-types/knn-vector/#quantization-techniques
     */
    quantizeForOpensearchByteVector(vector: Iterable<number>): Iterable<number>;
}
