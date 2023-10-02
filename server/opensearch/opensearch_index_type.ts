import {parseISO} from "date-fns";
import {OpensearchIndexConfigBuilder} from "~/server/opensearch/opensearch_index.js";
import {OpensearchIndexAnalysisAnalyzer} from "~/server/opensearch/opensearch_index_analysis.js";
import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";
import {JsonValue} from "~/shared/helpers/types/json_value.js";
import {maxLabelStringLength} from "~/shared/schema/helpers/label_string_schema.js";
import {ObjectSchema} from "~/shared/schema/schema.js";

export type OpensearchIndexTypeType<Type extends OpensearchIndexTypeBase<any, any>> =
    Type extends OpensearchIndexTypeBase<infer Value, any> ? Value : never;

export type OpensearchIndexTypeFlattenedKeysType<Type extends OpensearchIndexTypeBase<any, any>> =
    Type extends OpensearchIndexTypeBase<any, infer FlattenedKeys> ? FlattenedKeys : never;

/**
 * A type to be added to an [OpenSearch index mapping][1]. This abstraction
 * provides type safety to OpenSearch documents.
 *
 * [1]: https://opensearch.org/docs/latest/field-types/index/
 */
export abstract class OpensearchIndexTypeBase<Value, FlattenedKeys extends string> {
    /**
     * Gets the config object we pass into the OpenSearch index create API.
     */
    public abstract getConfig(builder: OpensearchIndexConfigBuilder): {type: string};

    /**
     * Serializes our value to a JSON value to be passed on to OpenSearch.
     */
    public abstract serialize(value: Value): JsonValue;

    /**
     * Deserializes a JSON value we received from OpenSearch that was previously
     * serialized by the same type.
     */
    public abstract deserialize(value: JsonValue): Value;

    public nullable(): OpensearchIndexTypeBase<Value | null, FlattenedKeys> {
        return new OpensearchIndexNullableType(this);
    }

    public validate<NewValue extends Value>(
        validate: (value: Value) => value is NewValue,
    ): OpensearchIndexTypeBase<NewValue, FlattenedKeys> {
        return new OpensearchIndexValidatedType(this, validate);
    }

    public transform<NewValue>({
        serialize,
        deserialize,
    }: {
        serialize: (newValue: NewValue) => Value;
        deserialize: (oldValue: Value) => NewValue;
    }): OpensearchIndexTypeBase<NewValue, FlattenedKeys> {
        return new OpensearchIndexTransformedType(this, {
            serialize,
            deserialize,
        });
    }
}

/**
 * An OpenSearch type that allows null.
 */
class OpensearchIndexNullableType<
    Value,
    FlattenedKeys extends string,
> extends OpensearchIndexTypeBase<Value | null, FlattenedKeys> {
    private readonly _sourceType: OpensearchIndexTypeBase<Value, FlattenedKeys>;

    constructor(sourceType: OpensearchIndexTypeBase<Value, FlattenedKeys>) {
        super();
        this._sourceType = sourceType;
    }

    public override getConfig(builder: OpensearchIndexConfigBuilder) {
        return this._sourceType.getConfig(builder);
    }

    public override serialize(value: Value | null): JsonValue {
        if (value === null) return null;
        return this._sourceType.serialize(value);
    }

    public override deserialize(value: JsonValue): Value | null {
        if (value === null) return null;
        return this._sourceType.deserialize(value);
    }
}

/**
 * An OpenSearch type that has been transformed to a different value at
 * runtime. Useful if you want to represent a value as JSON in OpenSearch but
 * as some custom class in JavaScript.
 */
class OpensearchIndexTransformedType<
    OldValue,
    NewValue,
    FlattenedKeys extends string,
