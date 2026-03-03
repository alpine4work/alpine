import {Schema} from "~/shared/schema/schema.js";

export const minLabelString = String.fromCharCode(0);

/**
 * Label strings are short, single-line, strings that can be rendered in the UI
 * without truncation.
 *
 * Copied the max length of 50 from the [maximum Facebook name length][1].
 *
 * [1]:
 *     https://stackoverflow.com/questions/8078939/what-is-the-maximum-length-of-a-facebook-name
 */
export const maxLabelStringLength = 50;

export const LabelStringWithoutMaxLengthSchema = Schema.string.minLength(1).singleLine().trim();

/**
 * A label string is a short, non-empty, single-line string.
 *
 * It gets its name from the fact that it could be used as a label in a UI element.
 *
 * Rules:
 *
 * - Must be a single line
 * - Must not be empty
 * - Must not start or end with spaces
 * - Must not be unreasonably large (we limit to ~0.5kb)
 *
 * We picked a max length of 0.5kb because the [maximum DynamoDB partition key
 * length][1] is 2048 bytes (2kb) and we need extra bytes for encoding non-ASCII
 * characters in DynamoDB keys.
 *
 * [1]:
 *     https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ServiceQuotas.html
 */
export const LabelStringSchema = LabelStringWithoutMaxLengthSchema.maxLength(maxLabelStringLength);
