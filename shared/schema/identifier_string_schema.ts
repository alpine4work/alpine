import {identifierRegExp} from "~/shared/helpers/string/is_identifier";
import {Schema} from "~/shared/schema/schema";

/**
 * Identifier string. Validates that the string is an identifier using the same
 * regular expression as `isIdentifier()`.
 */
export const IdentifierStringSchema = Schema.string.matches(identifierRegExp);
