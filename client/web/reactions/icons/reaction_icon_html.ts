import {reactionIconSvgDataUrls} from "~/client/web/reactions/icons/reaction_icon_svg_data_urls.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {getReactionAltText} from "~/shared/reactions/get_reaction_alt_text.js";
import {Reaction, getValueByReaction} from "~/shared/reactions/reaction.js";

export function renderReactionIconHtml({
    reaction,
    size,
}: {
    reaction: Reaction;
    size: Spacing | "full";
}): HtmlElementGenerator {
    const html = new HtmlElementGenerator("img");
    html.setAttribute("draggable", "false");
    html.setAttribute("alt", getReactionAltText(reaction));
    html.setAttribute("src", getValueByReaction(reactionIconSvgDataUrls, reaction).get());
    html.setAttribute(
        "style",
        size === "full"
            ? "width: 100%; height: 100%"
            : `width: ${spacing[size]}; height: ${spacing[size]}`,
    );
    return html;
}
