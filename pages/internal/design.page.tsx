import Head from "next/head";
import {Moon, Sun} from "phosphor-react";
import {Box} from "~/client/design/box";
import {toggleColorScheme, useColorScheme} from "~/client/design/color-scheme";
import {IconButton} from "~/client/design/icon-button";
import {DesignPlaygroundTooltipPage} from "~/client/design/playground/design-playground-tooltip-page";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {
    hiddenIfDarkColorSchemeClassName,
    hiddenIfLightColorSchemeClassName,
} from "~/shared/styles/styles";

export default function DesignPlayground() {
    return (
        <>
            <Head>
                <title>Cyberworlds Design Playground</title>
            </Head>
            <main>
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
            </main>
        </>
    );
}

function ColorSchemeToggleButton() {
    const colorScheme = useColorScheme();

    let description: string;
    switch (colorScheme) {
        case "dark":
            description = "Switch to light mode";
            break;
        case "light":
            description = "Switch to dark mode";
            break;
        case null:
            description = "Toggle between light and dark mode";
            break;
        default:
            throw exhaustive(colorScheme);
    }

    return (
        <IconButton description={description} onPress={() => toggleColorScheme()}>
            <Sun className={hiddenIfDarkColorSchemeClassName} />
            <Moon className={hiddenIfLightColorSchemeClassName} />
        </IconButton>
    );
}
