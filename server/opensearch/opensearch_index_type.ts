import {parseISO} from "date-fns";
import {OpensearchIndexConfigBuilder} from "~/server/opensearch/opensearch_index.js";
import {OpensearchIndexAnalysisAnalyzer} from "~/server/opensearch/opensearch_index_analysis.js";
import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.open_source.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.open_source.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {omitObject} from "~/shared/helpers/object/omit_object.open_source.js";
import {JsonObjectValue, JsonValue} from "~/shared/helpers/types/json_value.open_source.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.open_source.js";
import {UnionToIntersection} from "~/shared/helpers/types/union_to_intersection.js";
import {ObjectSchema, UnionSchema} from "~/shared/schema/schema.js";

export type OpensearchIndexTypeType<Type extends OpensearchIndexTypeBase<any, any, any>> =
    Type extends OpensearchIndexTypeBase<infer Value, any, any> ? Value : never;

export type OpensearchIndexTypeFlattenedKeysType<
    Type extends OpensearchIndexTypeBase<any, any, any>,
> = Type extends OpensearchIndexTypeBase<any, infer FlattenedKeys, any> ? FlattenedKeys : never;

export type OpensearchIndexTypeStoredFieldsType<
    Type extends OpensearchIndexTypeBase<any, any, any>,
> = Type extends OpensearchIndexTypeBase<any, any, infer StoredFields> ? StoredFields : never;

/**
 * A type to be added to an [OpenSearch index mapping][1]. This abstraction
 * provides type safety to OpenSearch documents.
 *
 * [1]: https://opensearch.org/docs/latest/field-types/index/
 */
export abstract class OpensearchIndexTypeBase<
    Value,
    FlattenedKeys extends string,
    StoredFields extends {[key: string]: unknown},
> {
    /**
     * Types for deserializing stored fields on this index type.
     */
    public abstract readonly storedFields: {
        [Key in keyof StoredFields]: OpensearchIndexTypeBase<StoredFields[Key], "this", {}>;
    };

    /**
     * Gets the config object we pass into the OpenSearch index create API.
     */
    public abstract getConfig(
        builder: OpensearchIndexConfigBuilder,
        options: {shouldStoreFields: boolean},
    ): {type: string};

    /**
     * Serializes our value to a JSON value to be passed on to OpenSearch.
     */
    public abstract serialize(value: Value): JsonValue;

    /**
     * Deserializes a JSON value we received from OpenSearch that was previously
     * serialized by the same type.
     */
    public abstract deserialize(value: JsonValue | undefined): Value;

    public nullable(): OpensearchIndexTypeBase<Value | null, FlattenedKeys, StoredFields> {
        return new OpensearchIndexNullableType(this);
    }

    public default(
        defaultValue: Value,
    ): OpensearchIndexTypeBase<Value, FlattenedKeys, StoredFields> {
        return new OpensearchIndexDefaultType(this, defaultValue);
    }

    public validate<NewValue extends Value>(
        validate: (value: Value) => value is NewValue,
    ): OpensearchIndexTypeBase<NewValue, FlattenedKeys, StoredFields> {
        return new OpensearchIndexValidatedType(this, validate);
    }

    public transform<NewValue>({
        serialize,
        deserialize,
    }: {
        serialize: (newValue: NewValue) => Value;
        deserialize: (oldValue: Value) => NewValue;
    }): OpensearchIndexTypeBase<NewValue, FlattenedKeys, StoredFields> {
        return new OpensearchIndexTransformedType(this, {
            serialize,
            deserialize,
        });
    }

    /**
     * Treat this field as a [stored field][1]. Only works on primitive fields. Stored
     * fields are saved in row form as opposed to `doc_values` which is stored in
     * columnar form ([more information][2] on internals and performance tradeoffs
     * between `_source`, stored fields, and `doc_values`).
     *
     * [1]:
     *     https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping-store.html
     * [2]: https://sease.io/2021/02/field-retrieval-performance-in-elasticsearch.html
     */
    public store<FlattenedKeys extends string>(
        this: OpensearchIndexTypeBase<Value, FlattenedKeys, {}>,
    ): OpensearchIndexTypeBase<
        Value,
        FlattenedKeys,
        {readonly this: NonNullableNonArrayType<Value>}
    > {
        return new OpensearchIndexStoredType(this);
    }
}

/**
 * An OpenSearch type that allows null.
 */
class OpensearchIndexNullableType<
    Value,
    FlattenedKeys extends string,
    StoredFields extends {[key: string]: unknown},
> extends OpensearchIndexTypeBase<Value | null, FlattenedKeys, StoredFields> {
    public readonly sourceType: OpensearchIndexTypeBase<Value, FlattenedKeys, StoredFields>;

    constructor(sourceType: OpensearchIndexTypeBase<Value, FlattenedKeys, StoredFields>) {
        super();
        this.sourceType = sourceType;
    }

    public get storedFields() {
        return this.sourceType.storedFields;
    }

    public override getConfig(
        builder: OpensearchIndexConfigBuilder,
        options: {shouldStoreFields: boolean},
    ) {
        return this.sourceType.getConfig(builder, options);
    }

    public override serialize(value: Value | null): JsonValue {
        if (value === null) return null;
        return this.sourceType.serialize(value);
    }

    public override deserialize(value: JsonValue | undefined): Value | null {
        if (value === null) return null;
        return this.sourceType.deserialize(value);
    }
}

class OpensearchIndexDefaultType<
    Value,
    FlattenedKeys extends string,
    StoredFields extends {[key: string]: unknown},
