import {ColorSchemeToggleButton} from "~/app/internal/design/color-scheme-toggle-button";
import {Box} from "~/client/design/box";
import {DesignPlaygroundTooltipPage} from "~/client/design/playground/design-playground-tooltip-page";

export default function DesignPlayground() {
    return (
        <>
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
                    borderRadius="base"
                    backgroundColor={{dark: "grey-5"}}
                >
                    <Box
                        backgroundColor={{light: "grey-0", dark: "grey-10"}}
                        width="32"
                        height="32"
                        borderRadius="base"
                        boxShadow="elevation-5"
                    />
                    <Box
                        backgroundColor={{light: "grey-0", dark: "grey-10"}}
                        width="32"
                        height="32"
                        borderRadius="base"
                        boxShadow="elevation-10"
                    />
                    <Box
                        backgroundColor={{light: "grey-0", dark: "grey-10"}}
                        width="32"
                        height="32"
                        borderRadius="base"
                        boxShadow="elevation-20"
                    />
                    <Box
                        backgroundColor={{light: "grey-0", dark: "grey-10"}}
                        width="32"
                        height="32"
                        borderRadius="base"
                        boxShadow="elevation-30"
                    />
                    <Box
                        backgroundColor={{light: "grey-0", dark: "grey-10"}}
                        width="32"
                        height="32"
                        borderRadius="base"
                        boxShadow="elevation-40"
                    />
                    <Box
                        backgroundColor={{light: "grey-0", dark: "grey-10"}}
                        width="32"
                        height="32"
                        borderRadius="base"
                        boxShadow="elevation-50"
                    />
                </Box>
            </Box>
        </>
    );
}
