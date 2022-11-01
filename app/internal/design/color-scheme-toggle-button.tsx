"use client";

import {Moon, Sun} from "phosphor-react";
import {toggleColorScheme} from "~/client/design/color-scheme/color-scheme";
import {useColorScheme} from "~/client/design/color-scheme/use-color-scheme";
import {IconButton} from "~/client/design/icon-button";
import {
    hiddenIfDarkColorSchemeClassName,
    hiddenIfLightColorSchemeClassName,
} from "~/shared/design/color-scheme.css";
import {exhaustive} from "~/shared/helpers/control/exhaustive";

export function ColorSchemeToggleButton() {
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