> extends OpensearchIndexTypeBase<Value, FlattenedKeys, StoredFields> {
    public readonly sourceType: OpensearchIndexTypeBase<Value, FlattenedKeys, StoredFields>;
    private readonly _defaultValue: Value;

    constructor(
        sourceType: OpensearchIndexTypeBase<Value, FlattenedKeys, StoredFields>,
        defaultValue: Value,
    ) {
        super();
        this.sourceType = sourceType;
        this._defaultValue = defaultValue;
    }

    public get storedFields() {
        return this.sourceType.storedFields;
    }

    public override getConfig(
        builder: OpensearchIndexConfigBuilder,
        options: {shouldStoreFields: boolean},
    ) {
        return this.sourceType.getConfig(builder, options);
    }

    public override serialize(value: Value): JsonValue {
        return this.sourceType.serialize(value);
    }

    public override deserialize(value: JsonValue | undefined): Value {
        if (value === undefined || value === null) return this._defaultValue;
        return this.sourceType.deserialize(value);
    }
}

/**
 * An OpenSearch type that has been transformed to a different value at runtime.
 * Useful if you want to represent a value as JSON in OpenSearch but as some custom
 * class in JavaScript.
 */
class OpensearchIndexTransformedType<
    OldValue,
    NewValue,
    FlattenedKeys extends string,
    StoredFields extends {[key: string]: unknown},
> extends OpensearchIndexTypeBase<NewValue, FlattenedKeys, StoredFields> {
    private readonly _sourceType: OpensearchIndexTypeBase<OldValue, FlattenedKeys, StoredFields>;
    private readonly _serialize: (newValue: NewValue) => OldValue;
    private readonly _deserialize: (oldValue: OldValue) => NewValue;

    constructor(
        sourceType: OpensearchIndexTypeBase<OldValue, FlattenedKeys, StoredFields>,
        {
            serialize,
            deserialize,
        }: {
            serialize: (newValue: NewValue) => OldValue;
            deserialize: (oldValue: OldValue) => NewValue;
        },
    ) {
        super();
        this._sourceType = sourceType;
        this._serialize = serialize;
        this._deserialize = deserialize;
    }

    public get storedFields() {
        return this._sourceType.storedFields;
    }

    public override getConfig(
        builder: OpensearchIndexConfigBuilder,
        options: {shouldStoreFields: boolean},
    ) {
        return this._sourceType.getConfig(builder, options);
    }

    public override serialize(newValue: NewValue): JsonValue {
        const oldValue = this._serialize(newValue);
        return this._sourceType.serialize(oldValue);
    }

    public override deserialize(oldValue: JsonValue): NewValue {
        const newValue = this._sourceType.deserialize(oldValue);
        return this._deserialize(newValue);
    }
}

/**
 * An OpenSearch type that's narrower than the source type. We don't have to do
 * anything on serialization for these values but we do need to run a validation
 * function on deserialization.
 */
class OpensearchIndexValidatedType<
    OldValue,
    NewValue extends OldValue,
    FlattenedKeys extends string,
    StoredFields extends {[key: string]: unknown},
> extends OpensearchIndexTypeBase<NewValue, FlattenedKeys, StoredFields> {
    private readonly _sourceType: OpensearchIndexTypeBase<OldValue, FlattenedKeys, StoredFields>;
    private readonly _validate: (value: OldValue) => value is NewValue;

    constructor(
        sourceType: OpensearchIndexTypeBase<OldValue, FlattenedKeys, StoredFields>,
        validate: (value: OldValue) => value is NewValue,
    ) {
        super();
        this._sourceType = sourceType;
        this._validate = validate;
    }

    public get storedFields() {
        return this._sourceType.storedFields;
    }

    public override getConfig(
        builder: OpensearchIndexConfigBuilder,
        options: {shouldStoreFields: boolean},
    ) {
        return this._sourceType.getConfig(builder, options);
    }

    public override serialize(value: NewValue): JsonValue {
        return this._sourceType.serialize(value);
    }

    public override deserialize(value1: JsonValue): NewValue {
        const value2 = this._sourceType.deserialize(value1);
        assert(this._validate(value2));
        return value2;
    }
}

type NonNullableNonArrayType<Value> = Value extends null
    ? never
    : Value extends ReadonlyArray<infer ItemValue>
      ? NonNullableNonArrayType<ItemValue>
      : Value;

class OpensearchIndexStoredType<
    Value,
    FlattenedKeys extends string,
> extends OpensearchIndexTypeBase<
    Value,
    FlattenedKeys,
    {readonly this: NonNullableNonArrayType<Value>}
> {
    private readonly _sourceType: OpensearchIndexTypeBase<Value, FlattenedKeys, {}>;

    public override readonly storedFields: {
        readonly this: OpensearchIndexTypeBase<NonNullableNonArrayType<Value>, FlattenedKeys, {}>;
    };

    constructor(sourceType: OpensearchIndexTypeBase<Value, FlattenedKeys, {}>) {
        super();
        this._sourceType = sourceType;

        let nonNullableNonArraySourceType: OpensearchIndexTypeBase<any, FlattenedKeys, {}> =
            this._sourceType;
        while (
            nonNullableNonArraySourceType instanceof OpensearchIndexNullableType ||
            nonNullableNonArraySourceType instanceof OpensearchIndexArrayType
        ) {
            nonNullableNonArraySourceType = nonNullableNonArraySourceType.sourceType as any;
        }

        this.storedFields = {this: nonNullableNonArraySourceType};
    }

    public override getConfig(builder: OpensearchIndexConfigBuilder) {
        return this._sourceType.getConfig(builder, {shouldStoreFields: true});
    }

    public override serialize(value: Value): JsonValue {
        return this._sourceType.serialize(value);
    }

    public override deserialize(value: JsonValue | undefined): Value {
        return this._sourceType.deserialize(value);
    }
}

/**
 * Capabilities available for OpenSearch types. The OpenSearch API asks to
 * enable/disable functionality for the type (e.g. `index` for allowing searching
 * of a field and `doc_values` to allow for aggregations, sorting, or scripting).
 *
 * But we want to provide a capabilities API since that leads to clearer code. We
 * describe in this object what we want the type to do and translate that to config
 * which enables/disable certain functionality. If we eventually add a typed search
 * API then we should also use these capabilities to throw an error if you say
 * filter or sort by a type you're not allowed to even if the underlying
 * functionality exists.
 *
 * Some composite types like `object` do not have these capabilities.
 *
 * You must explicitly opt-in to capabilities. By default OpenSearch always sets
 * `index` to true but we force users of our abstraction to explicitly designate
 * that they want filtering.
 */
