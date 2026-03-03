/**
 * A description of the value serialized by a given schema.
 *
 * We use this description for performing static analysis on our schema. For
 * example, we can tell if a new schema is backwards compatible with an existing
 * schema.
 *
 * This is in the `types` directory so that we don't accidentally import code for
 * statically analyzing the `Schema` class (e.g. forwards/backwards compatibility
 * checking code).
 */
export type SchemaSerializedValueDescription =
    | SchemaSerializedScalarValueDescription
    | SchemaSerializedCompositeValueDescription;

// Schema descriptions that don't recursively reference other schema descriptions.
export type SchemaSerializedScalarValueDescription =
    | {readonly type: "Unknown"}
    | {readonly type: "Boolean"}
    | {readonly type: "Float"}
    | {readonly type: "Integer"}
    | {readonly type: "Uint64"}
    | {readonly type: "String"}
    | {readonly type: "Id"}
    | {readonly type: "Bytes"}
    | {readonly type: "Date"}
    | {readonly type: "Value"; readonly value: null | boolean | number | string}
    | {readonly type: "Enum"; readonly values: ReadonlyArray<string | number | boolean>};

// Schema descriptions which are composed of multiple recursively nested schema
// descriptions.
export type SchemaSerializedCompositeValueDescription =
    | SchemaSerializedNullableValueDescription
    | SchemaSerializedArrayValueDescription
    | SchemaSerializedObjectValueDescription
    | SchemaSerializedUnionValueDescription
    | SchemaSerializedBooleanUnionValueDescription
    | SchemaSerializedSetValueDescription
    | SchemaSerializedMapValueDescription
    | SchemaSerializedTupleValueDescription;

export type SchemaSerializedNullableValueDescription = {
    readonly type: "Nullable";
    readonly schema: SchemaSerializedValueDescription;
};

export type SchemaSerializedArrayValueDescription = {
    readonly type: "Array";
    readonly itemSchema: SchemaSerializedValueDescription;
};

export type SchemaSerializedObjectValueDescription = {
    readonly type: "Object";
    readonly propertySchemaByKey: {
        readonly [key: string]: SchemaSerializedObjectValuePropertyDescription;
    };
};

export type SchemaSerializedObjectValuePropertyDescription = {
    readonly valueSchema: SchemaSerializedValueDescription;
    readonly optional: boolean;
};

export type SchemaSerializedUnionValueDescription = {
    readonly type: "Union";
    readonly typeKey: string;
    readonly defaultTypeValue?: string;
    readonly variantSchemaByTypeValue: {
        readonly [type: string]: SchemaSerializedValueDescription;
    };
};

export type SchemaSerializedBooleanUnionValueDescription = {
    readonly type: "BooleanUnion";
    readonly typeKey: string;
    readonly trueSchema: SchemaSerializedValueDescription;
    readonly falseSchema: SchemaSerializedValueDescription;
};

export type SchemaSerializedSetValueDescription = {
    readonly type: "Set";
    readonly valueSchema: SchemaSerializedValueDescription;
};

export type SchemaSerializedMapValueDescription = {
    readonly type: "Map";
    readonly keySchema: SchemaSerializedValueDescription;
    readonly valueSchema: SchemaSerializedValueDescription;
};

export type SchemaSerializedTupleValueDescription = {
    readonly type: "Tuple";
    readonly elementSchemas: ReadonlyArray<SchemaSerializedValueDescription>;
};
