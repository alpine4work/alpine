import {reactionIconSvgs} from "~/client/web/reactions/icons/reaction_icon_svgs.js";
import {Lazy} from "~/shared/helpers/control/lazy.open_source.js";
import {convertSvgToDataUrl} from "~/shared/helpers/html/convert_svg_to_data_url.js";
import {ReactionMap, mapReactionMap} from "~/shared/reactions/reaction.js";

/**
 * A map of reaction icons to a data URL you can use as an `<img>`'s `src`
 * attribute.
 */
export const reactionIconSvgDataUrls: ReactionMap<Lazy<string>> = mapReactionMap(
    reactionIconSvgs,
    svg => new Lazy(() => convertSvgToDataUrl(svg)),
);
