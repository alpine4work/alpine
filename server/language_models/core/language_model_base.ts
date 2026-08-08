import {TracerBase} from "~/shared/tracer/tracer_base.open_source.js";

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
     * Are dimensions 32-bit floats or 8-bit signed bytes (aka integer in the range
     * [-127, 128])? Typically, models return 32-bit floats but research shows you can
     * quantize vectors to bytes with significant performance improvement for a minimal
     * effect on recall ([source 1][1], [source 2][2], [source 3][3]).
     *
     * The `embed()` function is expected to return dimensions of this type.
     *
     * Generally, we recommend using a `byte` data type for your model since the
     * performance is much better for a minimal effect on recall. However, a `float`
     * data type is more convenient since you don't need to perform quantization on
     * your vectors.
     *
     * [1]:
     *     https://opensearch.org/docs/latest/field-types/supported-field-types/knn-vector#lucene-byte-vector
     * [2]: https://www.elastic.co/blog/save-space-with-byte-sized-vectors
     * [3]: https://qdrant.tech/articles/scalar-quantization/
     */
    readonly dimensionDataType: "float" | "byte";

    /**
     * See the documentation on `OpensearchIndexKnnVectorTypeConfig` for more
     * information.
     */
    readonly opensearchSpaceType: "l1" | "l2" | "linf" | "cosinesimil";
}

/**
 * Interface for a language model. Useful for swapping out language model
 * implementations.
 */
export interface LanguageModelBase {
    readonly statics: LanguageModelBaseClass;

    /**
     * Embed some texts into vector representations with this model.
     *
     * `inputType` is [required by Cohere][1] and unused by other models. Other models
     * ignore the option.
     *
     * [1]: https://docs.cohere.com/reference/embed
     */
    embed(
        tracer: TracerBase,
        texts: Iterable<string>,
        options: {inputType: "SearchDocument" | "SearchQuery"},
    ): Promise<Iterable<Iterable<number>>>;
}
