import {parseISO} from "date-fns";
import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {JsonValue} from "~/shared/helpers/types/json_value.js";
import {maxLabelStringLength} from "~/shared/schema/label_string_schema.js";
import {ObjectSchema} from "~/shared/schema/schema.js";

export type OpensearchIndexTypeType<Type extends OpensearchIndexTypeBase<any>> =
    Type extends OpensearchIndexTypeBase<infer Value> ? Value : never;

/**
 * A type to be added to an [OpenSearch index mapping][1]. This abstraction
 * provides type safety to OpenSearch documents.
 *
 * [1]: https://opensearch.org/docs/latest/field-types/index/
 */
export abstract class OpensearchIndexTypeBase<Value> {
    /**
     * Gets the config object we pass into the OpenSearch index create API.
     */
    public abstract getConfig(): {type: string};

    /**
     * Serializes our value to a JSON value to be passed on to OpenSearch.
     */
    public abstract serialize(value: Value): JsonValue;

    /**
     * Deserializes a JSON value we received from OpenSearch that was previously
     * serialized by the same type.
     */
    public abstract deserialize(value: JsonValue): Value;

    public nullable(): OpensearchIndexTypeBase<Value | null> {
        return new OpensearchIndexNullableType(this);
    }

    public validate<NewValue extends Value>(
        validate: (value: Value) => value is NewValue,
    ): OpensearchIndexTypeBase<NewValue> {
        return new OpensearchIndexValidatedType(this, validate);
    }

    public transform<NewValue>({
        serialize,
        deserialize,
    }: {
        serialize: (newValue: NewValue) => Value;
        deserialize: (oldValue: Value) => NewValue;
    }): OpensearchIndexTypeBase<NewValue> {
        return new OpensearchIndexTransformedType(this, {
            serialize,
            deserialize,
        });
    }
}

/**
 * An OpenSearch type that allows null.
 */
class OpensearchIndexNullableType<Value> extends OpensearchIndexTypeBase<Value | null> {
    private readonly _sourceType: OpensearchIndexTypeBase<Value>;

    constructor(sourceType: OpensearchIndexTypeBase<Value>) {
        super();
        this._sourceType = sourceType;
    }

