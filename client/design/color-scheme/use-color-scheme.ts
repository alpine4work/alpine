import {useEffect, useState} from "react";
import {
    ColorScheme,
    getColorSchemeWithoutListening,
    listenToColorSchemeChanges,
} from "~/client/design/color-scheme/color-scheme";

/**
 * Get the color scheme and re-render the component when the color
 * scheme changes.
 */
export function useColorScheme(): ColorScheme | null {
    const [colorScheme, setColorScheme] = useState<ColorScheme | null>(null);

    useEffect(() => {
        setColorScheme(getColorSchemeWithoutListening());
        return listenToColorSchemeChanges(setColorScheme);
    }, []);

    return colorScheme;
}
