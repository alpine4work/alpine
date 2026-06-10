import {Box} from "~/client/web/design/box.js";
import {contentStyles} from "~/client/web/styles/styles.js";

export function NotionImportHelpSection() {
    return (
        <Box display="flex" flexDirection="column" gap={contentStyles.standaloneBlockMargin}>
            <Box
                userSelect="text"
                fontSize="100"
                color="grey-80"
                as="ol"
                display="flex"
                flexDirection="column"
                gap={contentStyles.paragraphMargin}
                paddingLeft="5"
                style={{
                    margin: 0,
                    listStyle: "decimal",
                }}
            >
                <li>Visit your Notion workspace and click your workspace name</li>
                <li>Click &#x201C;Settings&#x201D; and go to &#x201C;General&#x201D;</li>
                <li>Go to &#x201C;General&#x201D; and click the &#x201C;Export&#x201D; button</li>
                <li>Export with the default settings</li>
                <li>You will receive an email when your export is ready</li>
            </Box>
            <img alt="placeholder" src="/images/integrations/import/notion/notion_export.gif" />
        </Box>
    );
}
