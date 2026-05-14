import {Tokenizer as HtmlTokenizer} from "htmlparser2";
import {noop} from "~/shared/helpers/control/noop.js";

/**
 * Does the provided string contain an HTML close tag with the specified name? Runs
 * an HTML tokenizer instead of a regular expression to handle HTML syntax
 * correctly.
 *
 * `tagName` is lower cased before being passed to `predicate`.
 */
export function hasHtmlCloseTag(string: string, predicate: (tagName: string) => boolean): boolean {
    let hasCloseTag = false;

    const tokenizer = new HtmlTokenizer(
        {},
        {
            onclosetag: (start, end) => {
                const tagName = string.slice(start, end).toLowerCase();
                if (predicate(tagName)) hasCloseTag = true;
            },

            ontext: noop,
            ontextentity: noop,
            onopentagname: noop,
            onopentagend: noop,
            onattribname: noop,
            onattribdata: noop,
            onattribentity: noop,
            onattribend: noop,
            oncdata: noop,
            oncomment: noop,
            ondeclaration: noop,
            onend: noop,
            onprocessinginstruction: noop,
            onselfclosingtag: noop,
        },
    );

    tokenizer.write(string);
    tokenizer.end();

    return hasCloseTag;
}