    public override getConfig() {
        return this._sourceType.getConfig();
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
class OpensearchIndexTransformedType<OldValue, NewValue> extends OpensearchIndexTypeBase<NewValue> {
    private readonly _sourceType: OpensearchIndexTypeBase<OldValue>;
    private readonly _serialize: (newValue: NewValue) => OldValue;
    private readonly _deserialize: (oldValue: OldValue) => NewValue;

    constructor(
        sourceType: OpensearchIndexTypeBase<OldValue>,
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

    public override getConfig() {
        return this._sourceType.getConfig();
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
> extends OpensearchIndexTypeBase<NewValue> {
    private readonly _sourceType: OpensearchIndexTypeBase<OldValue>;
    private readonly _validate: (value: OldValue) => value is NewValue;

    constructor(
        sourceType: OpensearchIndexTypeBase<OldValue>,
        validate: (value: OldValue) => value is NewValue,
    ) {
        super();
        this._sourceType = sourceType;
        this._validate = validate;
    }

    public override getConfig() {
        return this._sourceType.getConfig();
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
};

function getOpensearchIndexTypeCapabilitiesConfig({
    isFilterable = false,
    isSortable = false,
}: OpensearchIndexTypeCapabilities) {
    return {
        index: isFilterable,
        doc_values: isSortable,
    };
}

/**
 * An OpenSearch [boolean field type][1].
 *
 * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/boolean/
 */
export class OpensearchIndexBooleanType extends OpensearchIndexTypeBase<boolean> {
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
export class OpensearchIndexByteType extends OpensearchIndexTypeBase<number> {
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
export class OpensearchIndexIntegerType extends OpensearchIndexTypeBase<number> {
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
 * An OpenSearch [date field type][1].
 *
 * [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/date/
 */
export class OpensearchIndexDateType extends OpensearchIndexTypeBase<Date> {
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
export class OpensearchIndexBinaryType extends OpensearchIndexTypeBase<Uint8Array> {
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
export class OpensearchIndexKeywordType extends OpensearchIndexTypeBase<string> {
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
export class OpensearchIndexTextType extends OpensearchIndexTypeBase<string> {
    private readonly _analyzer: string;

    constructor({analyzer}: {analyzer: string}) {
        super();
        this._analyzer = analyzer;
    }

    public override getConfig() {
        return {
            type: "text",
            analyzer: this._analyzer,
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
export class OpensearchIndexArrayType<Value> extends OpensearchIndexTypeBase<ReadonlyArray<Value>> {
    private readonly _itemType: OpensearchIndexTypeBase<Value>;

    constructor(itemType: OpensearchIndexTypeBase<Value>) {
        super();
        this._itemType = itemType;
    }

    public override getConfig() {
        return this._itemType.getConfig();
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
export class OpensearchIndexIgnoredObjectType<Value> extends OpensearchIndexTypeBase<Value> {
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
export class OpensearchIndexObjectType<Value> extends OpensearchIndexTypeBase<Value> {
    private readonly _fields: {[key: string]: OpensearchIndexTypeBase<any>};
    private readonly _computed: {
        fields: {[key: string]: OpensearchIndexTypeBase<any>};
        compute: (value: any) => any;
    };

    public static new<
        Fields extends {[key: string]: OpensearchIndexTypeBase<any>},
        ComputedFields extends {[key: string]: OpensearchIndexTypeBase<any>},
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
    }): OpensearchIndexObjectType<{
        readonly [Key in keyof Fields]: OpensearchIndexTypeType<Fields[Key]>;
    }> {
        return new OpensearchIndexObjectType({fields, computed});
    }

    private constructor({
        fields,
        computed,
    }: {
        fields: {[key: string]: OpensearchIndexTypeBase<any>};
        computed: {
            fields: {[key: string]: OpensearchIndexTypeBase<any>};
            compute: (value: any) => any;
        };
    }) {
        super();

        this._fields = fields;
        this._computed = computed;

        const keys = new Set<string>();

        for (const key of this.getFieldKeys()) {
            assert(!keys.has(key), "Field keys must be unique");
            keys.add(key);
        }
    }

    public getFieldKeys() {
        return [...Object.keys(this._fields), ...Object.keys(this._computed.fields)];
    }

    public override getConfig(): {
        type: string;
        dynamic: "strict";
        properties: {[key: string]: {type: string}};
    } {
        return {
            type: "object",
            dynamic: "strict",
            properties: {
                ...mapObjectValues(this._fields, field => field.getConfig()),
                ...mapObjectValues(this._computed.fields, field => field.getConfig()),
            },
        };
    }

    public override serialize(value: Value): JsonValue {
        return mapObjectValues(this._fields, (field, key) => field.serialize((value as any)[key]));
    }

    public override deserialize(value: JsonValue): Value {
        assert(isPlainObject(value));
        return mapObjectValues(this._fields, (field, key) => {
            const keyValue = value[key];
            assert(keyValue !== undefined);
            return field.deserialize(keyValue);
        }) as Value;
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
> extends OpensearchIndexTypeBase<Value> {
    private readonly _type: OpensearchIndexTypeBase<Value["type"]>;
    private readonly _variants: {[key: string]: OpensearchIndexObjectType<any>};

    public static new<Variants extends {[key: string]: OpensearchIndexObjectType<any>}>({
        type,
        variants,
    }: {
        type: OpensearchIndexTypeBase<keyof Variants>;
        variants: Variants;
    }): OpensearchIndexUnionObjectType<
        {
            [Key in keyof Variants]: {readonly type: Key} & OpensearchIndexTypeType<Variants[Key]>;
        }[keyof Variants]
    > {
        return new OpensearchIndexUnionObjectType({type, variants});
    }

    private constructor({
        type,
        variants,
    }: {
        type: OpensearchIndexTypeBase<Value["type"]>;
        variants: {[key: string]: OpensearchIndexObjectType<any>};
    }) {
        super();

        this._type = type;
        this._variants = variants;

        const keys = new Set(["type"]);

        for (const variant of Object.values(this._variants)) {
            for (const key of variant.getFieldKeys()) {
                assert(!keys.has(key), "Field keys across variants must be unique");
                keys.add(key);
            }
        }
    }

    public override getConfig() {
        return {
            type: "object",
            dynamic: "strict",
            properties: {
                type: this._type.getConfig(),
                ...Object.assign(
                    {},
                    ...Object.values(this._variants).map(variant => variant.getConfig().properties),
                ),
            },
        };
    }

    public override serialize(value: Value): JsonValue {
        const variant = assertExists(this._variants[value.type]);
        const serializedValue = variant.serialize(value);
        (serializedValue as any).type = this._type.serialize(value.type);
        return serializedValue;
    }

    public override deserialize(value: JsonValue): Value {
        assert(isPlainObject(value));
        const type = this._type.deserialize(assertExists(value.type));
        const variant = assertExists(this._variants[type]);
        const deserializedValue = variant.deserialize(value);
        deserializedValue.type = type;
        return deserializedValue;
    }
}
