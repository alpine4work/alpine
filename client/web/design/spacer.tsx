import {sprinkles} from "~/client/web/styles/styles.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";

const spacerClassName = sprinkles({flexShrink: "0", display: "block"});

/**
 * A spacer component in the [style of Josh Comaeau][1].
 *
 * [1]: https://www.joshwcomeau.com/react/modern-spacer-gif/
 */
export function Spacer({
    space,
}: {
    space:
        | Spacing
        | `safe-area-inset-${"top" | "bottom" | "left" | "right"}`
        | {
              desktop: Spacing | `safe-area-inset-${"top" | "bottom" | "left" | "right"}`;
              mobile: Spacing | `safe-area-inset-${"top" | "bottom" | "left" | "right"}`;
          };
}) {
    return typeof space === "object" ? (
        <span className={`${spacerClassName} ${sprinkles({width: space, height: space})}`} />
    ) : (
        <span
            className={spacerClassName}
            style={{
                width: space[0] === "s" ? `var(${space}, 0px)` : spacing[space as Spacing],
                height: space[0] === "s" ? `var(${space}, 0px)` : spacing[space as Spacing],
            }}
        />
    );
}
