import {OpensearchIndexConfigBuilder} from "~/server/opensearch/opensearch_index.js";

export type OpensearchIndexAnalysisAnalyzer =
    | OpensearchIndexAnalysisNativeAnalyzer
    | OpensearchIndexAnalysisCustomAnalyzer;

/**
 * Built-in [OpenSearch analyzers][1].
 *
 * [1]: https://opensearch.org/docs/latest/analyzers/index/#built-in-analyzers
 */
export type OpensearchIndexAnalysisNativeAnalyzer = "standard" | "english";

/**
 * Custom [OpenSearch analyzer][1].
 *
 * [1]: https://opensearch.org/docs/latest/analyzers/search-analyzers/
 */
export class OpensearchIndexAnalysisCustomAnalyzer {
    public readonly name: string;
    private readonly _tokenizer: "standard";
    private readonly _filter: ReadonlyArray<OpensearchIndexAnalysisFilter>;

    constructor(
        name: string,
        {
            tokenizer,
            filter,
        }: {
            tokenizer: "standard";
            filter: Array<OpensearchIndexAnalysisFilter>;
        },
    ) {
        this.name = name;
        this._tokenizer = tokenizer;
        this._filter = filter;
    }

    public getConfig(builder: OpensearchIndexConfigBuilder) {
        builder.addCustomAnalyzer(this);
        return this.name;
    }

    public getDefinitionConfig(builder: OpensearchIndexConfigBuilder) {
        return {
            tokenizer: this._tokenizer,
            filter: this._filter.map(filter => {
                if (typeof filter === "string") return filter;
                return filter.getConfig(builder);
            }),
        };
    }

    public extend(nameAddition: string, {filter}: {filter: Array<OpensearchIndexAnalysisFilter>}) {
        return new OpensearchIndexAnalysisCustomAnalyzer(`${this.name}_${nameAddition}`, {
            tokenizer: this._tokenizer,
            filter: [...this._filter, ...filter],
        });
    }
}

export type OpensearchIndexAnalysisFilter =
    | OpensearchIndexAnalysisFilterConfig["type"]
    | OpensearchIndexAnalysisCustomFilter;

/**
 * Configuration for [OpenSearch token filters][1]. ElasticSearch has better
 * [reference documentation][2] for all the token filters. Refer to that when
 * looking for token filter options.
 *
 * [1]: https://opensearch.org/docs/latest/analyzers/token-filters/index/
 * [2]:
 *     https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-tokenfilters.html
 */
type OpensearchIndexAnalysisFilterConfig =
    | {
          readonly type: "lowercase";
      }
    | {
          readonly type: "stemmer";
          readonly language?: "english" | "possessive_english";
      }
    | {
          readonly type: "stop";
          readonly stopwords?: "_english_";
      }
    | {
          readonly type: "word_delimiter_graph";
          readonly stem_english_possessive?: boolean;
      }
    | {
          readonly type: "shingle";
          readonly max_shingle_size?: number;
          readonly min_shingle_size?: number;
          readonly output_unigrams?: boolean;
          readonly token_separator?: string;
          readonly filler_token?: string;
      };

/**
 * Custom [OpenSearch token filter][1]. Uses a supported filter but can provide
 * additional configuration.
 *
 * [1]: https://opensearch.org/docs/latest/analyzers/token-filters/index/
 */
export class OpensearchIndexAnalysisCustomFilter {
    public readonly name: string;
    private readonly _config: OpensearchIndexAnalysisFilterConfig;

    constructor(name: string, config: OpensearchIndexAnalysisFilterConfig) {
        this.name = name;
        this._config = config;
    }

    public getConfig(builder: OpensearchIndexConfigBuilder) {
        builder.addCustomFilter(this);
        return this.name;
    }

    public getDefinitionConfig() {
        return this._config;
    }
}
