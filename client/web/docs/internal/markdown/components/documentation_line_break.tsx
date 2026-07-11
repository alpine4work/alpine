import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";

/** A hard line break (`  \n`). */
export const DocumentationLineBreak = documentationComponent({
    react: () => <br />,
    markdown: () => "  \n",
});
