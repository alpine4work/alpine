import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {flattenDocumentationMarkdownChildren} from "~/shared/docs/documentation_markdown_component.js";

/**
 * One `<Step>`: a bolded title and its body. In markdown, the title then the body.
 */
export const DocumentationStep = documentationComponent({
    react: ({title, children}: {title: string; children?: ReactNode}) => (
        <Box display="flex" flexDirection="column" gap="1">
            <Box fontSize="100" fontStyle="semi-bold" color="grey-90">
                {title}
            </Box>
            {children !== undefined ? (
                <Box fontSize="100" color="grey-50" style={{lineHeight: 1.6}}>
                    {children}
                </Box>
            ) : null}
        </Box>
    ),
    markdown: props => {
        const title = typeof props.title === "string" ? props.title : "";
        const body = flattenDocumentationMarkdownChildren(props.children).trim();
        return [title.length > 0 ? `**${title}**` : "", body]
            .filter(part => part.length > 0)
            .join("\n\n");
    },
});
