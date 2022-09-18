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
export type SchemaDescription =
    | SchemaScalarDescription
    | SchemaNullableDescription
    | SchemaArrayDescription
    | SchemaObjectDescription
    | SchemaUnionDescription;

export type SchemaScalarDescription =
    | {readonly type: "Boolean"}
    | {readonly type: "Float"}
    | {readonly type: "Integer"}
    | {readonly type: "String"}
    | {readonly type: "Bytes"}
    | {readonly type: "Value"; readonly value: number | boolean | string};

export type SchemaNullableDescription = {
    readonly type: "Nullable";
    readonly schema: SchemaDescription;
};

export type SchemaArrayDescription = {
    readonly type: "Array";
    readonly itemSchema: SchemaDescription;
};

export type SchemaObjectDescription = {
    readonly type: "Object";
    readonly propertySchemaByKey: {
        readonly [key: string]: SchemaObjectPropertyDescription;
    };
};

export type SchemaObjectPropertyDescription = {
    readonly valueSchema: SchemaDescription;
    readonly optional: boolean;
};

export type SchemaUnionDescription = {
    readonly type: "Union";
    readonly variantSchemaByType: {
        readonly [type: string]: SchemaDescription;
    };
};
