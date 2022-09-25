import {InternalError} from "~/shared/error/error";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {SchemaDescription} from "~/shared/schema/types/schema-description-types";

/**
 * Takes two `SchemaDescription`s and verifies that the second `SchemaDescription`
 * is backwards compatible with the first `SchemaDescription`. If the second is not
 * backwards compatible then we will throw an error.
 *
 * The second schema is considered "backwards compatible" with the first if every
 * value that is accepted by the first schema can also be accepted by the second
 * schema.
 */
export function checkSchemaDescriptionBackwardsCompatibility(
    lastSchema: SchemaDescription,
    nextSchema: SchemaDescription,
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
                throw new SchemaDescriptionBackwardsIncompatibleError(
                    `\`${lastSchema.type}\` type is incompatible with \`${nextSchema.type}\` type`,
                );
            }
            return;
        }
        case "Float": {
            // It is safe for an integer to become a float.
            if (lastSchema.type !== "Float" && lastSchema.type !== "Integer") {
                throw new SchemaDescriptionBackwardsIncompatibleError(
                    `\`${lastSchema.type}\` type is incompatible with \`${nextSchema.type}\` type`,
                );
            }
            return;
        }
        case "String": {
            // It is safe for an id to become a string.
            if (lastSchema.type !== "String" && lastSchema.type !== "Id") {
                throw new SchemaDescriptionBackwardsIncompatibleError(
                    `\`${lastSchema.type}\` type is incompatible with \`${nextSchema.type}\` type`,
                );
            }
            return;
        }
        case "Value": {
            if (lastSchema.type !== "Value") {
                throw new SchemaDescriptionBackwardsIncompatibleError(
                    `\`${lastSchema.type}\` type is incompatible with \`${nextSchema.type}\` type`,
                );
            }
            if (!Object.is(lastSchema.value, nextSchema.value)) {
                throw new SchemaDescriptionBackwardsIncompatibleError(
                    `\`${JSON.stringify(
                        lastSchema.value,
                    )}\` value is incompatible with \`${JSON.stringify(nextSchema.value)}\` value`,
                );
            }
            return;
        }
        case "Nullable": {
            if (lastSchema.type === "Nullable") {
                checkSchemaDescriptionBackwardsCompatibility(lastSchema.schema, nextSchema.schema);
                return;
            }

            // If our schema is nullable but the old schema is non-null, that's backwards
            // compatible safe since the new schema is adding a new potential value.
            checkSchemaDescriptionBackwardsCompatibility(lastSchema, nextSchema.schema);
            return;
        }
        case "Array": {
            if (lastSchema.type !== "Array") {
                throw new SchemaDescriptionBackwardsIncompatibleError(
                    `\`${lastSchema.type}\` type is incompatible with \`${nextSchema.type}\` type`,
                );
            }

            withSchemaDescriptionStackFrame({type: "ArrayIndex"}, () => {
                checkSchemaDescriptionBackwardsCompatibility(
                    lastSchema.itemSchema,
                    nextSchema.itemSchema,
                );
            });
            return;
        }
        case "Object": {
            if (lastSchema.type !== "Object") {
                throw new SchemaDescriptionBackwardsIncompatibleError(
                    `\`${lastSchema.type}\` type is incompatible with \`${nextSchema.type}\` type`,
                );
            }

            for (const [key, nextPropertySchema] of Object.entries(
                nextSchema.propertySchemaByKey,
            )) {
                const lastPropertySchema = lastSchema.propertySchemaByKey[key];

                if (!lastPropertySchema) {
                    if (!nextPropertySchema.optional)
                        throw new SchemaDescriptionBackwardsIncompatibleError(
                            `Required \`${key}\` property not found`,
                        );
                } else {
                    if (lastPropertySchema.optional && !nextPropertySchema.optional)
                        throw new SchemaDescriptionBackwardsIncompatibleError(
                            `Optional \`${key}\` property can not be made required`,
                        );

                    withSchemaDescriptionStackFrame({type: "ObjectProperty", key}, () => {
                        checkSchemaDescriptionBackwardsCompatibility(
                            lastPropertySchema.valueSchema,
                            nextPropertySchema.valueSchema,
                        );
                    });
                }
            }
            return;
        }
        case "Union": {
            if (lastSchema.type !== "Union") {
                throw new SchemaDescriptionBackwardsIncompatibleError(
                    `\`${lastSchema.type}\` type is incompatible with \`${nextSchema.type}\` type`,
                );
            }

            for (const [type, lastVariantSchema] of Object.entries(
                lastSchema.variantSchemaByType,
            )) {
                const nextVariantSchema = nextSchema.variantSchemaByType[type];

                if (!nextVariantSchema) {
                    throw new SchemaDescriptionBackwardsIncompatibleError(
                        `Union variant \`${type}\` not found`,
                    );
                } else {
                    withSchemaDescriptionStackFrame(
                        {type: "UnionVariant", typeKey: "type", typeValue: type},
                        () => {
                            checkSchemaDescriptionBackwardsCompatibility(
                                lastVariantSchema,
                                nextVariantSchema,
                            );
                        },
                    );
                }
            }
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
export class SchemaDescriptionBackwardsIncompatibleError extends InternalError {
    constructor(message: string) {
        const stackString = getSchemaDescriptionStackString();

        super(message);
        this.name = "SchemaDescriptionBackwardsIncompatibleError";
        this.message = stackString ? `${message} in \`${stackString}\`` : message;
    }
}

type SchemaDescriptionStackFrame =
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
          readonly typeValue: string;
      };

const schemaDescriptionStack: Array<SchemaDescriptionStackFrame> = [];

function withSchemaDescriptionStackFrame<Value>(
    frame: SchemaDescriptionStackFrame,
    action: () => Value,
): Value {
    try {
        schemaDescriptionStack.push(frame);
        const value = action();
        return value;
    } finally {
        schemaDescriptionStack.pop();
    }
}

function getSchemaDescriptionStackString(): string | null {
    if (!schemaDescriptionStack.length) return null;

    let string = "";

    for (const frame of schemaDescriptionStack) {
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
