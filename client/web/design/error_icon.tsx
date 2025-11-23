import {Triangle, Warning} from "phosphor-react";
import {colorSchemeVars, sprinkles} from "~/client/web/styles/styles.js";

/**
 * The error icon is a red warning triangle. The warning triangle always has a
 * white exclamation mark in dark mode.
 *
 * This is a thin wrapper around the `phosphor-react` `<Warning>` icon
 * that is correctly colored.
 */
export function ErrorIcon({size}: {size?: string}) {
    return (
        <span
            className={sprinkles({position: "relative", zIndex: "0"})}
            role="img"
            aria-label="Error icon"
        >
            <Warning weight="fill" size={size} color={colorSchemeVars["red-50-const"]} />
            <Triangle
                weight="fill"
                size={size}
                color={colorSchemeVars["grey-0-const"]}
                className={sprinkles({position: "absolute", top: "0", zIndex: "-10"})}
                style={{transform: "scale(0.9)"}}
            />
        </span>
    );
}
