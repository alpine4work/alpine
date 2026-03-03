import {Fragment, Mark, Node} from "prosemirror-model";
import {AccountModelWithoutSpaceData} from "~/shared/accounts/account_model_without_space.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {
    ContentInlineNodeTypeName,
    ContentMarkTypeName,
} from "~/shared/content/content_node_type_name.js";
import {
    RenderContentMentionToTextSearchEntity,
    renderContentMentionToText,
} from "~/shared/content/render_content_mention_to_text.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";

export function printSearchTextForInlineFragment(
    fragment: Fragment,
    options: {
        context: "heading" | "codeBlock" | null;
        getAccountIfExists: (accountId: AccountId) => AccountModelWithoutSpaceData | null;
        getSearchEntityIfExists: (
            entityId: SearchMentionEntityId,
        ) => RenderContentMentionToTextSearchEntity | null;
    },
): string {
    const content: Array<Node> = [];

    // Remove `link`, `comment`, and `highlight` marks and merge text nodes with the
    // same marks together.
    for (let node of fragment.content) {
        assert(node.isInline);

        if (options.context === "codeBlock" && node.marks.length > 0) {
            node = node.mark([]);
        } else if (
            node.marks.some(
                mark =>
                    printSearchEmbeddingTextForMarkByTypeName[
                        mark.type.name as ContentMarkTypeName
                    ] === null,
            )
        ) {
            node = node.mark(
                node.marks.filter(
                    mark =>
                        printSearchEmbeddingTextForMarkByTypeName[
                            mark.type.name as ContentMarkTypeName
                        ] !== null,
                ),
            );
        }

        const lastNode = content[content.length - 1];

        if (!node.isText || !lastNode?.isText || !lastNode.sameMarkup(node)) {
            content.push(node);
        } else {
            content[content.length - 1] = lastNode.type.schema.text(
                `${lastNode.text!}${node.text!}`,
                lastNode.marks,
            );
        }
    }

    const texts = content.map(node => printSearchTextForInlineNode(node, options));

    return texts.join("");
}

const printSearchEmbeddingTextForMarkByTypeName: {
    [Key in ContentMarkTypeName]: ((textContent: string, mark: Mark) => string) | null;
} = {
    italic: textContent => `*${textContent}*`,
    bold: textContent => `**${textContent}**`,
    code: textContent => `\`${textContent}\``,
    // Don't include URLs in search embedding text. We believe they'll confuse the
    // model as the text won't read naturally. (Should test this!)
    link: null,
    strike: textContent => `~~${textContent}~~`,
    comment: null,
    highlight: null,
};

/**
 * Print a node in the inline ProseMirror group to text which we'll 1) index in an
 * OpenSearch text field for keyword search, 2) embed with an LLM model for
 * semantic search. Inline ProseMirror nodes are nodes allowed in a paragraph node
 * or other textblock nodes.
 *
 * Includes the `text` node. We'll also add marks for bold and italic to the text
 * in markdown formatting. From brief testing, LLMs seem to understand markdown
 * formatting emphasizes text. OpenSearch should discard the formatting during
 * analysis. A conversation with Cohere demonstrating LLM support (grounding is
 * turned off):
 *
 * > Caleb: _How is this text formatted?_
 * >
 * > Cohere: The text "_How is this text formatted?_" is presented with the
 * > asterisk symbol, which is a formatting technique to indicate emphasis or an
 * > italicized style.
 * >
 * > Caleb: \*How is this text formatted?\*
 * >
 * > Cohere: The text "\*How is this text formatted?\*\*" is presented with the
 * > asterisk symbol and the backslash symbol, which causes the asterisk to be
 * > displayed rather than interpreted as an emphasis marker. This is useful to
 * > demonstrate the functionality of formatting rather than the intent to
 * > emphasize.
 * >
 * > Caleb: ~~How is this text formatted?~~
 * >
 * > Cohere: The text "~~How is this text formatted?~~" is presented with the tilde
 * > symbols, which indicates the inclusion of strikethrough formatting. This
 * > signifies that the text itself should be crossed out or rendered in a
 * > strikethrough style.
 *
 * In the UI `*How is this text formatted?*` is displayed without asterisks and
 * with italics.
 */
