import {PhrasingContent} from "mdast";
import {InternalError} from "~/shared/error/error.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

export function printMarkdownPhrasingContentText(contents: ReadonlyArray<PhrasingContent>): string {
    let text = "";

    const print = (
        contents: ReadonlyArray<
            | PhrasingContent
            // Make TypeScript happy. `inlineMath` is valid `PhrasingContent` when we run
            // TypeScript on the entire codebase since it's used in
            // `parseApiContentFromMarkdown()` but it's not available when we run TypeScript
            // just on this Bazel package. Make the two environments consistent by adding a
            // stub type here.
            | {type: "inlineMath"; value: string}
            | {type: "mdxTextExpression"}
            | {type: "mdxJsxTextElement"}
        >,
    ) => {
        for (const content of contents) {
            switch (content.type) {
                case "text":
                case "inlineCode":
                case "inlineMath": {
                    text += content.value;
                    break;
                }
                case "link":
                case "delete":
                case "emphasis":
                case "linkReference":
                case "strong": {
                    print(content.children);
                    break;
                }
                case "break":
                case "footnoteReference":
                case "html":
                case "image":
                case "imageReference": {
                    break;
                }
                case "mdxTextExpression":
                case "mdxJsxTextElement": {
                    throw new InternalError(
                        "Unreachable, Markdown parser doesn\u2019t use MDX plugin",
                    );
                }
                default:
                    throw exhaustive(content);
            }
        }
    };

    print(contents);

    return text;
}
