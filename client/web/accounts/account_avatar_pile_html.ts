import {renderAccountAvatar} from "~/client/web/accounts/account_avatar_html.js";
import {
    AccountAvatarPileSize,
    accountAvatarPileSizes,
} from "~/client/web/accounts/account_avatar_pile_size.js";
import {backgroundColorVar, sprinkles} from "~/client/web/styles/styles.js";
import {addRemLengths, negateRemLength, spacing} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";
import {AccountModelData} from "~/shared/spaces/account_model.js";

/**
 * Renders an account avatar pile to an `HtmlElementGenerator` object.
 *
 * IMPORTANT: If you update this HTML, keep `<AccountAvatarPile>` in sync.
 */
export function renderAccountAvatarPile({
    spacingScale,
    size = "6",
    topPreviewAccount = "Last",
    previewAccounts,
    accountCount = previewAccounts.length,
}: {
    size?: AccountAvatarPileSize;
    topPreviewAccount?: "First" | "Last";
    previewAccounts: ReadonlyArray<AccountModelData | null>;
    accountCount?: number;
    spacingScale: SpacingScale;
}): HtmlElementGenerator {
    const {avatarOverlapWidth, borderWidth, overflowFontSize, overflowScale} =
        accountAvatarPileSizes[size];

    const hasLastAvatar = accountCount > previewAccounts.length;

    // NOTE(calebmer): We use `<span>`s for all our elements because when rendering
    // a pile in a `<p>` tag (for a chat room mention) HTML doesn't parse `<div>`s
    // inside of `<p>` tags correctly.
    const pileHtml = new HtmlElementGenerator("span");
    pileHtml.setAttribute(
        "class",
        sprinkles({
            display: "flex",
            flexShrink: "0",
            position: "relative",
            zIndex: "0",
        }),
    );
    pileHtml.setAttribute(
        "style",
        `padding-right: ${addRemLengths(size, negateRemLength(spacing[avatarOverlapWidth]))}`,
    );

    for (let index = 0; index < previewAccounts.length; index++) {
        const account = previewAccounts[index];

        const avatarContainerHtml = pileHtml.appendChild(new HtmlElementGenerator("span"));
        avatarContainerHtml.setAttribute(
            "class",
            sprinkles({
                display: "block",
                height: size,
                width: avatarOverlapWidth,
                position: "relative",
            }),
        );
        avatarContainerHtml.setAttribute(
            "style",
            `z-index: ${
                topPreviewAccount === "First" && !hasLastAvatar
                    ? previewAccounts.length - index
                    : 1 + index
            }`,
        );

        if (account) {
            avatarContainerHtml.appendChild(
                renderAccountAvatar({
                    accountData: account,
                    size,
                    spacingScale,
                    backgroundBorderWidth:
                        previewAccounts.length > 1 || hasLastAvatar ? borderWidth : undefined,
                }),
            );
        } else {
            const nullAvatarOuterHtml = avatarContainerHtml.appendChild(
                new HtmlElementGenerator("span"),
            );
            nullAvatarOuterHtml.setAttribute(
                "class",
                sprinkles({
                    display: "block",
                    height: size,
                    width: size,
                    borderRadius: "full",
                }),
            );
            nullAvatarOuterHtml.setAttribute(
                "style",
                `box-shadow: 0px 0px 0px ${borderWidth}px ${backgroundColorVar}`,
            );

            const nullAvatarInnerHtml = nullAvatarOuterHtml.appendChild(
                new HtmlElementGenerator("span"),
            );
            nullAvatarInnerHtml.setAttribute(
                "class",
                sprinkles({
                    display: "block",
                    height: size,
                    width: size,
                    borderRadius: "full",
                    backgroundColor: "grey-10",
                }),
            );
        }
    }

    if (accountCount > previewAccounts.length) {
        const countHtml = new HtmlElementGenerator("span");
        if (overflowScale !== undefined) {
            countHtml.setAttribute("style", `transform: scale(${overflowScale})`);
        }
        countHtml.appendChild(new HtmlTextGenerator(`+${accountCount - previewAccounts.length}`));

        pileHtml.appendChild(
            renderAccountAvatarPileLastAvatar({
                size,
                avatarOverlapWidth,
                borderWidth,
                zIndex: 1 + previewAccounts.length,
                fontSize: overflowFontSize,
                childHtml: countHtml,
            }),
        );
    }

    return pileHtml;
}

function renderAccountAvatarPileLastAvatar({
    size,
    avatarOverlapWidth,
    borderWidth,
    zIndex,
    fontSize,
    childHtml,
}: {
    size: AccountAvatarPileSize;
    avatarOverlapWidth: (typeof accountAvatarPileSizes)[AccountAvatarPileSize]["avatarOverlapWidth"];
    borderWidth: (typeof accountAvatarPileSizes)[AccountAvatarPileSize]["borderWidth"];
    zIndex: number;
    fontSize: (typeof accountAvatarPileSizes)[AccountAvatarPileSize]["overflowFontSize"];
    childHtml: HtmlElementGenerator;
}): HtmlElementGenerator {
    const lastAvatarContainerHtml = new HtmlElementGenerator("span");
    lastAvatarContainerHtml.setAttribute(
        "class",
        sprinkles({
            display: "block",
            height: size,
            width: avatarOverlapWidth,
            position: "relative",
        }),
    );
    lastAvatarContainerHtml.setAttribute("style", `z-index: ${zIndex}`);

    const lastAvatarOuterHtml = lastAvatarContainerHtml.appendChild(
        new HtmlElementGenerator("span"),
    );
    lastAvatarOuterHtml.setAttribute(
        "class",
        sprinkles({
            display: "block",
            height: size,
            width: size,
            borderRadius: "full",
        }),
    );
    lastAvatarOuterHtml.setAttribute(
        "style",
        `box-shadow: 0px 0px 0px ${borderWidth}px ${backgroundColorVar}`,
    );

    const lastAvatarInnerHtml = lastAvatarOuterHtml.appendChild(new HtmlElementGenerator("span"));
    lastAvatarInnerHtml.setAttribute(
        "class",
        sprinkles({
            display: "flex",
            height: size,
            width: size,
            borderRadius: "full",
            backgroundColor: "grey-10",
            color: "grey-70",
            justifyContent: "center",
            alignItems: "center",
            overflow: "hidden",
            fontSize,
        }),
    );

    lastAvatarInnerHtml.appendChild(childHtml);

    return lastAvatarContainerHtml;
}
