import {TracerEventFlatDataSchema} from "~/server/tracer/tracer_event_data_schema.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";
import {convertCamelCaseToSnakeCase} from "~/shared/helpers/string/convert_camel_case_to_snake_case.js";
import {SchemaWithOnlyDeserialization} from "~/shared/schema/schema.js";

type SchemaLike = SchemaWithOnlyDeserialization<unknown> & {
    getDescription(): {type: string};
};

/**
 * Checks if a value is a Schema object (has getDescription method).
 * Schema objects are class instances, not plain objects, so we check for the method directly.
 */
function isSchema(value: unknown): value is SchemaLike {
    return (
        value !== null &&
        typeof value === "object" &&
        typeof (value as Record<string, unknown>).getDescription === "function"
    );
}

/**
 * Converts a Schema's description type to a Glue type string.
 */
function schemaDescriptionToGlueType(description: {type: string}): string {
    switch (description.type) {
        case "Integer":
            return "int";
        case "Float":
            return "double";
        case "Boolean":
            return "boolean";
        case "Date":
            return "timestamp";
        case "String":
        case "Id":
        case "Enum":
        default:
            return "string";
    }
}

/**
 * Recursively builds a Glue struct type string from a nested schema object.
 */
function buildGlueStructType(schemaObj: Record<string, unknown>): string {
    const fields: Array<string> = [];

    for (const [key, value] of Object.entries(schemaObj)) {
        if (value === undefined || value === null) continue;

        const snakeKey = convertCamelCaseToSnakeCase(key);
        const glueType = valueToGlueType(value);
        fields.push(`${snakeKey}:${glueType}`);
    }

    return `struct<${fields.join(",")}>`;
}

/**
 * Converts a value (either a Schema or nested object) to a Glue type string.
 */
function valueToGlueType(value: unknown): string {
    if (isSchema(value)) {
        const description = value.getDescription();
        return schemaDescriptionToGlueType(description);
    }

    if (isPlainObject(value)) {
        return buildGlueStructType(value as Record<string, unknown>);
    }

    // Fallback to string
    return "string";
}

type GlueColumn = {
    readonly name: string;
    readonly type: string;
};

/**
 * Converts the TracerEventDataSchemaForGlue object to an array of Glue column definitions.
 */
export function generateTracerEventGlueSchema(): Array<GlueColumn> {
    const columns: Array<GlueColumn> = [];

    for (const [key, value] of TracerEventFlatDataSchema) {
        if (value === undefined || value === null) continue;

        const snakeKey = convertCamelCaseToSnakeCase(key);
        const glueType = valueToGlueType(value);

        columns.push({name: snakeKey, type: glueType});
    }

    return columns;
}
