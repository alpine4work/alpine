import {reactionIconSvgDataUrls} from "~/client/reactions/icons/reaction_icon_svg_data_urls.js";
import {sprinkles} from "~/client/styles/styles.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {getReactionAltText} from "~/shared/reactions/get_reaction_alt_text.js";
import {Reaction, getValueByReaction} from "~/shared/reactions/reaction.js";

export function renderReactionIconHtml({
    reaction,
    size,
}: {
    reaction: Reaction;
    size: Spacing;
}): HtmlElementGenerator {
    const html = new HtmlElementGenerator("img");
    html.setAttribute("class", sprinkles({width: size, height: size}));
    html.setAttribute("draggable", "false");
    html.setAttribute("alt", getReactionAltText(reaction));
    html.setAttribute("src", getValueByReaction(reactionIconSvgDataUrls, reaction).get());
    return html;
}
