import Head from "next/head";
import {Moon, Sun} from "phosphor-react";
import {Box} from "~/client/ui/box";
import {toggleColorScheme, useColorScheme} from "~/client/ui/color-scheme";
import {
    hiddenIfDarkColorSchemeClassName,
    hiddenIfLightColorSchemeClassName,
} from "~/client/ui/color-scheme.css";
import {IconButton} from "~/client/ui/icon-button";
import {exhaustive} from "~/shared/helpers/control/exhaustive";

export default function DesignSystem() {
    return (
        <>
            <Head>
                <title>Cyberworlds Design System</title>
            </Head>
            <main>
                <Box padding="4">
                    <ColorSchemeToggleButton />
                    <h1>Design System</h1>
                    <Box width="12" height="12" backgroundColor={{dark: "grey-20"}} />
                    <Box width="12" height="12" backgroundColor="grey-10" />
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
