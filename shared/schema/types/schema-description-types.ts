/**
 * A description of the value serialized by a given schema.
 *
 * We use this description for performing static analysis on our schema. For
 * example, we can tell if a new schema is backwards compatible with an
 * existing schema.
 *
 * This is in the `types` directory so that we don't accidentally import code
 * for statically analyzing the `Schema` class (e.g. forwards/backwards
 * compatibility checking code).
 */
export type SchemaSerializedValueDescription =
    | SchemaSerializedScalarValueDescription
    | SchemaSerializedNullableValueDescription
    | SchemaSerializedArrayValueDescription
    | SchemaSerializedObjectValueDescription
    | SchemaSerializedUnionValueDescription
    | SchemaSerializedResultValueDescription;

export type SchemaSerializedScalarValueDescription =
    | {readonly type: "Unknown"}
    | {readonly type: "Boolean"}
    | {readonly type: "Float"}
    | {readonly type: "Integer"}
    | {readonly type: "String"}
    | {readonly type: "Id"}
    | {readonly type: "Bytes"}
    | {readonly type: "Value"; readonly value: number | boolean | string};

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
    readonly variantSchemaByType: {
        readonly [type: string]: SchemaSerializedValueDescription;
    };
};

export type SchemaSerializedResultValueDescription = {
    readonly type: "Result";
    readonly okSchema: SchemaSerializedValueDescription;
    readonly errorSchema: SchemaSerializedValueDescription;
};
