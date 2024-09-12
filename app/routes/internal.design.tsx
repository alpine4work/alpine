import {Box} from "~/client/design/box.js";
import {ColorSchemeToggleButton} from "~/client/design/playground/color_scheme_toggle_button.js";
import {DesignPlaygroundTooltipPage} from "~/client/design/playground/design_playground_tooltip_page.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {sprinkles} from "~/client/styles/styles.js";

export function meta() {
    return [{title: `Design Playground${metaTitlePostfix}`}];
}

export default function DesignPlaygroundRoute() {
    return (
        <main className={sprinkles({backgroundColor: "grey-0"})}>
            <Box padding="4">
                <ColorSchemeToggleButton />
                <h1>Design Playground</h1>
                <Box width="12" height="12" backgroundColor={{dark: "grey-20"}} />
                <Box width="12" height="12" backgroundColor="grey-10" />
                <DesignPlaygroundTooltipPage />
                <Box
                    marginY="8"
                    padding="16"
                    display="flex"
                    justifyContent="center"
                    gap="12"
                    borderRadius="1"
                    backgroundColor="grey-5"
                >
                    <Box
                        backgroundColor="grey-0"
                        width="32"
                        height="32"
                        borderRadius="1"
                        boxShadow="elevation-5"
                    />
                    <Box
                        backgroundColor="grey-0"
                        width="32"
                        height="32"
                        borderRadius="1"
                        boxShadow="elevation-10"
                    />
                    <Box
                        backgroundColor="grey-0"
                        width="32"
                        height="32"
                        borderRadius="1"
                        boxShadow="elevation-20"
                    />
                    <Box
                        backgroundColor="grey-0"
                        width="32"
                        height="32"
                        borderRadius="1"
                        boxShadow="elevation-30"
                    />
                    <Box
                        backgroundColor="grey-0"
                        width="32"
                        height="32"
                        borderRadius="1"
                        boxShadow="elevation-40"
                    />
                    <Box
                        backgroundColor="grey-0"
                        width="32"
                        height="32"
                        borderRadius="1"
                        boxShadow="elevation-50"
                    />
                    <Box
                        backgroundColor="grey-0"
                        width="32"
                        height="32"
                        borderRadius="1"
                        boxShadow="elevation-60"
                    />
                </Box>
            </Box>
        </main>
    );
}