type OpensearchIndexTypeCapabilities = {
    readonly isFilterable?: boolean;
    readonly isSortable?: boolean;
    readonly isUsableInScripts?: boolean;
};

function getOpensearchIndexTypeCapabilitiesConfig(
    {
        isFilterable = false,
        isSortable = false,
        isUsableInScripts = false,
    }: OpensearchIndexTypeCapabilities,
    {shouldStoreFields}: {shouldStoreFields: boolean},
) {
    return {
        index: isFilterable,
        doc_values: isSortable || isUsableInScripts,
        store: shouldStoreFields,
    };
}

/**
 * An OpenSearch [boolean field type][1].
 *
 * [1]:
 *     https://opensearch.org/docs/latest/field-types/supported-field-types/boolean/
 */
export class OpensearchIndexBooleanType extends OpensearchIndexTypeBase<boolean, "this", {}> {
    private readonly _capabilities: OpensearchIndexTypeCapabilities;

    constructor(capabilities: OpensearchIndexTypeCapabilities = {}) {
        super();
        this._capabilities = capabilities;
    }

    public readonly storedFields = {};

    public override getConfig(
        builder: OpensearchIndexConfigBuilder,
        options: {shouldStoreFields: boolean},
    ) {
        return {
            type: "boolean",
            ...getOpensearchIndexTypeCapabilitiesConfig(this._capabilities, options),
        };
    }

    public override serialize(value: boolean): JsonValue {
        return value;
    }

    public override deserialize(value: JsonValue | undefined): boolean {
        assert(typeof value === "boolean");
        return value;
    }
}

/**
 * An OpenSearch [byte numeric field type][1]. A signed 8-bit integer. Minimum is
 * −128. Maximum is 127.
 *
 * [1]:
 *     https://opensearch.org/docs/latest/field-types/supported-field-types/numeric/
 */
export class OpensearchIndexByteType extends OpensearchIndexTypeBase<number, "this", {}> {
    private readonly _capabilities: OpensearchIndexTypeCapabilities;

    constructor(capabilities: OpensearchIndexTypeCapabilities = {}) {
        super();
        this._capabilities = capabilities;
    }

    public readonly storedFields = {};

    public override getConfig(
        builder: OpensearchIndexConfigBuilder,
        options: {shouldStoreFields: boolean},
    ) {
        return {
            type: "byte",
            ...getOpensearchIndexTypeCapabilitiesConfig(this._capabilities, options),
        };
    }

    public override serialize(value: number): JsonValue {
        assert(Number.isInteger(value));
        assert(-128 <= value && value <= 127);
        return value;
    }

    public override deserialize(value: JsonValue | undefined): number {
        assert(typeof value === "number");
        return value;
    }
}

/**
 * An OpenSearch [integer numeric field type][1]. A signed 32-bit integer. Minimum
 * is −2^31. Maximum is 2^31 − 1.
 *
 * [1]:
 *     https://opensearch.org/docs/latest/field-types/supported-field-types/numeric/
 */
export class OpensearchIndexIntegerType extends OpensearchIndexTypeBase<number, "this", {}> {
    private readonly _capabilities: OpensearchIndexTypeCapabilities;

    constructor(capabilities: OpensearchIndexTypeCapabilities = {}) {
        super();
        this._capabilities = capabilities;
    }

    public readonly storedFields = {};

    public override getConfig(
        builder: OpensearchIndexConfigBuilder,
        options: {shouldStoreFields: boolean},
    ) {
        return {
            type: "integer",
            ...getOpensearchIndexTypeCapabilitiesConfig(this._capabilities, options),
        };
    }

    public override serialize(value: number): JsonValue {
        assert(Number.isInteger(value), "Expected an integer");
        assert(
            -(2 ** 31) <= value && value <= 2 ** 31 - 1,
            "Expected a signed 32-bit integer (min -2^31, max 2^31-1)",
        );
        return value;
    }

    public override deserialize(value: JsonValue | undefined): number {
        assert(typeof value === "number");
        return value;
    }
}

/**
 * An OpenSearch [`long` numeric field type][1]. A signed 64-bit integer. Minimum
 * is -2^63. Maximum is 2^63 − 1.
 *
 * [1]:
 *     https://opensearch.org/docs/latest/field-types/supported-field-types/numeric/
 */
export class OpensearchIndexLongType extends OpensearchIndexTypeBase<bigint, "this", {}> {
    private readonly _capabilities: OpensearchIndexTypeCapabilities;

    constructor(capabilities: OpensearchIndexTypeCapabilities = {}) {
        super();
        this._capabilities = capabilities;
    }

    public readonly storedFields = {};

    public override getConfig(
        builder: OpensearchIndexConfigBuilder,
        options: {shouldStoreFields: boolean},
    ) {
        return {
            type: "long",
            ...getOpensearchIndexTypeCapabilitiesConfig(this._capabilities, options),
        };
    }

    public override serialize(value: bigint): JsonValue {
        assert(0n <= value && value <= 2 ** 64 - 1);
        return value.toString();
    }

    public override deserialize(value: JsonValue | undefined): bigint {
        assert(typeof value === "string");
        return BigInt(value);
    }
}

/**
 * An OpenSearch [date field type][1].
 *
 * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/date/
 */
export class OpensearchIndexDateType extends OpensearchIndexTypeBase<Date, "this", {}> {
    private readonly _capabilities: OpensearchIndexTypeCapabilities;

    constructor(capabilities: OpensearchIndexTypeCapabilities = {}) {
        super();
        this._capabilities = capabilities;
    }

    public readonly storedFields = {};

