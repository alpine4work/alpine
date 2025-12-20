import classNames from "classnames";
import {renderReactionIconHtml} from "~/client/web/reactions/icons/reaction_icon_html.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {Reaction, ReactionCharacterType} from "~/shared/reactions/reaction.js";

export const avatarDefaultSize: Spacing = "24";
export const avatarDefaultIconSize: Spacing = "20";

export const avatarDefaultClassName = sprinkles({
    position: "absolute",
    left: "0",
    top: "0",
    display: "block",
    width: avatarDefaultSize,
    height: avatarDefaultSize,
});

export const avatarDefaultInnerClassName = sprinkles({
    display: "block",
    width: avatarDefaultSize,
    height: avatarDefaultSize,
    padding: "2",
});

export const avatarDefaultInnerClassNameByCharacterType: Record<ReactionCharacterType, string> = {
    Tree: sprinkles({
        position: "relative",
        // Optically center align icon
        top: "-0.5",
        left: "0",
    }),
    Yeti: sprinkles({
        position: "relative",
        // Optically center align icon
        top: "-1",
        left: "0.5",
    }),
    Cat: sprinkles({
        position: "relative",
        // Optically center align icon
        top: "-1.5",
        left: "0",
    }),
    Frog: sprinkles({
        position: "relative",
        // Optically center align icon
        top: "-2.5",
        left: "0",
    }),
    Pigeon: sprinkles({
        position: "relative",
        // Optically center align icon
        top: "-1.5",
        left: "0",
    }),
    Tulip: sprinkles({
        position: "relative",
        // Optically center align icon
        top: "-1.5",
        left: "0",
    }),
};

export function renderAvatarDefaultHtml({size, reaction}: {size: Spacing; reaction: Reaction}) {
    const avatarHtml = new HtmlElementGenerator("span");

    avatarHtml.setAttribute("class", avatarDefaultClassName);
    avatarHtml.setAttribute(
        "style",
        `transform: scale(${(parseInt(size, 10) / parseInt(avatarDefaultSize, 10)).toFixed(
            8,
        )}); transform-origin: top left`,
    );
    avatarHtml.setAttribute("aria-hidden", "true");

    const avatarInnerHtml = avatarHtml.appendChild(new HtmlElementGenerator("span"));
    avatarInnerHtml.setAttribute(
        "class",
        classNames(
            avatarDefaultInnerClassName,
            avatarDefaultInnerClassNameByCharacterType[reaction.character.type],
        ),
    );

    avatarInnerHtml.appendChild(
        renderReactionIconHtml({
            reaction,
            size: avatarDefaultIconSize,
        }),
    );

    return avatarHtml;
}
