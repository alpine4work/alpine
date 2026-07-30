import {ImgHTMLAttributes} from "react";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {documentationMarkdownStringProp} from "~/client/web/docs/internal/markdown/documentation_markdown_string_prop.js";

/** An image (`![alt](src)`). */
export const DocumentationImage = documentationComponent({
    react: ({alt = "", ...props}: ImgHTMLAttributes<HTMLImageElement>) => (
        <img {...props} alt={alt} />
    ),
    markdown: props =>
        `![${documentationMarkdownStringProp(props, "alt")}](${documentationMarkdownStringProp(
            props,
            "src",
        )})`,
});