    public override getConfig(
        builder: OpensearchIndexConfigBuilder,
        options: {shouldStoreFields: boolean},
    ) {
        return {
            type: "date",
            format: "strict_date_time",
            ...getOpensearchIndexTypeCapabilitiesConfig(this._capabilities, options),
        };
    }

    public override serialize(value: Date): JsonValue {
        return value.toISOString();
    }

    public override deserialize(value: JsonValue | undefined): Date {
        assert(typeof value === "string");
        return parseISO(value);
    }
}

/**
 * An OpenSearch [binary field type][1]. Raw base64 encoded binary data that is not
 * searchable.
 *
 * [1]:
 *     https://opensearch.org/docs/latest/field-types/supported-field-types/binary/
 */
export class OpensearchIndexBinaryType extends OpensearchIndexTypeBase<Uint8Array, "this", {}> {
    public readonly storedFields = {};

    public override getConfig(
        builder: OpensearchIndexConfigBuilder,
        {shouldStoreFields}: {shouldStoreFields: boolean},
    ) {
        return {
            type: "binary",
            doc_values: false,
            store: shouldStoreFields,
        };
    }

    public override serialize(value: Uint8Array): JsonValue {
        return encodeBase64(value);
    }

    public override deserialize(value: JsonValue | undefined): Uint8Array {
        assert(typeof value === "string");
        return decodeBase64(value);
    }
}

/**
 * An OpenSearch [keyword string field type][1]. Keyword field types are not
 * analyzed so are filterable/sortable as-is with no understanding of human
 * language.
 *
 * [1]:
 *     https://opensearch.org/docs/latest/field-types/supported-field-types/keyword/
 */
export class OpensearchIndexKeywordType extends OpensearchIndexTypeBase<string, "this", {}> {
    private readonly _capabilities: OpensearchIndexTypeCapabilities;

    constructor(capabilities: OpensearchIndexTypeCapabilities = {}) {
        super();
        this._capabilities = capabilities;
    }

    public readonly storedFields = {};

    public override getConfig(
        builder: OpensearchIndexConfigBuilder,
        options: {shouldStoreFields: boolean},
    ) {
        return {
            type: "keyword",
            ...getOpensearchIndexTypeCapabilitiesConfig(this._capabilities, options),
        };
    }

    public override serialize(value: string): JsonValue {
        return value;
    }

    public override deserialize(value: JsonValue | undefined): string {
        assert(typeof value === "string");
        return value;
    }
}

/**
 * > Specifies the information to be stored in the index for search and
 * > highlighting. Valid values: `docs` (doc number only), `freqs` (doc number and
 * > term frequencies), `positions` (doc number, term frequencies, and term
 * > positions), `offsets` (doc number, term frequencies, term positions, and start
 * > and end character offsets). Default is `positions`.
 *
 * ([Source][1])
 *
 * For efficient highlighting you should use `offsets` ([source][2]) otherwise the
 * text will be reanalyzed at search time.
 *
 * [1]: https://opensearch.org/docs/2.2/opensearch/supported-field-types/text/
 * [2]:
 *     https://opensearch.org/docs/latest/search-plugins/searching-data/highlight/#methods-of-obtaining-offsets
 */
export type OpensearchIndexTextTypeIndexOptions = "docs" | "freqs" | "positions" | "offsets";

/**
 * An OpenSearch [text string field type][1]. Text field types are analyzed for
 * better searching of human text.
 *
 * If you want to index the same text in multiple ways you can provide additional
 * types through `fields`.
 *
 * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/text/
 */
export class OpensearchIndexTextType<
    Fields extends {[key: string]: OpensearchIndexTypeBase<string, "this", {}>} = {},
> extends OpensearchIndexTypeBase<string, "this" | (keyof Fields & string), {}> {
    private readonly _analyzer: OpensearchIndexAnalysisAnalyzer;
    private readonly _indexOptions: OpensearchIndexTextTypeIndexOptions;
    private readonly _fields: Fields | undefined;

    constructor({
        analyzer,
        indexOptions = "positions",
        fields,
    }: {
        analyzer: OpensearchIndexAnalysisAnalyzer;
        indexOptions?: OpensearchIndexTextTypeIndexOptions;
        fields?: Fields;
    }) {
        super();
        this._analyzer = analyzer;
        this._indexOptions = indexOptions;
        this._fields = fields;
    }

    public readonly storedFields = {};

    public override getConfig(
        builder: OpensearchIndexConfigBuilder,
        options: {shouldStoreFields: boolean},
    ) {
        return {
            type: "text",
            index: true,
            store: options.shouldStoreFields,
            analyzer:
                typeof this._analyzer === "string"
                    ? this._analyzer
                    : this._analyzer.getConfig(builder),
            index_options: this._indexOptions,
            fields: this._fields
                ? mapObjectValues(this._fields, type => type.getConfig(builder, options))
                : undefined,
        };
    }

    public override serialize(value: string): JsonValue {
        return value;
    }

    public override deserialize(value: JsonValue | undefined): string {
        assert(typeof value === "string");
        return value;
    }
}

/**
 * An OpenSearch [search-as-you-type field type][1]. It implements best practices
 * for indexing text fields for search-as-you-type functionality. Specifically by
 * storing the fields 2grams, 3grams, and edge n-grams.
 *
 * [1]:
 *     https://opensearch.org/docs/latest/field-types/supported-field-types/search-as-you-type/
 */
export class OpensearchIndexSearchAsYouTypeType extends OpensearchIndexTypeBase<
    string,
    "this" | "_2gram" | "_3gram",
    {}
