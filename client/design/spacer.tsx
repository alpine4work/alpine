import {Spacing, spacing} from "~/shared/design/spacing.js";
import {sprinkles} from "~/shared/styles/styles.js";

const spacerClassName = sprinkles({flexShrink: "0", display: "block"});

/**
 * A spacer component in the [style of Josh Comaeau][1].
 *
 * [1]: https://www.joshwcomeau.com/react/modern-spacer-gif/
 */
export function Spacer({space}: {space: Spacing | {desktop: Spacing; mobile: Spacing}}) {
    return typeof space === "object" ? (
        <span className={`${spacerClassName} ${sprinkles({width: space, height: space})}`} />
    ) : (
        <span className={spacerClassName} style={{width: spacing[space], height: spacing[space]}} />
    );
}
