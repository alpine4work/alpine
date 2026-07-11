import {ReactNode, isValidElement} from "react";
import {Box} from "~/client/web/design/box.js";
import {DocumentationCodeBlock} from "~/client/web/docs/internal/documentation_code_block.js";
import {DocumentationCodeLanguage} from "~/client/web/docs/internal/documentation_syntax_highlight.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {flattenDocumentationMarkdownChildren} from "~/client/web/docs/internal/markdown/documentation_markdown_component.js";
import {getDocumentationNodeText} from "~/client/web/docs/internal/markdown/get_documentation_node_text.js";

/**
 * A fenced code block. MDX renders it as `<pre><code className="language-x">…`, so
 * this unwraps the nested `code` into our syntax-highlighted block, using the
 * language as the header label. The markdown variant passes through the fenced
 * block already produced by the nested `code`.
 */
export const DocumentationCodeFence = documentationComponent({
    react: ({children}: {children?: ReactNode}) => {
        let language = "";
        let code = "";
        if (isValidElement(children)) {
            const elementProps: unknown = children.props;
            if (typeof elementProps === "object" && elementProps !== null) {
                if ("className" in elementProps && typeof elementProps.className === "string") {
                    language = elementProps.className.replace("language-", "");
                }
                if ("children" in elementProps) {
                    code = getDocumentationNodeText(elementProps.children).replace(/\n$/, "");
                }
            }
        }
        const codeLanguage: DocumentationCodeLanguage =
            language === "json" || language === "bash" || language === "js" ? language : "text";
        return (
            <Box marginY="4">
                <DocumentationCodeBlock
                    code={code}
                    language={codeLanguage}
                    label={language.length > 0 ? language : undefined}
                />
            </Box>
        );
    },
    markdown: props => flattenDocumentationMarkdownChildren(props.children),
});
