import {SchemaSerializedValue} from "~/shared/schema/schema.js";

/**
 * Is the provided secret settings value considered empty? We let non-admins in a
 * space know if a secret is empty vs non-empty but we don't let non-admins see the
 * secret value. This function controls whether non-members see an empty secret
 * value or a filled secret value.
 */
export function isBotSpaceSettingsPropertyValueEmptySecret(
    value: SchemaSerializedValue | undefined,
): boolean {
    return value === undefined || (typeof value === "string" && value.length === 0);
}
