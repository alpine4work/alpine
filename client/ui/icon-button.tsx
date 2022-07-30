import {IconContext} from "phosphor-react";
import {ReactNode} from "react";
import {colorSchemeVars} from "~/client/ui/color-scheme.css";
import {sprinkles} from "~/client/ui/sprinkles.css";
import {spacing} from "~/shared/styles/spacing";

export function IconButton({onClick, children}: {onClick: () => void; children: ReactNode}) {
    return (
        <button
            className={sprinkles({
                width: "spacing-7",
                height: "spacing-7",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                backgroundColor: {hover: "grey-5"},
                borderRadius: "rounded-full",
            })}
            onClick={onClick}
        >
            <IconContext.Provider
                value={{
                    color: colorSchemeVars["grey-70"],
                    size: spacing["spacing-5"],
                }}
            >
                {children}
            </IconContext.Provider>
        </button>
    );
}