export function printSearchTextForInlineNode(
    node: Node,
    options: {
        context: "heading" | "codeBlock" | null;
        getAccountIfExists: (accountId: AccountId) => AccountModelWithoutSpaceData | null;
        getSearchEntityIfExists: (
            entityId: SearchMentionEntityId,
        ) => RenderContentMentionToTextSearchEntity | null;
    },
): string {
    assert(node.isInline);
    const typeName = node.type.name as ContentInlineNodeTypeName;

    switch (typeName) {
        case "break": {
            // Hard breaks aren't supported in headings so directly add a `<br/>` element.
            if (options.context === "heading") {
                return "<br/>";
            } else {
                // A little funky, but CommonMark specifies a newline preceded by a backslash (`\`)
                // as a hard line break. https://spec.commonmark.org/0.30/#hard-line-breaks
                return "\\\n";
            }
        }
        case "mention": {
            const mention: ContentMention = node.attrs.mention;
            return renderContentMentionToText(mention, options);
        }
        case "text": {
            const codeMark = node.marks.find(mark => mark.type.name === "code");

            // Escape any Markdown characters in the text content so the LLM model doesn't get
            // it confused with our own markdown styling.
            let textContent =
                options.context === "codeBlock" || codeMark
                    ? escapeMarkdownInCode(node.textContent)
                    : escapeMarkdown(node.textContent);

            // The code mark must always be applied first. CommonMark specifies that asterisks
            // or other characters within code are treated as literal characters.
            if (codeMark) {
                const maxBacktickCount = reduceIterable(
                    textContent.matchAll(/`+/g),
                    (count, match) => Math.max(count, match[0].length),
                    0,
                );

                const delimeter = "`".repeat(maxBacktickCount + 1);

                const startingSpace =
                    textContent.startsWith("`") ||
                    (maxBacktickCount > 0 && textContent.startsWith(" "))
                        ? " "
                        : "";

                const endingSpace =
                    textContent.endsWith("`") || (maxBacktickCount > 0 && textContent.endsWith(" "))
                        ? " "
                        : "";

                textContent = `${delimeter}${startingSpace}${textContent}${endingSpace}${delimeter}`;
            }

            textContent = node.marks.reduceRight((textContent, mark) => {
                if (mark === codeMark) return textContent;

                const printSearchEmbeddingTextForMark =
                    printSearchEmbeddingTextForMarkByTypeName[
                        mark.type.name as ContentMarkTypeName
                    ];

                return printSearchEmbeddingTextForMark !== null
                    ? printSearchEmbeddingTextForMark(textContent, mark)
                    : textContent;
            }, textContent);

            return textContent;
        }
        default:
            throw exhaustive(typeName);
    }
}

const escapeMarkdownRegExp = new RegExp(
    [
        // Start of line block formatting. Quote blocks (`>`), list items (`+`, `-`), and
        // headers (`#`).
        /^\s*[>+\-#]/,
        // Start of line table formatting (`| - |`, `| :- |`).
        /^\s*\|\s*:?-/,
        // Start of line list formatting (`1.`). Uses a lookbehind so we escape the `.` not
        // the number.
        /(?<=^\s*\d+)\./,
        // Code (```), bold (`\*`), italics (`\_`), and strikethrough (`~`).
        /[\\`*_~]/,
        // Links (`[Alpine](https://alpine.inc)`)
        /]\(/,
        // HTML tags (`<em>`)
        /<[/!?a-zA-Z]/,
        // HTML entities (`&amp;`, `&#x0026;`)
        /&#?[a-zA-Z0-9]+;/,
    ]
        .map(regExp => regExp.source)
        .join("|"),
    "gm",
);

/**
 * Escape markdown characters in some text content. We don't want the model to
 * confuse our markdown formatting for manually typed characters.
 *
 * Given this is all going to an LLM model this escaping may not be necessary or
 * may even be harmful (since it confuses the model). We'll have to test.
 *
 * There is no universally accepted markdown standard. The characters we escape
 * come from [here][1]. The characters ">", "+", and "-" we only escape when
 * they're at the start of a line since they're common in mathematical expressions.
 *
 * We add some additional logic to prevent [indented code blocks][2] by escaping 4+
 * consecutive spaces which our ProseMirror schema constraints cannot handle,
 * particularly within blockquotes.
 *
 * [1]: https://www.markdownguide.org/basic-syntax/#escaping-characters
 * [2]: https://spec.commonmark.org/0.30/#example-252
 */
function escapeMarkdown(textContent: string): string {
    // First, handle regular markdown characters
    const result = textContent.replaceAll(escapeMarkdownRegExp, substring => {
        const match = substring.match(/^(\s*?)(\S.*)$/);
        assert(match);
        return `${match[1]!}\\${match[2]!}`;
    });

    // Handle 4+ spaces at line start to prevent CommonMark indented code blocks
    return result.replaceAll(
        /^( {4,})|^(\\[>+\-#]|\d+\\.|\\?[|]) ( {4,})/gm,
        (match, spaces, markdownChar, spacesAfterChar) => {
            if (spaces) {
                // 4+ spaces at line start
                return `&#x0020;${spaces.slice(1)}`;
            } else {
                // Markdown characters followed by 4+ spaces
                return `${markdownChar} &#x0020;${spacesAfterChar.slice(1)}`;
            }
        },
    );
}

/**
 * Escape markdown characters in code content.
 *
 * You can put any character in inline code and it'll render. With the exception of
 * the `<em>` tag which the OpenSearch highlighter inserts. We manually handle
 * `<em>` tag parsing in inline code in `parseSearchContent()`.
 */
function escapeMarkdownInCode(textContent: string): string {
    return textContent.replaceAll(/<\/?em\s*>/gm, substring => {
        const match = substring.match(/^(\s*?)(\S.*)$/);
        assert(match);
        return `${match[1]!}\\${match[2]!}`;
    });
}
