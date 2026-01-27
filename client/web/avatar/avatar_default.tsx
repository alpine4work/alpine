import classNames from "classnames";
import {
    avatarDefaultClassName,
    avatarDefaultIconSize,
    avatarDefaultInnerClassName,
    avatarDefaultInnerClassNameByCharacterType,
    avatarDefaultSize,
} from "~/client/web/avatar/avatar_default_html.js";
import {ReactionIcon} from "~/client/web/reactions/icons/reaction_icon.js";
import {ParsableRemLength, parseRemLength} from "~/shared/design/core/spacing.js";
import {Reaction} from "~/shared/reactions/reaction.js";

export function AvatarDefault({size, reaction}: {size: ParsableRemLength; reaction: Reaction}) {
    return (
        <span
            className={avatarDefaultClassName}
            style={{
                transform: `scale(${(
                    parseRemLength(size) / parseRemLength(avatarDefaultSize)
                ).toFixed(8)})`,
                transformOrigin: "top left",
            }}
            aria-hidden="true"
        >
            <span
                className={classNames(
                    avatarDefaultInnerClassName,
                    avatarDefaultInnerClassNameByCharacterType[reaction.character.type],
                )}
            >
                <ReactionIcon reaction={reaction} size={avatarDefaultIconSize} />
            </span>
        </span>
    );
}
