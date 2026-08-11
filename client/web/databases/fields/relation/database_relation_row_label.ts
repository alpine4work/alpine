/**
 * The accessible label / typeahead text for a linked record, falling back to
 * "Untitled" when the record has no meaningful name (`null`, empty, or
 * whitespace-only).
 */
export function databaseRelationRowLabel(name: string | null): string {
    return name != null && name.trim() !== "" ? name : "Untitled";
}
