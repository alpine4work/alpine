import {Moon, Sun} from "phosphor-react";
import {IconButton} from "~/client/design/icon_button.js";
import {toggleColorScheme, useColorScheme} from "~/client/helpers/color_scheme.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    hiddenIfDarkColorSchemeClassName,
    hiddenIfLightColorSchemeClassName,
} from "~/shared/styles/styles.js";

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
