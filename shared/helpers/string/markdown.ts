import {assert} from "~/shared/helpers/control/assert.open_source.js";

/**
 * A string that if it's valid Markdown, will be formatted as Markdown by Prettier
 * in the source code file. Does not perform Prettier formatting at runtime! So if
 * Prettier is ignored in the source file the `markdown` template string tag was
 * used in then the Markdown will not be formatted.
 */
export type PrettyMarkdown = string & {readonly _PrettyMarkdown: never};

/**
 * Template string tag that tells Prettier to format the string as Markdown.
 * Variable substitutions break Prettier's formatting of the template string tag so
 * variable interpolation isn't allowed.
 */
export function markdown(template: TemplateStringsArray, ...substitutions: []): PrettyMarkdown {
    const string = template[0] ?? "";

    assert(substitutions.length === 0, "Substitutions break Prettier source code formatting");

    return string as PrettyMarkdown;
}
