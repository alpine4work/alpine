import classNames from "classnames";
import {
    avatarDefaultCatInnerClassName,
    avatarDefaultClassName,
    avatarDefaultIconSize,
    avatarDefaultInnerClassName,
    avatarDefaultSize,
    avatarDefaultTreeInnerClassName,
    avatarDefaultYetiInnerClassName,
} from "~/client/avatar/avatar_default_html.js";
import {ReactionIcon} from "~/client/reactions/icons/reaction_icon.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {Reaction} from "~/shared/reactions/reaction.js";

export function AvatarDefault({size, reaction}: {size: Spacing; reaction: Reaction}) {
    return (
        <span
            className={avatarDefaultClassName}
            style={{
                // Use translate for optical centering.
                transform: `scale(${parseInt(size, 10) / parseInt(avatarDefaultSize, 10)})`,
            }}
            aria-hidden="true"
        >
            <span
                className={classNames(
                    avatarDefaultInnerClassName,
                    {
                        Cat: avatarDefaultCatInnerClassName,
                        Tree: avatarDefaultTreeInnerClassName,
                        Yeti: avatarDefaultYetiInnerClassName,
                    }[reaction.character.type],
                )}
            >
                <ReactionIcon reaction={reaction} size={avatarDefaultIconSize} />
            </span>
        </span>
    );
}