> {
    private readonly _analyzer: OpensearchIndexAnalysisAnalyzer;
    private readonly _indexOptions: OpensearchIndexTextTypeIndexOptions;

    constructor({
        analyzer,
        indexOptions = "positions",
    }: {
        analyzer: OpensearchIndexAnalysisAnalyzer;
        indexOptions?: OpensearchIndexTextTypeIndexOptions;
    }) {
        super();
        this._analyzer = analyzer;
        this._indexOptions = indexOptions;
    }

    public readonly storedFields = {};

    public override getConfig(
        builder: OpensearchIndexConfigBuilder,
        {shouldStoreFields}: {shouldStoreFields: boolean},
    ) {
        return {
            type: "search_as_you_type",
            analyzer:
                typeof this._analyzer === "string"
                    ? this._analyzer
                    : this._analyzer.getConfig(builder),
            index: true,
            store: shouldStoreFields,
            index_options: this._indexOptions,
        };
    }

    public override serialize(value: string): JsonValue {
        return value;
    }

    public override deserialize(value: JsonValue | undefined): string {
        assert(typeof value === "string");
        return value;
    }
}

export type OpensearchIndexKnnVectorTypeConfig = {
    /**
     * The number of dimensions in the vector. For example the Cohere
     * `embed-english-light-v3.0` model has 384 dimensions ([source][1]).
     *
     * [1]: https://docs.cohere.com/reference/embed
     */
    readonly dimensions: number;

    /**
     * Are vector dimensions represented as a float (4 bytes) or a byte? Defaults to
     * `float`.
     *
     * Prefer using `byte` for large scale applications since it provides a significant
     * reduction to memory usage, indexing throughput, and query latency with minimal
     * effect on recall ([source 1][1], [source 2][2]).
     *
     * Can only use the `byte` data type with the `lucene` query engine.
     *
     * [1]:
     *     https://opensearch.org/docs/latest/field-types/supported-field-types/knn-vector/#lucene-byte-vector
     * [2]: https://www.elastic.co/blog/save-space-with-byte-sized-vectors
     */
    readonly dataType?: "float" | "byte";

    /**
     * Underlying configuration of the Approximate k-NN algorithm you want to use.
     * [Config documentation][1].
     *
     * [1]:
     *     https://opensearch.org/docs/latest/search-plugins/knn/knn-index#method-definitions
     */
    readonly method: {
        /**
         * HNSW is the [only supported method][1] by all engines. IVF is supported by
         * faiss.
         *
         * HNSW (Hierarchical Navigable Small World) is state-of-the-art for efficient
         * vector search. Learn more about HNSW [here][2].
         *
         * [1]:
         *     https://opensearch.org/docs/latest/search-plugins/knn/knn-index#supported-nmslib-methods
         * [2]:
         *     https://towardsdatascience.com/similarity-search-part-4-hierarchical-navigable-small-world-hnsw-2aad4fe87d37
         */
        readonly name: "hnsw" | "ivf";

        /**
         * The function used to measure the distance between two points. [Supported
         * OpenSearch space types][1]. Check the documentation of the model you're using
         * when picking a value to see what distance function they recommend.
         *
         * From the [Cohere documentation on their v3 embedding models][2]:
         *
         * > All models return normalized embeddings and can use dot product, cosine
         * > similarity, and Euclidean distance as the similarity metric. All metrics
         * > return identical rankings.
         *
         * `l2` is OpenSearch's default. `l2` refers to Euclidean distance ([source][3]).
         * Prefer using `l2` if your model supports it (like Cohere) since it's the
         * OpenSearch default.
         *
         * [1]:
         *     https://opensearch.org/docs/latest/search-plugins/knn/approximate-knn/#spaces
         * [2]: https://txt.cohere.com/introducing-embed-v3/
         * [3]:
         *     https://aws.amazon.com/blogs/big-data/choose-the-k-nn-algorithm-for-your-billion-scale-use-case-with-opensearch/
         */
        readonly spaceType: "l1" | "l2" | "linf" | "cosinesimil";

        /**
         * The engine to use. Here's [OpenSearch's recommendation on picking an engine][1].
         *
         * > In general, nmslib outperforms both faiss and Lucene on search. However, to
         * > optimize for indexing throughput, faiss is a good option. For relatively
         * > smaller datasets (up to a few million vectors), the Lucene engine demonstrates
         * > better latencies and recall. At the same time, the size of the index is
         * > smallest compared to the other engines, which allows it to use smaller AWS
         * > instances for data nodes.
         * >
         * > Also, the Lucene engine uses a pure Java implementation and does not share any
         * > of the limitations that engines using platform-native code experience.
         * > However, one exception to this is that the maximum dimension count for the
         * > Lucene engine is 1,024, compared with 16,000 for the other engines. Refer to
         * > the sample mapping parameters in the following section to see where this is
         * > configured.
         *
         * Some other important considerations:
         *
         * - The Lucene engine supports [byte vectors][2] whereas the other engines do not.
         *   Byte vectors provide a significant reduction to memory usage, indexing
         *   throughput, and query latency with minimal effect on recall ([source 1][3],
         *   [source 2][4]).
         *
         * - The Lucene engine and faiss engine support [efficient k-NN search with
         *   filters][5]. You can see the procedures of both in the previous link. Lucene's
         *   procedure is simpler.
         *
         * I (@calebmer) recommend using Lucene unless you have a specific reason for
         * another engine. Because it supports important functionality for performance
         * (byte vectors and efficient filter search) and avoids the limitations of
         * non-Java plugins.
         *
         * [1]:
         *     https://opensearch.org/docs/latest/search-plugins/knn/approximate-knn/#recommendations-for-engines-and-cluster-node-sizing
         * [2]:
         *     https://opensearch.org/docs/latest/field-types/supported-field-types/knn-vector/#lucene-byte-vector
         * [3]:
         *     https://opensearch.org/docs/latest/field-types/supported-field-types/knn-vector/#lucene-byte-vector
         * [4]: https://www.elastic.co/blog/save-space-with-byte-sized-vectors
         * [5]: https://opensearch.org/docs/latest/search-plugins/knn/filter-search-knn/
         */
        readonly engine: "lucene" | "nmslib" | "faiss";
    } & (
        | {
              readonly name: "hnsw";
              readonly engine: "lucene";

              /**
               * See [lucene hnsw parameters][1] for more information about these.
               *
               * [1]:
               *     https://opensearch.org/docs/latest/search-plugins/knn/knn-index#hnsw-parameters-2
               */
              readonly parameters: {
                  readonly ef_construction: number;
                  readonly m: number;
              };
          }
        | {
              readonly name: "hnsw";
              readonly engine: "nmslib";

              /**
               * See [nslib hnsw parameters][1] for more information about these.
               *
               * [1]:
               *     https://opensearch.org/docs/latest/search-plugins/knn/knn-index#hnsw-parameters
               */
              readonly parameters: {
                  readonly ef_construction: number;
                  readonly m: number;
              };
          }
        | {
              readonly name: "hnsw";
              readonly engine: "faiss";

              /**
               * See [faiss hnsw parameters][1] for more information about these.
               *
               * [1]:
               *     https://opensearch.org/docs/latest/search-plugins/knn/knn-index#hnsw-parameters-1
               */
              readonly parameters: {
                  readonly ef_search: number;
                  readonly ef_construction: number;
                  readonly m: number;
                  readonly encoder: OpensearchIndexKnnVectorTypeConfigMethodParametersEncoder;
              };
          }
        | {
              readonly name: "ivf";
              readonly engine: "faiss";

              /**
               * See [faiss ivf parameters][1] for more information about these.
               *
               * [1]:
               *     https://opensearch.org/docs/latest/search-plugins/knn/knn-index#ivf-parameters
               */
              readonly parameters: {
                  readonly nlist: number;
                  readonly nprobes: number;
                  readonly encoder: OpensearchIndexKnnVectorTypeConfigMethodParametersEncoder;
              };
          }
    );
};

