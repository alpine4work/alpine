/**
 * Generate a copy title suffix for duplicated documents. "Title" -> "Title (copy)"
 * "Title (copy)" -> "Title (copy 2)" "Title (copy 2)" -> "Title (copy 3)"
 */
export function generateDuplicateContentTitle(currentTitle: string): string {
    const copyNumberMatch = currentTitle.match(/ \(copy (\d+)\)$/);
    const copyMatch = currentTitle.match(/ \(copy\)$/);

    if (copyNumberMatch) {
        const copyNumber = parseInt(copyNumberMatch[1]!, 10) + 1;
        return currentTitle.replace(/ \(copy \d+\)$/, ` (copy ${copyNumber})`);
    } else if (copyMatch) {
        return currentTitle.replace(/ \(copy\)$/, " (copy 2)");
    } else {
        return `${currentTitle} (copy)`;
    }
}
