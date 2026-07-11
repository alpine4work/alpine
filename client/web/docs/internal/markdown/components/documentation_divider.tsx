import {Box} from "~/client/web/design/box.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";

/** A thematic break (`---`). */
export const DocumentationDivider = documentationComponent({
    react: () => <Box height="border" backgroundColor="grey-5" marginY="8" border="none" />,
    markdown: () => "---\n\n",
});
