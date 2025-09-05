import classNames from "classnames";
import {renderAccountAvatar} from "~/client/accounts/account_avatar_html.js";
import {AccountRegistry} from "~/client/accounts/account_registry.js";
import {renderTaskDisplayStatusCircle} from "~/client/design/task_display_status_circle_html.js";
import {channelBrandIconSvg} from "~/client/icons/brand/channel_brand_icon_svg.js";
import {documentBrandIconSvg} from "~/client/icons/brand/document_brand_icon_svg.js";
import {postBrandIconSvg} from "~/client/icons/brand/post_brand_icon_svg.js";
import {taskBrandIconSvg} from "~/client/icons/brand/task_brand_icon_svg.js";
import {taskCollectionBrandIconSvg} from "~/client/icons/brand/task_collection_brand_icon_svg.js";
import {createSvgHtmlGenerator} from "~/client/icons/create_svg_html_generator.js";
import {lockIconSvg} from "~/client/icons/lock_icon_svg.js";
import {trashIconSvg} from "~/client/icons/trash_icon_svg.js";
import {getSearchDynamicEntityPath} from "~/client/search/core/get_search_entity_path.js";
import {SearchEntityRegistry} from "~/client/search/core/search_entity_registry.js";
import {getTaskCollectionColor} from "~/client/styles/get_task_collection_color.js";
import {contentStyles, sprinkles} from "~/client/styles/styles.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {missingAccountName} from "~/shared/accounts/missing_account_name.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {truncateContentMentionText} from "~/shared/content/render_content_mention_to_text.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {Spacing, addRemLengths} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    HtmlElementGenerator,
    HtmlGenerator,
    HtmlTextGenerator,
} from "~/shared/helpers/html/html_generator.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {getSearchEntityNoun} from "~/shared/search/get_search_entity_noun.js";
import {
    deletedSearchEntityTitle,
    missingSearchEntityTitle,
    privateSearchEntityTitle,
} from "~/shared/search/missing_and_private_search_entity_titles.js";
import {parseSearchMentionEntityId} from "~/shared/search/search_entity_id.js";
import {SearchEntityMediaModel} from "~/shared/search/search_entity_media_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";

