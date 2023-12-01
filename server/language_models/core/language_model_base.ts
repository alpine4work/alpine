import {OpensearchIndexKnnVectorTypeConfig} from "~/server/opensearch/opensearch_index_type.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

/**
 * Static class interface for a language model.
 */
export interface LanguageModelBaseClass {
    /**
     * An identifier for the language model in our codebase.
     */
    readonly key: "AllMiniLmL6V2" | "CohereEmbedEnglishV3";

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
}
