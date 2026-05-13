/**
 * A string that if it's valid HTML, will be formatted as HTML by Prettier in the
 * source code file. Does not perform Prettier formatting at runtime! So if
 * Prettier is ignored in the source file the `html` template string tag was used
 * in then the HTML will not be formatted.
 */
export type PrettyHtml = string & {readonly _PrettyHtml: never};

/**
 * Template string tag that tells Prettier to format the string as HTML.
 */
export function html(
    template: TemplateStringsArray,
    ...substitutions: ReadonlyArray<string>
): PrettyHtml {
    let string = template[0] ?? "";

    for (let i = 1; i < template.length; i++) {
        string += (substitutions[i - 1] ?? "") + template[i]!;
    }

    return string as PrettyHtml;
}