export function renderContentMentionToHtml(
    get: <Value>(store: Store<Value>) => Value,
    {
        accountRegistry,
        searchEntityRegistry,
        spacingScale,
        routeLayout,
        spaceId,
        currentAccount,
        references,
        mention,
        isInert: isInertFromProps,
    }: {
        accountRegistry: AccountRegistry;
        searchEntityRegistry: SearchEntityRegistry;
        spacingScale: SpacingScale;
        routeLayout: RouteLayout;
        spaceId: SpaceId | null;
        currentAccount: AccountModel | null;
        references: ContentReferences;
        mention: ContentMention;
        isInert: boolean;
    },
): HtmlElementGenerator {
    const isCurrentAccountMention =
        mention.type === "Account" && currentAccount?.id === mention.accountId;

    const isInert = isInertFromProps || spaceId === null;

    const html = new HtmlElementGenerator("span");
    html.setAttribute(
        "class",
        classNames(
            contentStyles.mentionClassName,
            isCurrentAccountMention && contentStyles.currentAccountMentionClassName,
        ),
    );

    let href: string | null;
    let media: SearchEntityMediaModel | null;
    let text: string;

    switch (mention.type) {
        case "Account": {
            href = `/s/${spaceId}/chat/with/${mention.accountId}`;

            const account = references.accountById.get(mention.accountId);
            media = account ? {type: "Account", account} : null;

            if (!account) {
                text = missingAccountName;
            } else {
                const accountData = get(accountRegistry.getAccountStore(account));

                const accountName = mention.isShort
                    ? getAccountShortNameWithoutFullNameTooltip(accountData)
                    : accountData.name;

                // Replace spaces in the account name with no-break spaces. We want the entire
                // pill to stay together and not wrap when we reach the end of a line of text.
                //
                // It's especially important that we don't wrap if this is the current account.
                // Since our current account CSS doesn't support wrapped inline elements.
                //
                // https://graphemica.com/%C2%A0
                text = accountName.replace(/\s/g, "\u00A0");
            }
            break;
        }
        case "SearchEntity": {
            const entityIdObject = parseSearchMentionEntityId(mention.entityId);

            let entityIconWidth: "wide" | "normal";
            let entityIconSvg: (props: {size: Spacing | `${string}em`; color: string}) => string;

            switch (entityIdObject.type) {
                case "Document":
                    entityIconWidth = "normal";
                    entityIconSvg = documentBrandIconSvg;
                    break;
                case "Channel":
                    entityIconWidth = "wide";
                    entityIconSvg = channelBrandIconSvg;
                    break;
                case "Task":
                    entityIconWidth = "wide";
                    entityIconSvg = taskBrandIconSvg;
                    break;
                case "TaskCollection":
                    entityIconWidth = "normal";
                    entityIconSvg = taskCollectionBrandIconSvg;
                    break;
                case "Post":
                    entityIconWidth = "wide";
                    entityIconSvg = postBrandIconSvg;
                    break;
                default:
                    throw exhaustive(entityIdObject);
            }

            html.appendChild(
                renderContentMentionIcon({
                    width: entityIconWidth,
                    children: createSvgHtmlGenerator(
                        entityIconSvg({
                            size: `${contentStyles.mentionIconSizeEm}em`,
                            // We use a CSS variable for color so when we're inside a `blockQuoteClassName`
                            // we use a slightly lighter grey,
                            color: contentStyles.mentionEntityIconColorVar,
                        }),
                    ),
                }),
            );

            const searchEntity = references.searchEntityById.get(mention.entityId);

            href = !isInert
                ? getSearchDynamicEntityPath(spaceId, entityIdObject, routeLayout)
                : null;

            if (!searchEntity) {
                media = null;
                text = `${missingSearchEntityTitle} ${getSearchEntityNoun(entityIdObject.type)}`;
            } else if (searchEntity.isPrivate) {
                media = null;
                text = `${privateSearchEntityTitle} ${getSearchEntityNoun(entityIdObject.type)}`;

                html.appendChild(
                    renderContentMentionIcon({
                        width: "wide",
                        children: createSvgHtmlGenerator(
                            lockIconSvg({size: `${contentStyles.mentionIconSizeEm}em`}),
                        ),
                    }),
                );
            } else {
                const searchEntityData = get(
                    searchEntityRegistry.getEntityStore(searchEntity.entity),
                );

                // If `title` is null then we assume the entity was deleted. Otherwise, all
                // mentionable entities should have a non-null title.
                if (searchEntityData.title === null) {
                    media = null;
                    text = `${deletedSearchEntityTitle} ${getSearchEntityNoun(
                        entityIdObject.type,
                    )}`;

                    html.appendChild(
                        renderContentMentionIcon({
                            width: "wide",
                            children: createSvgHtmlGenerator(
                                trashIconSvg({size: `${contentStyles.mentionIconSizeEm}em`}),
                            ),
                        }),
                    );
                } else {
                    media = searchEntityData.media;

                    const entityTitle = truncateContentMentionText(searchEntityData.title);

                    if (entityTitle.length === 0) {
                        const entityIdObject = parseSearchMentionEntityId(mention.entityId);
                        text = `${missingSearchEntityTitle} ${getSearchEntityNoun(
                            entityIdObject.type,
                        )}`;
                    } else {
                        text = entityTitle;
                    }
                }
            }
            break;
        }
        default:
            throw exhaustive(mention);
    }

    if (media) {
        switch (media.type) {
            case "Account": {
                const accountData = get(accountRegistry.getAccountStore(media.account));

                html.appendChild(
                    renderContentMentionIcon({
                        width: "wide",
                        withScaling: true,
                        children: renderAccountAvatar({
                            accountData,
                            size: contentStyles.mentionIconWithScalingSize,
                            spacingScale,
                        }),
                    }),
                );

                // Post titles are of the form "in ${channelName}: ". We rely on the client to
                // add the account name to the post mention title.
                if (mention.type === "SearchEntity" && mention.entityId.startsWith("Post:")) {
                    text = `${getAccountShortNameWithoutFullNameTooltip(accountData)} ${text}`;
                }
                break;
            }
            case "AccountPile": {
                // Unimplemented...
                break;
            }
            case "TaskCollectionColor": {
                const colorContainerHtml = new HtmlElementGenerator("span");

                colorContainerHtml.setAttribute(
                    "class",
                    sprinkles({
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        width: contentStyles.mentionIconWithScalingSize,
                        height: contentStyles.mentionIconWithScalingSize,
                    }),
                );

                colorContainerHtml.setAttribute("style", `width: ${addRemLengths("4", "0.5")}`);

                const colorHtml = colorContainerHtml.appendChild(new HtmlElementGenerator("span"));

                colorHtml.setAttribute(
                    "class",
                    sprinkles({
                        display: "block",
                        flexShrink: "0",
                        backgroundColor: getTaskCollectionColor(media.color),
                        borderRadius: "full",
                    }),
                );

                const colorSize = addRemLengths("3", "0.5");
                colorHtml.setAttribute("style", `width: ${colorSize}; height: ${colorSize}`);

                html.appendChild(
                    renderContentMentionIcon({
                        width: "narrow",
                        withScaling: true,
                        children: colorContainerHtml,
                    }),
                );
                break;
            }
            case "TaskDisplayStatus": {
                html.appendChild(
                    renderContentMentionIcon({
                        width: "wide",
                        withScaling: true,
                        children: renderTaskDisplayStatusCircle({
                            displayStatus: media.displayStatus,
                            size: contentStyles.mentionIconWithScalingSize,
                            // Content mention icons render at size "7" then are scaled down based on the
                            // font size. We want our task display circle to have a 1px border when scaled
                            // down to "4" so use that ratio as the `scale` property.
                            scale: 4 / parseInt(contentStyles.mentionIconWithScalingSize, 10),
                        }),
                    }),
                );
                break;
            }
            default:
                throw exhaustive(media);
        }
    }

    const textHtml = html.appendChild(new HtmlElementGenerator("span"));
    textHtml.setAttribute("class", contentStyles.mentionTextClassName);
    textHtml.appendChild(new HtmlTextGenerator(text));

    // Add a little more right padding to current account mentions so the
    // background color extends further to the right and looks nice. We have to use
    // no-break space so that Chrome text selection highlight is contiguous across
    // the mention (vs using `padding-right` which creates gaps in the selection).
    if (isCurrentAccountMention) {
        textHtml.appendChild(new HtmlTextGenerator("\u202F"));
    }

    // We need a container element for `highlight` mark styles to be applied to.
    // Our mention element may have a background color when mentioning the
    // current account.
    const containerHtml =
        isInert || href === null ? new HtmlElementGenerator("span") : new HtmlElementGenerator("a");

    if (containerHtml.tagName === "a") {
        containerHtml.setAttribute("href", href);
    }

    containerHtml.setAttribute("class", contentStyles.mentionContainerClassName);

    containerHtml.appendChild(html);

    return containerHtml;
}

