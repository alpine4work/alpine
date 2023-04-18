import {Schema} from "~/shared/schema/schema";

export const maxLabelStringLength = 512;

/**
 * A label string is a short, non-empty, single-line string.
 *
 * It gets its name from the fact that it could be used as a label in a
 * UI element.
 *
 * Rules:
 * - Must be a single line
 * - Must not be empty
 * - Must not start or end with spaces
 * - Must not be unreasonably large (we limit to ~0.5kb)
 *
 * We picked a max length of 0.5kb because the [maximum DynamoDB partition key
 * length][1] is 2048 bytes (2kb) and we need extra bytes for encoding
 * non-ASCII characters in DynamoDB keys.
 *
 * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ServiceQuotas.html
 */
export const LabelStringSchema = Schema.string
    .minLength(1)
    .maxLength(maxLabelStringLength)
    .singleLine()
    .trim();
