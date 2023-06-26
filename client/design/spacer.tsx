import {Spacing} from "~/shared/design/spacing.js";
import {sprinkles} from "~/shared/styles/styles.js";

/**
 * A spacer component in the [style of Josh Comaeau][1].
 *
 * [1]: https://www.joshwcomeau.com/react/modern-spacer-gif/
 */
export function Spacer({space}: {space: Spacing}) {
    return <span className={sprinkles({display: "block", width: space, height: space})} />;
}
