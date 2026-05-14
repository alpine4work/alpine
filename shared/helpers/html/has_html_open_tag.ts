import {Tokenizer as HtmlTokenizer} from "htmlparser2";
import {noop} from "~/shared/helpers/control/noop.js";

/**
 * Does the provided string contain an HTML open tag with the specified name? Runs
 * an HTML tokenizer instead of a regular expression to handle HTML syntax
 * correctly.
 *
 * `tagName` is lower cased before being passed to `predicate`.
 */
// NOCOMMIT: Use this for `<video>`/`<audio>`/`<object>` tag parsing from Josh's PR
export function hasHtmlOpenTag(string: string, predicate: (tagName: string) => boolean): boolean {
    let hasOpenTag = false;

    const tokenizer = new HtmlTokenizer(
        {},
        {
            onopentagname: (start, end) => {
                const tagName = string.slice(start, end).toLowerCase();
                if (predicate(tagName)) hasOpenTag = true;
            },

            ontext: noop,
            ontextentity: noop,
            onopentagend: noop,
            onclosetag: noop,
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

    return hasOpenTag;
}
