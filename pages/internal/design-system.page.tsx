import Head from "next/head";
import {Moon} from "phosphor-react";
import {Box} from "~/client/ui/box";
import {toggleColorScheme} from "~/client/ui/color-scheme";
import {
    hiddenIfDarkColorSchemeClassName,
    hiddenIfLightColorSchemeClassName,
} from "~/client/ui/color-scheme.css";
import {IconButton} from "~/client/ui/icon-button";

export default function DesignSystem() {
    return (
        <>
            <Head>
                <title>Cyberworlds Design System</title>
            </Head>
            <main>
                <IconButton onClick={() => toggleColorScheme()}>
                    <Moon className={hiddenIfDarkColorSchemeClassName} />
                    <Moon className={hiddenIfLightColorSchemeClassName} weight="fill" />
                </IconButton>
                <h1>Design System</h1>
                <Box width="spacing-12" height="spacing-12" backgroundColor={{dark: "grey-20"}} />
                <Box width="spacing-12" height="spacing-12" backgroundColor="grey-10" />
            </main>
        </>
    );
}
