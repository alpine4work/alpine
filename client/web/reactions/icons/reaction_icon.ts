import {createElement} from "react";
import {reactionIconSvgDataUrls} from "~/client/web/reactions/icons/reaction_icon_svg_data_urls.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {getReactionAltText} from "~/shared/reactions/get_reaction_alt_text.js";
import {Reaction, getValueByReaction} from "~/shared/reactions/reaction.js";

export function ReactionIcon({
    reaction,
    size,
    imgComponent = "img",
}: {
    reaction: Reaction;
    size: Spacing | "full" | number;
    imgComponent?: React.ComponentType<any> | string;
}) {
    return createElement(imgComponent, {
        draggable: false,
        alt: getReactionAltText(reaction),
        src: getValueByReaction(reactionIconSvgDataUrls, reaction).get(),
        style:
            typeof size === "number"
                ? {width: size, height: size}
                : size === "full"
                  ? {width: "100%", height: "100%"}
                  : {width: spacing[size], height: spacing[size]},
    });
}
