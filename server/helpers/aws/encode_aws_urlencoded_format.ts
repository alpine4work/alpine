import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {
    JsonStringifiableUint8Array,
    SchemaSerializedArrayValue,
    SchemaSerializedObjectValue,
    SchemaSerializedValue,
} from "~/shared/schema/schema";

/**
 * Encodes an object into the `application/x-www-form-urlencoded` format used
 * by AWS for some services.
 *
 * For instance, we've discovered that SES does not accept JSON, only the
 * `application/x-www-form-urlencoded` format.
 *
 * Most notably this format uses `.` syntax for nested objects and
 * `.member.{index + 1}.` for nested arrays.
 */
export function encodeAwsUrlencodedFormat(rootValue: SchemaSerializedObjectValue): string {
    const params: Array<[string, string]> = [];

    function encode(keyPath: string, value: SchemaSerializedValue) {
        switch (typeof value) {
            case "string":
                params.push([keyPath, value]);
                break;
            case "boolean":
            case "number":
                params.push([keyPath, String(value)]);
                break;
            case "object":
                if (value === null) {
                    params.push([keyPath, "null"]);
                } else if (isReadonlyArray(value)) {
                    encodeArray(keyPath, value);
                } else if (value instanceof JsonStringifiableUint8Array) {
                    params.push([keyPath, value.toJSON()]);
                } else {
                    encodeObject(keyPath, value);
                }
                break;
            default:
                throw exhaustive(value);
        }
    }

    function encodeObject(parentKeyPath: string | null, value: SchemaSerializedObjectValue) {
        for (const [key, keyValue] of Object.entries(value)) {
            if (keyValue === undefined) continue;

            const keyPath = parentKeyPath
                ? `${parentKeyPath}.${encodeURIComponent(key)}`
                : encodeURIComponent(key);

            encode(keyPath, keyValue);
        }
    }

    function encodeArray(parentKeyPath: string, value: SchemaSerializedArrayValue) {
        value.forEach((itemValue, index) => {
            const keyPath = `${parentKeyPath}.member.${index + 1}`;
            encode(keyPath, itemValue);
        });
    }

    encodeObject(null, rootValue);

    return params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
}
