import {InternalError} from "~/shared/error/error";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {SchemaSerializedValueDescription} from "~/shared/schema/types/schema_description_types";

/**
 * Takes two `SchemaSerializedValueDescription`s and verifies that the second
 * `SchemaSerializedValueDescription` is backwards compatible with the first
 * `SchemaSerializedValueDescription`. If the second is not backwards
 * compatible then we will throw an error.
 *
 * The second schema is considered "backwards compatible" with the first if every
 * value that is accepted by the first schema can also be accepted by the second
 * schema.
 */
export function checkSchemaBackwardsCompatibility(
    lastSchema: SchemaSerializedValueDescription,
    nextSchema: SchemaSerializedValueDescription,
): void {
    // Allow value schema to generalize into the full type.
    if (lastSchema.type === "Value") {
        if (
            (typeof lastSchema.value === "boolean" && nextSchema.type === "Boolean") ||
            (typeof lastSchema.value === "number" && nextSchema.type === "Float") ||
            (typeof lastSchema.value === "number" &&
                Number.isSafeInteger(lastSchema.value) &&
                nextSchema.type === "Integer") ||
            (typeof lastSchema.value === "string" && nextSchema.type === "String")
        ) {
            return;
        }
    }

    // You may always convert to unknown.
    if (nextSchema.type === "Unknown") return;

    switch (nextSchema.type) {
        case "Boolean":
        case "Integer":
        case "Id":
        case "Bytes": {
            if (lastSchema.type !== nextSchema.type) {
                throw new SchemaBackwardsIncompatibleError(
                    `\`${lastSchema.type}\` type is incompatible with \`${nextSchema.type}\` type`,
                );
            }
            return;
        }
        case "Float": {
            // It is safe for an integer to become a float.
            if (lastSchema.type !== "Float" && lastSchema.type !== "Integer") {
                throw new SchemaBackwardsIncompatibleError(
                    `\`${lastSchema.type}\` type is incompatible with \`${nextSchema.type}\` type`,
                );
            }
            return;
        }
        case "String": {
            // It is safe for an id to become a string.
            if (lastSchema.type !== "String" && lastSchema.type !== "Id") {
                throw new SchemaBackwardsIncompatibleError(
                    `\`${lastSchema.type}\` type is incompatible with \`${nextSchema.type}\` type`,
                );
            }
            return;
        }
        case "Value": {
            if (lastSchema.type !== "Value") {
                throw new SchemaBackwardsIncompatibleError(
                    `\`${lastSchema.type}\` type is incompatible with \`${nextSchema.type}\` type`,
                );
            }
            if (!Object.is(lastSchema.value, nextSchema.value)) {
                throw new SchemaBackwardsIncompatibleError(
                    `\`${JSON.stringify(
                        lastSchema.value,
                    )}\` value is incompatible with \`${JSON.stringify(nextSchema.value)}\` value`,
                );
            }
            return;
        }
        case "Nullable": {
            if (lastSchema.type === "Nullable") {
                checkSchemaBackwardsCompatibility(lastSchema.schema, nextSchema.schema);
                return;
            }

            // If our schema is nullable but the old schema is non-null, that's backwards
            // compatible safe since the new schema is adding a new potential value.
            checkSchemaBackwardsCompatibility(lastSchema, nextSchema.schema);
            return;
        }
        case "Array": {
            if (lastSchema.type !== "Array") {
                throw new SchemaBackwardsIncompatibleError(
                    `\`${lastSchema.type}\` type is incompatible with \`${nextSchema.type}\` type`,
                );
            }

            withSchemaSerializedValueDescriptionStackFrame({type: "ArrayIndex"}, () => {
                checkSchemaBackwardsCompatibility(lastSchema.itemSchema, nextSchema.itemSchema);
            });
            return;
        }
        case "Object": {
            if (lastSchema.type !== "Object") {
                throw new SchemaBackwardsIncompatibleError(
                    `\`${lastSchema.type}\` type is incompatible with \`${nextSchema.type}\` type`,
                );
            }

            for (const [key, nextPropertySchema] of Object.entries(
                nextSchema.propertySchemaByKey,
            )) {
                const lastPropertySchema = lastSchema.propertySchemaByKey[key];

                if (!lastPropertySchema) {
                    if (!nextPropertySchema.optional)
                        throw new SchemaBackwardsIncompatibleError(
                            `Required \`${key}\` property not found`,
                        );
                } else {
                    if (lastPropertySchema.optional && !nextPropertySchema.optional)
                        throw new SchemaBackwardsIncompatibleError(
                            `Optional \`${key}\` property can not be made required`,
                        );

                    withSchemaSerializedValueDescriptionStackFrame(
                        {type: "ObjectProperty", key},
                        () => {
                            checkSchemaBackwardsCompatibility(
                                lastPropertySchema.valueSchema,
                                nextPropertySchema.valueSchema,
                            );
                        },
                    );
                }
            }
            return;
        }
        case "Union": {
            if (lastSchema.type !== "Union") {
                throw new SchemaBackwardsIncompatibleError(
                    `\`${lastSchema.type}\` type is incompatible with \`${nextSchema.type}\` type`,
                );
            }

            for (const [type, lastVariantSchema] of Object.entries(
                lastSchema.variantSchemaByType,
            )) {
                const nextVariantSchema = nextSchema.variantSchemaByType[type];

                if (!nextVariantSchema) {
                    throw new SchemaBackwardsIncompatibleError(
                        `Union variant \`${type}\` not found`,
                    );
                } else {
                    withSchemaSerializedValueDescriptionStackFrame(
                        {type: "UnionVariant", typeKey: "type", typeValue: type},
                        () => {
                            checkSchemaBackwardsCompatibility(lastVariantSchema, nextVariantSchema);
                        },
                    );
                }
            }
            return;
        }
        case "Result": {
            if (lastSchema.type !== "Result") {
                throw new SchemaBackwardsIncompatibleError(
                    `\`${lastSchema.type}\` type is incompatible with \`${nextSchema.type}\` type`,
                );
            }

            withSchemaSerializedValueDescriptionStackFrame(
                {type: "UnionVariant", typeKey: "ok", typeValue: true},
                () => {
                    checkSchemaBackwardsCompatibility(lastSchema.okSchema, nextSchema.okSchema);
                },
            );

            withSchemaSerializedValueDescriptionStackFrame(
                {type: "UnionVariant", typeKey: "ok", typeValue: false},
                () => {
                    checkSchemaBackwardsCompatibility(
                        lastSchema.errorSchema,
                        nextSchema.errorSchema,
                    );
                },
            );

            return;
        }
        default:
            throw exhaustive(nextSchema);
    }
}

