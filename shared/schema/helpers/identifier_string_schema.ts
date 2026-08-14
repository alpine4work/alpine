import {identifierRegExp} from "~/shared/helpers/string/is_identifier.open_source.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Identifier string. Validates that the string is an identifier using the same
 * regular expression as `isIdentifier()`.
 */
export const IdentifierStringSchema = Schema.string.matches(identifierRegExp);
