import {reactionIconSvgDataUrls} from "~/client/reactions/icons/reaction_icon_svg_data_urls.js";
import {sprinkles} from "~/client/styles/styles.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {getReactionAltText} from "~/shared/reactions/get_reaction_alt_text.js";
import {Reaction, getReactionInMap} from "~/shared/reactions/reaction.js";

export function ReactionIcon({reaction, size}: {reaction: Reaction; size: Spacing | "full"}) {
    return (
        <img
            className={sprinkles({width: size, height: size})}
            draggable={false}
            alt={getReactionAltText(reaction)}
            src={getReactionInMap(reactionIconSvgDataUrls, reaction).get()}
        />
    );
}