/**
 * An error thrown while checking whether a schema is backwards compatible
 * with another.
 */
export class SchemaBackwardsIncompatibleError extends InternalError {
    constructor(message: string) {
        const stackString = getSchemaSerializedValueDescriptionStackString();

        super(message);
        this.name = "SchemaBackwardsIncompatibleError";
        this.message = stackString ? `${message} in \`${stackString}\`` : message;
    }
}

type SchemaSerializedValueDescriptionStackFrame =
    | {
          readonly type: "ObjectProperty";
          readonly key: string;
      }
    | {
          readonly type: "ArrayIndex";
      }
    | {
          readonly type: "UnionVariant";
          readonly typeKey: string;
          readonly typeValue: string | boolean;
      };

const schemaSerializedValueDescriptionStack: Array<SchemaSerializedValueDescriptionStackFrame> = [];

function withSchemaSerializedValueDescriptionStackFrame<Value>(
    frame: SchemaSerializedValueDescriptionStackFrame,
    action: () => Value,
): Value {
    try {
        schemaSerializedValueDescriptionStack.push(frame);
        const value = action();
        return value;
    } finally {
        schemaSerializedValueDescriptionStack.pop();
    }
}

function getSchemaSerializedValueDescriptionStackString(): string | null {
    if (!schemaSerializedValueDescriptionStack.length) return null;

    let string = "";

    for (const frame of schemaSerializedValueDescriptionStack) {
        switch (frame.type) {
            case "ObjectProperty":
                string += `.${frame.key}`;
                break;
            case "ArrayIndex":
                string += `[index]`;
                break;
            case "UnionVariant":
                string += `(${frame.typeKey}=${frame.typeValue})`;
                break;
            default:
                throw exhaustive(frame);
        }
    }

    return string;
}
