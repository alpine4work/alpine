/**
 * Apply English pluralization rules to a string based on a count. For example
 * passing in 1 and "book" will give you "1 book" but passing in 5 and "book"
 * will give you "5 books". You can customize the pluralized form of the string
 * with the third argument. By default we add an "s" and don't try any other
 * pluralization rules.
 */
export function pluralizeEnglish(
    count: number,
    string: string,
    pluralString: string = `${string}s`,
) {
    if (count === 1) {
        return `${count} ${string}`;
    } else {
        return `${count} ${pluralString}`;
    }
}