export type OpensearchIndexKnnVectorTypeConfigMethodParametersEncoder =
    | {
          readonly name: "flat";
      }
    | {
          readonly name: "pq";
          readonly m: number;
          readonly code_size: number;
      }
    | {
          readonly name: "sq";
          readonly parameters: {
              readonly type: "fp16";
              readonly clip: boolean;
          };
      };

/**
 * An OpenSearch [k-NN vector field type][1] for implementing semantic search.
 *
 * [1]:
 *     https://opensearch.org/docs/latest/field-types/supported-field-types/knn-vector/
 */
export class OpensearchIndexKnnVectorType extends OpensearchIndexTypeBase<
    // We have an object wrapping the vector so that it's not unwrapped by the
    // `NonNullableNonArrayType` type used by `store()`.
    {readonly data: ReadonlyArray<number>},
    "this",
    {}
> {
    private readonly _config: OpensearchIndexKnnVectorTypeConfig;

    constructor(config: OpensearchIndexKnnVectorTypeConfig) {
        super();
        this._config = config;
    }

    public readonly storedFields = {};

    public override getConfig(
        builder: OpensearchIndexConfigBuilder,
        {shouldStoreFields}: {shouldStoreFields: boolean},
    ) {
        builder.enableKnn();

        return {
            type: "knn_vector",
            index: true,
            store: shouldStoreFields,
            dimension: this._config.dimensions,
            data_type: this._config.dataType ?? "float",
            method: {
                name: this._config.method.name,
                space_type: this._config.method.spaceType,
                engine: this._config.method.engine,
                parameters: this._config.method.parameters,
            },
        };
    }

    public override serialize(value: {data: ReadonlyArray<number>}): JsonValue {
        return value.data;
    }

    public override deserialize(value: JsonValue | undefined): {data: ReadonlyArray<number>} {
        assert(Array.isArray(value));
        return {data: value};
    }
}

/**
 * An OpenSearch [array field type][1].
 *
 * [1]:
 *     https://opensearch.org/docs/latest/field-types/supported-field-types/index/#arrays
 */
export class OpensearchIndexArrayType<
    Value,
    FlattenedKeys extends string,
    StoredFields extends {[key: string]: unknown},
> extends OpensearchIndexTypeBase<ReadonlyArray<Value>, FlattenedKeys, StoredFields> {
    public readonly sourceType: OpensearchIndexTypeBase<Value, FlattenedKeys, StoredFields>;

    constructor(sourceType: OpensearchIndexTypeBase<Value, FlattenedKeys, StoredFields>) {
        super();
        this.sourceType = sourceType;
    }

    public get storedFields() {
        return this.sourceType.storedFields;
    }

    public override getConfig(
        builder: OpensearchIndexConfigBuilder,
        options: {shouldStoreFields: boolean},
    ) {
        return this.sourceType.getConfig(builder, options);
    }

    public override serialize(value: ReadonlyArray<Value>): JsonValue {
        return value.map(item => this.sourceType.serialize(item));
    }

    public override deserialize(value: JsonValue | undefined): ReadonlyArray<Value> {
        assert(Array.isArray(value));
        return value.map(item => this.sourceType.deserialize(item));
    }
}

/**
 * An OpenSearch [object field type][1] where none of the properties are indexed.
 * They are included in the document source and that's it.
 *
 * [1]:
 *     https://opensearch.org/docs/latest/field-types/supported-field-types/object/
 */
export class OpensearchIndexIgnoredObjectType<Value> extends OpensearchIndexTypeBase<
    Value,
    never,
    {}
> {
    private readonly _schema: ObjectSchema<Value> | UnionSchema<Value>;

    constructor(schema: ObjectSchema<Value> | UnionSchema<Value>) {
        super();
        this._schema = schema;
    }

    public readonly storedFields = {};

    public override getConfig() {
        return {
            type: "object",
            dynamic: false,
            enabled: false,
        };
    }

    public override serialize(value: Value): JsonValue {
        return this._schema.serialize(value) as JsonValue;
    }

    public override deserialize(value: JsonValue | undefined): Value {
        assert(value !== undefined);
        return this._schema.deserialize(value);
    }
}

type OpensearchIndexTypePrependKey<
    ParentKey extends string,
    ChildFlattenedKeys extends string,