> extends OpensearchIndexTypeBase<NewValue, FlattenedKeys> {
    private readonly _sourceType: OpensearchIndexTypeBase<OldValue, FlattenedKeys>;
    private readonly _serialize: (newValue: NewValue) => OldValue;
    private readonly _deserialize: (oldValue: OldValue) => NewValue;

    constructor(
        sourceType: OpensearchIndexTypeBase<OldValue, FlattenedKeys>,
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

    public override getConfig(builder: OpensearchIndexConfigBuilder) {
        return this._sourceType.getConfig(builder);
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
 * anything on serialization for these values but we do need to run a
 * validation function on deserialization.
 */
class OpensearchIndexValidatedType<
    OldValue,
    NewValue extends OldValue,
    FlattenedKeys extends string,
> extends OpensearchIndexTypeBase<NewValue, FlattenedKeys> {
    private readonly _sourceType: OpensearchIndexTypeBase<OldValue, FlattenedKeys>;
    private readonly _validate: (value: OldValue) => value is NewValue;

    constructor(
        sourceType: OpensearchIndexTypeBase<OldValue, FlattenedKeys>,
        validate: (value: OldValue) => value is NewValue,
    ) {
        super();
        this._sourceType = sourceType;
        this._validate = validate;
    }

    public override getConfig(builder: OpensearchIndexConfigBuilder) {
        return this._sourceType.getConfig(builder);
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

/**
 * Capabilities available for OpenSearch types. The OpenSearch API asks to
 * enable/disable functionality for the type (e.g. `index` for allowing
 * searching of a field and `doc_values` to allow for aggregations, sorting,
 * or scripting).
 *
 * But we want to provide a capabilities API since that leads to clearer code.
 * We describe in this object what we want the type to do and translate that to
 * config which enables/disable certain functionality. If we eventually add a
 * typed search API then we should also use these capabilities to throw an
 * error if you say filter or sort by a type you're not allowed to even if the
 * underlying functionality exists.
 *
 * Some composite types like `object` do not have these capabilities.
 *
 * You must explicitly opt-in to capabilities. By default OpenSearch always
 * sets `index` to true but we force users of our abstraction to explicitly
 * designate that they want filtering.
 */
type OpensearchIndexTypeCapabilities = {
    readonly isFilterable?: boolean;
    readonly isSortable?: boolean;
    readonly isUsableInScripts?: boolean;
};

function getOpensearchIndexTypeCapabilitiesConfig({
    isFilterable = false,
    isSortable = false,
    isUsableInScripts = false,
}: OpensearchIndexTypeCapabilities) {
    return {
        index: isFilterable,
        doc_values: isSortable || isUsableInScripts,
    };
}

/**
 * An OpenSearch [boolean field type][1].
 *
 * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/boolean/
 */
export class OpensearchIndexBooleanType extends OpensearchIndexTypeBase<boolean, "this"> {
    private readonly _capabilities: OpensearchIndexTypeCapabilities;

    constructor(capabilities: OpensearchIndexTypeCapabilities = {}) {
        super();
        this._capabilities = capabilities;
    }

    public override getConfig() {
        return {
            type: "boolean",
            ...getOpensearchIndexTypeCapabilitiesConfig(this._capabilities),
        };
    }

    public override serialize(value: boolean): JsonValue {
        return value;
    }

    public override deserialize(value: JsonValue): boolean {
        assert(typeof value === "boolean");
        return value;
    }
}

/**
 * An OpenSearch [byte numeric field type][1]. A signed 8-bit integer. Minimum
 * is −128. Maximum is 127.
 *
 * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/numeric/
 */
export class OpensearchIndexByteType extends OpensearchIndexTypeBase<number, "this"> {
    private readonly _capabilities: OpensearchIndexTypeCapabilities;

    constructor(capabilities: OpensearchIndexTypeCapabilities = {}) {
        super();
        this._capabilities = capabilities;
    }

    public override getConfig() {
        return {
            type: "byte",
            ...getOpensearchIndexTypeCapabilitiesConfig(this._capabilities),
        };
    }

    public override serialize(value: number): JsonValue {
        assert(Number.isInteger(value));
        assert(-128 <= value && value <= 127);
        return value;
    }

    public override deserialize(value: JsonValue): number {
        assert(typeof value === "number");
        return value;
    }
}

/**
 * An OpenSearch [integer numeric field type][1]. A signed 32-bit integer.
 * Minimum is −2^31. Maximum is 2^31 − 1.
 *
 * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/numeric/
 */
export class OpensearchIndexIntegerType extends OpensearchIndexTypeBase<number, "this"> {
    private readonly _capabilities: OpensearchIndexTypeCapabilities;

    constructor(capabilities: OpensearchIndexTypeCapabilities = {}) {
        super();
        this._capabilities = capabilities;
    }

    public override getConfig() {
        return {
            type: "integer",
            ...getOpensearchIndexTypeCapabilitiesConfig(this._capabilities),
        };
    }

    public override serialize(value: number): JsonValue {
        assert(Number.isInteger(value));
        assert(-(2 ** 31) <= value && value <= 2 ** 31 - 1);
        return value;
    }

    public override deserialize(value: JsonValue): number {
        assert(typeof value === "number");
        return value;
    }
}

/**
 * An OpenSearch [`long` numeric field type][1]. A signed 64-bit
 * integer. Minimum is -2^63. Maximum is 2^63 − 1.
 *
 * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/numeric/
 */
export class OpensearchIndexLongType extends OpensearchIndexTypeBase<bigint, "this"> {
    private readonly _capabilities: OpensearchIndexTypeCapabilities;

    constructor(capabilities: OpensearchIndexTypeCapabilities = {}) {
        super();
        this._capabilities = capabilities;
    }

    public override getConfig() {
        return {
            type: "long",
            ...getOpensearchIndexTypeCapabilitiesConfig(this._capabilities),
        };
    }

    public override serialize(value: bigint): JsonValue {
        assert(0n <= value && value <= 2 ** 64 - 1);
        return value.toString();
    }

    public override deserialize(value: JsonValue): bigint {
        assert(typeof value === "string");
        return BigInt(value);
    }
}

/**
 * An OpenSearch [date field type][1].
 *
 * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/date/
 */
export class OpensearchIndexDateType extends OpensearchIndexTypeBase<Date, "this"> {
    private readonly _capabilities: OpensearchIndexTypeCapabilities;

    constructor(capabilities: OpensearchIndexTypeCapabilities = {}) {
        super();
        this._capabilities = capabilities;
    }

    public override getConfig() {
        return {
            type: "date",
            format: "strict_date_time",
            ...getOpensearchIndexTypeCapabilitiesConfig(this._capabilities),
        };
    }

    public override serialize(value: Date): JsonValue {
        return value.toISOString();
    }

    public override deserialize(value: JsonValue): Date {
        assert(typeof value === "string");
        return parseISO(value);
    }
}

/**
 * An OpenSearch [binary field type][1]. Raw base64 encoded binary data that is
 * not searchable.
 *
 * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/binary/
 */
export class OpensearchIndexBinaryType extends OpensearchIndexTypeBase<Uint8Array, "this"> {
    public override getConfig() {
        return {
            type: "binary",
            doc_values: false,
        };
    }

    public override serialize(value: Uint8Array): JsonValue {
        return encodeBase64(value);
    }

    public override deserialize(value: JsonValue): Uint8Array {
        assert(typeof value === "string");
        return decodeBase64(value);
    }
}

/**
 * An OpenSearch [keyword string field type][1]. Keyword field types are not
 * analyzed so are filterable/sortable as-is with no understanding of human
 * language.
 *
 * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/keyword/
 */
export class OpensearchIndexKeywordType extends OpensearchIndexTypeBase<string, "this"> {
    private readonly _capabilities: OpensearchIndexTypeCapabilities;

    constructor(capabilities: OpensearchIndexTypeCapabilities = {}) {
        super();
        this._capabilities = capabilities;
    }

    public override getConfig() {
        return {
            type: "keyword",
            ignore_above: maxLabelStringLength,
            ...getOpensearchIndexTypeCapabilitiesConfig(this._capabilities),
        };
    }

    public override serialize(value: string): JsonValue {
        assert(value.length <= maxLabelStringLength);
        return value;
    }

    public override deserialize(value: JsonValue): string {
        assert(typeof value === "string");
        return value;
    }
}

/**
 * An OpenSearch [text string field type][1]. Text field types are analyzed for
 * better searching of human text.
 *
 * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/text/
 */
export class OpensearchIndexTextType extends OpensearchIndexTypeBase<string, "this"> {
    private readonly _analyzer: OpensearchIndexAnalysisAnalyzer;

    constructor({analyzer}: {analyzer: OpensearchIndexAnalysisAnalyzer}) {
        super();
        this._analyzer = analyzer;
    }

    public override getConfig(builder: OpensearchIndexConfigBuilder) {
        return {
            type: "text",
            analyzer:
                typeof this._analyzer === "string"
                    ? this._analyzer
                    : this._analyzer.getConfig(builder),
            index: true,
        };
    }

    public override serialize(value: string): JsonValue {
        return value;
    }

    public override deserialize(value: JsonValue): string {
        assert(typeof value === "string");
        return value;
    }
}

/**
 * An OpenSearch [search-as-you-type field type][1]. It implements best
 * practices for indexing text fields for search-as-you-type functionality.
 * Specifically by storing the fields 2grams, 3grams, and edge n-grams.
 *
 * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/search-as-you-type/
 */
export class OpensearchIndexSearchAsYouTypeType extends OpensearchIndexTypeBase<
    string,
    "this" | "_2gram" | "_3gram"
> {
    private readonly _analyzer: OpensearchIndexAnalysisAnalyzer;

    constructor({analyzer}: {analyzer: OpensearchIndexAnalysisAnalyzer}) {
        super();
        this._analyzer = analyzer;
    }

    public override getConfig(builder: OpensearchIndexConfigBuilder) {
        return {
            type: "search_as_you_type",
            analyzer:
                typeof this._analyzer === "string"
                    ? this._analyzer
                    : this._analyzer.getConfig(builder),
            index: true,
        };
    }

    public override serialize(value: string): JsonValue {
        return value;
    }

    public override deserialize(value: JsonValue): string {
        assert(typeof value === "string");
        return value;
    }
}

/**
 * An OpenSearch [array field type][1].
 *
 * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/index/#arrays
 */
export class OpensearchIndexArrayType<
    Value,
    FlattenedKeys extends string,
> extends OpensearchIndexTypeBase<ReadonlyArray<Value>, FlattenedKeys> {
    private readonly _itemType: OpensearchIndexTypeBase<Value, FlattenedKeys>;

    constructor(itemType: OpensearchIndexTypeBase<Value, FlattenedKeys>) {
        super();
        this._itemType = itemType;
    }

    public override getConfig(builder: OpensearchIndexConfigBuilder) {
        return this._itemType.getConfig(builder);
    }

    public override serialize(value: ReadonlyArray<Value>): JsonValue {
        return value.map(item => this._itemType.serialize(item));
    }

    public override deserialize(value: JsonValue): ReadonlyArray<Value> {
        assert(Array.isArray(value));
        return value.map(item => this._itemType.deserialize(item));
    }
}

/**
 * An OpenSearch [object field type][1] where none of the properties are
 * indexed. They are included in the document source and that's it.
 *
 * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/object/
 */
export class OpensearchIndexIgnoredObjectType<Value> extends OpensearchIndexTypeBase<
    Value,
    "this"
> {
    private readonly _schema: ObjectSchema<Value>;

    constructor(schema: ObjectSchema<Value>) {
        super();
        this._schema = schema;
    }

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

    public override deserialize(value: JsonValue): Value {
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
 * An OpenSearch [object field type][1]. Objects themselves are not indexed.
 * Their fields are flattened into the parent object.
 *
 * If you have an array field type of an object then the object will not
 * maintain its object structure and will instead be flattened at the root of
 * the object!
 *
 * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/object/
 */
export class OpensearchIndexObjectType<
    Value,
    FlattenedKeys extends string,
> extends OpensearchIndexTypeBase<Value, FlattenedKeys> {
    private readonly _fields: ReadonlyMap<string, OpensearchIndexTypeBase<any, any>>;
    private readonly _computed: {
        fields: ReadonlyMap<string, OpensearchIndexTypeBase<any, any>>;
        compute: (value: any) => any;
    };

    public static new<
        const Fields extends {[key: string]: OpensearchIndexTypeBase<any, any>},
        const ComputedFields extends {[key: string]: OpensearchIndexTypeBase<any, any>} = {},
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
        {
            readonly [Key in keyof Fields]: OpensearchIndexTypeType<Fields[Key]>;
        },
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
          }[keyof ComputedFields & string]
    > {
        return new OpensearchIndexObjectType({fields, computed});
    }

    private constructor({
        fields,
        computed,
    }: {
        fields: {[key: string]: OpensearchIndexTypeBase<any, any>};
        computed: {
            fields: {[key: string]: OpensearchIndexTypeBase<any, any>};
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

        for (const key of this.getFieldKeys()) {
            assert(!keys.has(key), "Field keys must be unique");
            keys.add(key);
        }
    }

    public getFieldKeys() {
        return [...this._fields.keys(), ...this._computed.fields.keys()];
    }

    public override getConfig(builder: OpensearchIndexConfigBuilder): {
        type: string;
        dynamic: "strict";
        properties: {[key: string]: {type: string}};
    } {
        return {
            type: "object",
            dynamic: "strict",
            properties: Object.fromEntries([
                ...mapIterable(this._fields, ([key, field]) => [key, field.getConfig(builder)]),
                ...mapIterable(this._computed.fields, ([key, field]) => [
                    key,
                    field.getConfig(builder),
                ]),
            ]),
        };
    }

    public override serialize(value: Value): JsonValue {
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

    public override deserialize(value: JsonValue): Value {
        assert(isPlainObject(value));

        const deserializedValue: any = {};

        for (const [key, field] of this._fields) {
            const keyValue = value[key];
            assert(keyValue !== undefined);
            deserializedValue[key] = field.deserialize(keyValue);
        }

        return deserializedValue;
    }
}

/**
 * Multiple OpenSearch [object field types][1] that form a union. You switch
 * between the field types with the `type` property.
 *
 * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/object/
 */
export class OpensearchIndexUnionObjectType<
    Value extends {readonly type: string},
    FlattenedKeys extends string,
> extends OpensearchIndexTypeBase<Value, FlattenedKeys> {
    private readonly _type: OpensearchIndexTypeBase<Value["type"], "this">;
    private readonly _variants: ReadonlyMap<string, OpensearchIndexObjectType<any, any>>;

    public static new<const Variants extends {[key: string]: OpensearchIndexObjectType<any, any>}>({
        type,
        variants,
    }: {
        type: OpensearchIndexTypeBase<keyof Variants, "this">;
        variants: Variants;
    }): OpensearchIndexUnionObjectType<
        {
            [Key in keyof Variants]: {readonly type: Key} & OpensearchIndexTypeType<Variants[Key]>;
        }[keyof Variants],
        | "type"
        | {
              [Key in keyof Variants]: OpensearchIndexTypeFlattenedKeysType<Variants[Key]>;
          }[keyof Variants]
    > {
        return new OpensearchIndexUnionObjectType({type, variants});
    }

    private constructor({
        type,
        variants,
    }: {
        type: OpensearchIndexTypeBase<Value["type"], "this">;
        variants: {[key: string]: OpensearchIndexObjectType<any, any>};
    }) {
        super();

        this._type = type;
        this._variants = new Map(Object.entries(variants));

        const keys = new Set(["type"]);

        for (const variant of this._variants.values()) {
            for (const key of variant.getFieldKeys()) {
                assert(!keys.has(key), "Field keys across variants must be unique");
                keys.add(key);
            }
        }
    }

    public override getConfig(builder: OpensearchIndexConfigBuilder) {
        return {
            type: "object",
            dynamic: "strict",
            properties: {
                type: this._type.getConfig(builder),
                ...Object.assign(
                    {},
                    ...mapIterable(
                        this._variants.values(),
                        variant => variant.getConfig(builder).properties,
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

    public override deserialize(value: JsonValue): Value {
        assert(isPlainObject(value));
        const type = this._type.deserialize(assertExists(value.type));
        const variant = assertExists(this._variants.get(type));
        const deserializedValue = variant.deserialize(value);
        deserializedValue.type = type;
        return deserializedValue;
    }
}