function renderContentMentionIcon({
    width,
    withScaling,
    children: childrenHtml,
}: {
    width: "narrow" | "normal" | "wide";
    withScaling?: boolean;
    children: HtmlGenerator;
}) {
    const iconContainerHtml = new HtmlElementGenerator("span");
    iconContainerHtml.setAttribute("class", contentStyles.mentionIconContainerClassName);

    const iconHtml = iconContainerHtml.appendChild(new HtmlElementGenerator("span"));
    iconHtml.setAttribute(
        "class",
        classNames(
            contentStyles.mentionIconClassName,
            withScaling && contentStyles.mentionIconWithScalingClassName,
        ),
    );
    iconHtml.appendChild(childrenHtml);

    // The width of this element is provided by some no-break space characters.
    // That way if the user highlights the mention there will be consistent
    // background color.
    //
    // https://graphemica.com/%C2%A0
    //
    // We need to be careful about the number of spaces we add since this needs to
    // look good in monospace fonts too.
    {
        const space1Html = iconContainerHtml.appendChild(new HtmlElementGenerator("span"));
        space1Html.setAttribute("class", contentStyles.mentionIconMonospaceSpaceClassName);

        switch (width) {
            case "narrow": {
                space1Html.appendChild(new HtmlTextGenerator("\u00A0"));
                iconContainerHtml.appendChild(new HtmlTextGenerator("\u00A0"));
                break;
            }
            case "normal": {
                space1Html.appendChild(new HtmlTextGenerator("\u00A0\u00A0"));
                iconContainerHtml.appendChild(new HtmlTextGenerator("\u202F"));
                break;
            }
            case "wide": {
                space1Html.appendChild(new HtmlTextGenerator("\u00A0\u00A0"));
                iconContainerHtml.appendChild(new HtmlTextGenerator("\u00A0"));
                break;
            }
            default:
                throw exhaustive(width);
        }
    }

    return iconContainerHtml;
}