> = ChildFlattenedKeys extends "this"
    ? ParentKey
    : `${ParentKey}.${Exclude<ChildFlattenedKeys, "this">}`;

/**
 * An OpenSearch [object field type][1]. Objects themselves are not indexed. Their
 * fields are flattened into the parent object.
 *
 * If you have an array field type of an object then the object will not maintain
 * its object structure and will instead be flattened at the root of the object!
 *
 * [1]:
 *     https://opensearch.org/docs/latest/field-types/supported-field-types/object/
 */
export class OpensearchIndexObjectType<
    Value,
    FlattenedKeys extends string,
    StoredFields extends {[key: string]: unknown},
> extends OpensearchIndexTypeBase<Value, FlattenedKeys, StoredFields> {
    private readonly _fields: ReadonlyMap<string, OpensearchIndexTypeBase<any, any, any>>;
    private readonly _computed: {
        fields: ReadonlyMap<string, OpensearchIndexTypeBase<any, any, any>>;
        compute: (value: any) => any;
    };

    public override readonly storedFields: {
        [Key in keyof StoredFields]: OpensearchIndexTypeBase<StoredFields[Key], "this", {}>;
    };

    public static new<
        const Fields extends {[key: string]: OpensearchIndexTypeBase<any, any, any>},
        const ComputedFields extends {[key: string]: OpensearchIndexTypeBase<any, any, any>} = {},
    >({
        fields,
        computed = {fields: {}, compute: () => ({})} as any,
    }: {
        fields: Fields;
        computed?: {
            fields: ComputedFields;
            compute: (value: {
                readonly [Key in keyof Fields]: OpensearchIndexTypeType<Fields[Key]>;
            }) => {
                readonly [Key in keyof ComputedFields]: OpensearchIndexTypeType<
                    ComputedFields[Key]
                >;
            };
        };
    }): OpensearchIndexObjectType<
        // `Value`:
        {
            readonly [Key in keyof Fields]: OpensearchIndexTypeType<Fields[Key]>;
        },
        // `FlattenedKeys`:
        | {
              readonly [Key in keyof Fields & string]: OpensearchIndexTypePrependKey<
                  Key,
                  OpensearchIndexTypeFlattenedKeysType<Fields[Key]>
              >;
          }[keyof Fields & string]
        | {
              readonly [Key in keyof ComputedFields & string]: OpensearchIndexTypePrependKey<
                  Key,
                  OpensearchIndexTypeFlattenedKeysType<ComputedFields[Key]>
              >;
          }[keyof ComputedFields & string],
        // `StoredFields`:
        MergeObjectIntersection<
            UnionToIntersection<
                | {
                      readonly [Key1 in keyof Fields & string]: {
                          readonly [Key2 in keyof OpensearchIndexTypeStoredFieldsType<
                              Fields[Key1]
                          > &
                              string as OpensearchIndexTypePrependKey<
                              Key1,
                              Key2
                          >]: OpensearchIndexTypeStoredFieldsType<Fields[Key1]>[Key2];
                      };
                  }[keyof Fields & string]
                | {
                      readonly [Key1 in keyof ComputedFields & string]: {
                          readonly [Key2 in keyof OpensearchIndexTypeStoredFieldsType<
                              ComputedFields[Key1]
                          > &
                              string as OpensearchIndexTypePrependKey<
                              Key1,
                              Key2
                          >]: OpensearchIndexTypeStoredFieldsType<ComputedFields[Key1]>[Key2];
                      };
                  }[keyof ComputedFields & string]
            >
        >
    > {
        return new OpensearchIndexObjectType({fields, computed});
    }

    private constructor({
        fields,
        computed,
    }: {
        fields: {[key: string]: OpensearchIndexTypeBase<any, any, any>};
        computed: {
            fields: {[key: string]: OpensearchIndexTypeBase<any, any, any>};
            compute: (value: any) => any;
        };
    }) {
        super();

        this._fields = new Map(Object.entries(fields));
        this._computed = {
            fields: new Map(Object.entries(computed.fields)),
            compute: computed.compute,
        };

        const keys = new Set<string>();
        const storedFields: {[key: string]: any} = {};

        for (const [key, type] of this.getFieldTypeByKey()) {
            assert(!keys.has(key), "Field keys must be unique");
            keys.add(key);

            for (const [storedFieldKey, storedFieldType] of Object.entries(type.storedFields)) {
                storedFields[storedFieldKey === "this" ? key : `${key}.${storedFieldKey}`] =
                    storedFieldType;
            }
        }

        this.storedFields = storedFields as any;
    }

    public getFieldTypeByKey(): Iterable<[string, OpensearchIndexTypeBase<any, any, any>]> {
        return concatIterables(this._fields, this._computed.fields);
    }

    public override getConfig(
        builder: OpensearchIndexConfigBuilder,
        options: {shouldStoreFields: boolean},
    ): {
        type: string;
        dynamic: "strict";
        properties: {[key: string]: {type: string}};
    } {
        return {
            type: "object",
            dynamic: "strict",
            properties: Object.fromEntries([
                ...mapIterable(this._fields, ([key, field]) => [
                    key,
                    field.getConfig(builder, options),
                ]),
                ...mapIterable(this._computed.fields, ([key, field]) => [
                    key,
                    field.getConfig(builder, options),
                ]),
            ]),
        };
    }

    public override serialize(value: Value): JsonObjectValue {
        const serializedValue: {[key: string]: JsonValue} = {};

        for (const [key, field] of this._fields) {
            serializedValue[key] = field.serialize((value as any)[key]);
        }

        if (this._computed.fields.size > 0) {
            const computedValue = this._computed.compute(value);
            for (const [key, field] of this._computed.fields) {
                serializedValue[key] = field.serialize(computedValue[key]);
            }
        }

        return serializedValue;
    }

    public override deserialize(value: JsonValue | undefined): Value {
        assert(isPlainObject(value));

        const deserializedValue: any = {};

        for (const [key, field] of this._fields) {
            const keyValue = value[key];
            deserializedValue[key] = field.deserialize(keyValue);
        }

        return deserializedValue;
    }
}

