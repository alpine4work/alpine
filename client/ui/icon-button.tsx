import {IconContext} from "phosphor-react";
import {ReactNode} from "react";
import {sprinkles} from "~/client/ui/sprinkles.css";
import {Tooltip} from "~/client/ui/tooltip";
import {spacing} from "~/shared/styles/spacing";

// TODO(calebmer): Mobile press state

/**
 * A button represented by a single icon.
 */
export function IconButton({
    description,
    onClick,
    children,
}: {
    /**
     * A description of what action the button will take. Typically a short
     * sentence without punctuation.
     */
    description: string;

    /**
     * Take the button action.
     */
    onClick: () => void;

    /**
     * The icon to render. It's recommended to use a `phosphor-react` component but
     * any icon that fills the space and inherits the text color will do.
     */
    children: ReactNode;
}) {
    return (
        <Tooltip placement="bottom-start" content={description}>
            <button
                className={sprinkles({
                    width: "7",
                    height: "7",
                    padding: "1",
                    backgroundColor: {hover: "grey-5"},
                    borderRadius: "full",
                    color: "grey-70",
                })}
                onClick={onClick}
                aria-label={description}
            >
                <IconContext.Provider
                    value={{
                        color: "currentColor",
                        size: spacing["5"],
                    }}
                >
                    {children}
                </IconContext.Provider>
            </button>
        </Tooltip>
    );
}
