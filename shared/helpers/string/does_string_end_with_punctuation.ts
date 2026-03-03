/**
 * Test whether the string ends with punctuation for the purpose of knowing whether
 * it makes sense for us to add punctuation after this string. Understands patterns
 * like quotes outside of punctuation. For example `hello.` will return true and so
 * will `"hello."`.
 */
export function doesStringEndWithPunctuation(string: string): boolean {
    return /(?:\p{Sentence_Terminal}|\p{Terminal_Punctuation})\s*(?:\p{Pi}|\p{Pf}|["'])*\s*$/u.test(
        string,
    );
}