/**
 * Multiple OpenSearch [object field types][1] that form a union. You switch
 * between the field types with the `type` property.
 *
 * [1]:
 *     https://opensearch.org/docs/latest/field-types/supported-field-types/object/
 */
export class OpensearchIndexUnionObjectType<
    Value extends {readonly type: string},
    FlattenedKeys extends string,
    StoredFields extends {[key: string]: unknown},
> extends OpensearchIndexTypeBase<Value, FlattenedKeys, StoredFields> {
    private readonly _type: OpensearchIndexTypeBase<Value["type"], "this", {}>;
    private readonly _variants: ReadonlyMap<string, OpensearchIndexObjectType<any, any, any>>;

    public override readonly storedFields: {
        [Key in keyof StoredFields]: OpensearchIndexTypeBase<StoredFields[Key], "this", {}>;
    };

    public static new<
        const Variants extends {[key: string]: OpensearchIndexObjectType<any, any, any>},
    >({
        type,
        variants,
    }: {
        type: OpensearchIndexTypeBase<keyof Variants, "this", {}>;
        variants: Variants;
    }): OpensearchIndexUnionObjectType<
        // `Value`:
        {
            [Key in keyof Variants]: {readonly type: Key} & OpensearchIndexTypeType<Variants[Key]>;
        }[keyof Variants],
        // `FlattenedKeys`:
        | "type"
        | {
              [Key in keyof Variants]: OpensearchIndexTypeFlattenedKeysType<Variants[Key]>;
          }[keyof Variants],
        // `StoredFields`:
        MergeObjectIntersection<
            UnionToIntersection<
                {
                    [Key in keyof Variants]: OpensearchIndexTypeStoredFieldsType<Variants[Key]>;
                }[keyof Variants]
            >
        >
    > {
        return new OpensearchIndexUnionObjectType({type, variants});
    }

    private constructor({
        type,
        variants,
    }: {
        type: OpensearchIndexTypeBase<Value["type"], "this", {}>;
        variants: {[key: string]: OpensearchIndexObjectType<any, any, any>};
    }) {
        super();

        this._type = type;
        this._variants = new Map(Object.entries(variants));

        const typeByKey = new Map<string, OpensearchIndexTypeBase<any, any, any> | "Reserved">([
            ["type", "Reserved"],
        ]);
        const storedFields: {[key: string]: any} = {};

        for (const variant of this._variants.values()) {
            for (const [key, maybeNullableType] of variant.getFieldTypeByKey()) {
                // Unwrap nullable types. A type may exist in multiple variants if it's underlying
                // type is exactly the same across variants. Nullability does not effect how
                // OpenSearch indexes the type.
                let type = maybeNullableType;
                while (type instanceof OpensearchIndexNullableType) {
                    type = type.sourceType;
                }

                const existingType = typeByKey.get(key);

                assert(
                    existingType === undefined || existingType === type,
                    "If a field key is shared across variants it must be exactly the same in each variant",
                );

                typeByKey.set(key, type);

                for (const [storedFieldKey, storedFieldType] of Object.entries(type.storedFields)) {
                    storedFields[storedFieldKey === "this" ? key : `${key}.${storedFieldKey}`] =
                        storedFieldType;
                }
            }
        }

        this.storedFields = storedFields as any;
    }

    public override getConfig(
        builder: OpensearchIndexConfigBuilder,
        options: {shouldStoreFields: boolean},
    ) {
        return {
            type: "object",
            dynamic: "strict",
            properties: {
                type: this._type.getConfig(builder, options),
                ...Object.assign(
                    {},
                    ...mapIterable(
                        this._variants.values(),
                        variant => variant.getConfig(builder, options).properties,
                    ),
                ),
            },
        };
    }

    public override serialize(value: Value): JsonValue {
        const variant = assertExists(this._variants.get(value.type));
        const serializedValue = variant.serialize(value);
        (serializedValue as any).type = this._type.serialize(value.type);
        return serializedValue;
    }

    public override deserialize(value: JsonValue | undefined): Value {
        assert(isPlainObject(value));
        const type = this._type.deserialize(assertExists(value.type));
        const variant = assertExists(this._variants.get(type));
        const deserializedValue = variant.deserialize(value);
        deserializedValue.type = type;
        return deserializedValue;
    }
}

/**
 * An OpenSearch [nested field type][1].
 *
 * Be careful when using nested fields! Their performance can be pretty bad.
 * Internally nested objects are indexed as separate Lucene docs. Carefully review
 * the performance characteristics of nested objects before using them.
 *
 * [1]:
 *     https://opensearch.org/docs/latest/field-types/supported-field-types/nested/
 */
export class OpensearchIndexNestedType<
    Value,
    FlattenedKeys extends string,
    StoredFields extends {[key: string]: unknown},
> extends OpensearchIndexTypeBase<ReadonlyArray<Value>, FlattenedKeys, StoredFields> {
    private readonly _sourceType: OpensearchIndexObjectType<Value, FlattenedKeys, StoredFields>;

    constructor(sourceType: OpensearchIndexObjectType<Value, FlattenedKeys, StoredFields>) {
        super();
        this._sourceType = sourceType;
    }

    public get storedFields() {
        return this._sourceType.storedFields;
    }

    public override getConfig(
        builder: OpensearchIndexConfigBuilder,
        options: {shouldStoreFields: boolean},
    ) {
        const config = this._sourceType.getConfig(builder, options);
        assert(config.type === "object");
        return {
            type: "nested",
            ...omitObject(config, ["type"]),
        };
    }

    public override serialize(value: ReadonlyArray<Value>): JsonValue {
        return value.map(item => this._sourceType.serialize(item));
    }

    public override deserialize(value: JsonValue | undefined): ReadonlyArray<Value> {
        assert(Array.isArray(value));
        return value.map(item => this._sourceType.deserialize(item));
    }
}
