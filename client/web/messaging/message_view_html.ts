import {CalendarDate} from "@internationalized/date";
import classNames from "classnames";
import {renderAccountAvatar} from "~/client/web/accounts/account_avatar_html.js";
import {AccountRegistry} from "~/client/web/accounts/account_registry.js";
import {ContentFileEntityRenderers} from "~/client/web/content/content_file_entity_renderers_context.js";
import {FileRegistry} from "~/client/web/content/file_registry.js";
import {hasStandaloneMarginByContentBlockNodeTypeName} from "~/client/web/content/has_standalone_margin_by_content_block_node_type_name.js";
import {
    getTruncatedMessageContentForReplyHtmlGeneratorPreview,
    getTruncatedMessagesRangeContentForReplyHtmlGeneratorPreview,
} from "~/client/web/content/messaging/get_truncated_message_content_for_reply_preview.js";
import {renderMessageViewFiles} from "~/client/web/content/messaging/message_view_files_html.js";
import {renderContentFragmentToHtmlGeneratorStore} from "~/client/web/content/render_content_to_html.js";
import {AppContext} from "~/client/web/context/app_context.js";
import {createSvgHtmlGenerator} from "~/client/web/icons/create_svg_html_generator.js";
import {trashIconSvg} from "~/client/web/icons/trash_icon_svg.js";
import {getMessageTextForBigEmojiMessage} from "~/client/web/messaging/internal/get_message_text_for_big_emoji_message.js";
import {getMessageViewMarginBottom} from "~/client/web/messaging/internal/get_message_view_margin_bottom.js";
import {shouldMergeMessages} from "~/client/web/messaging/internal/should_merge_messages.js";
import {SearchEntityRegistry} from "~/client/web/search/core/search_entity_registry.js";
import {
    messageViewAccountAvatarSize,
    messageViewAccountNameFontSize,
    messageViewAccountNameHeight,
    messageViewAvatarOffsetYPx,
    messageViewBigEmojiLineHeight,
    messageViewMarginLeft,
    messageViewParentAccountAvatarSize,
    messageViewParentAvatarOffsetYRem,
    messageViewParentFontSize,
    messageViewParentLineClamp,
    messageViewParentLineHeightPx,
    messageViewParentMarginBottom,
    messageViewParentMarginTop,
    messageViewRailGap,
} from "~/client/web/styles/messaging_shared_styles.js";
import {
    colorSchemeVars,
    contentStyles,
    emojiFontFamily,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {Platform} from "~/shared/design/core/platform.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {
    RemLength,
    convertRemLengthToPx,
    parseRemLength,
    screenPaddingX,
    spacing,
} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {InternalError} from "~/shared/error/error.js";
import {getFileEntityNoun} from "~/shared/files/get_file_entity_noun.js";
import {
    NonEmptyReadonlyArray,
    assertNonEmptyReadonlyArray,
} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    HtmlElementGenerator,
    HtmlFragmentGenerator,
    HtmlTextGenerator,
} from "~/shared/helpers/html/html_generator.js";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {cutMessageContentPayloadWithReferences} from "~/shared/messaging/cut_message_content_payload.js";
import {MessageModel} from "~/shared/messaging/message_model.js";
import {ClientInfo} from "~/shared/remix/client_info.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";

// TODO(calebmer): There's some stuff that hasn't been implemented for now:
//
// - Message view thinking indicator
// - Message reaction party
// - Message "(updated)" text after edit
//
// We want to add these eventually but for our current use case (chat file entity
// preview) we don't need them.

export function renderMessageView(
    get: <Value>(store: Store<Value>) => Value,
    parentHtml: HtmlElementGenerator,
    {
        messageNoun,
        message,
        previousMessage,
        nextMessage,
        messageByIndex,
        blockWidthPx,
        getContext,
        clientInfo,
        spaceId,
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
        currentAccount,
        transformScale,
        platform,
        spacingScale,
        routeLayout,
        isInitialAppRender,
        currentDate,
        fileEntityRenderers,
        suppressHydrationWarning,
    }: {
        messageNoun: string;
        message: MessageModel;
        previousMessage: MessageModel | null;
        nextMessage: MessageModel | null;
        messageByIndex: Map<number, MessageModel>;
        blockWidthPx: number;
        getContext: () => AppContext;
        clientInfo: ClientInfo;
        spaceId: SpaceId | null;
        accountRegistry: AccountRegistry;
        searchEntityRegistry: SearchEntityRegistry;
        fileRegistry: FileRegistry;
        currentAccount: AccountModel | null;
        transformScale: number;
        platform: Platform;
        spacingScale: SpacingScale;
        routeLayout: RouteLayout;
        isInitialAppRender: boolean;
        currentDate: CalendarDate;
        fileEntityRenderers: ContentFileEntityRenderers | null;
        suppressHydrationWarning: () => void;
    },
) {
    const shouldMergeWithPreviousMessage =
        previousMessage !== null && shouldMergeMessages(previousMessage, message);

    const shouldMergeWithNextMessage =
        nextMessage !== null && shouldMergeMessages(message, nextMessage);

    const marginBottom = getMessageViewMarginBottom({
        isLastMessage: nextMessage === null,
        message,
        nextMessage,
        shouldMergeWithNextMessage,
    });

    const messageContainerHtml = parentHtml.appendChild(new HtmlElementGenerator("div"));
    messageContainerHtml.setAttribute(
        "class",
        sprinkles({
            position: "relative",
            width: "full",
            maxWidth: contentStyles.contentMaxWidth,
            marginX: "auto",
            paddingX: screenPaddingX,
            paddingBottom: marginBottom,
        }),
    );

    const parent = getMessageViewHtmlParent(message, messageByIndex);
    if (parent !== null) {
        renderMessageViewParent(get, messageContainerHtml, {
            parent,
            messageNoun,
            accountRegistry,
            searchEntityRegistry,
            fileRegistry,
            spacingScale,
        });
    }

    const messageRowHtml = messageContainerHtml.appendChild(new HtmlElementGenerator("div"));
    messageRowHtml.setAttribute(
        "class",
        sprinkles({
            position: "relative",
            zIndex: "0",
            display: "flex",
            gap: messageViewRailGap,
        }),
    );

    const avatarRailHtml = messageRowHtml.appendChild(new HtmlElementGenerator("div"));
    avatarRailHtml.setAttribute(
        "class",
        sprinkles({
            flexShrink: "0",
            width: messageViewAccountAvatarSize,
        }),
    );

    const messageAuthor = get(accountRegistry.getAccountStore(message.author));

    if (!shouldMergeWithPreviousMessage) {
        const avatarContainerHtml = avatarRailHtml.appendChild(new HtmlElementGenerator("div"));
        avatarContainerHtml.setAttribute("class", sprinkles({position: "relative"}));
        avatarContainerHtml.setAttribute(
            "style",
            `top: ${messageViewAvatarOffsetYPx[spacingScale]}px`,
        );
        avatarContainerHtml.appendChild(
            renderAccountAvatar({
                accountData: messageAuthor,
                size: messageViewAccountAvatarSize,
                spacingScale,
            }),
        );
    }

    const contentContainerHtml = messageRowHtml.appendChild(new HtmlElementGenerator("div"));
    contentContainerHtml.setAttribute(
        "class",
        sprinkles({
            flexGrow: "1",
            minWidth: "flex-fit",
        }),
    );

    if (!shouldMergeWithPreviousMessage) {
        const authorRowHtml = contentContainerHtml.appendChild(new HtmlElementGenerator("div"));
        authorRowHtml.setAttribute(
            "class",
            sprinkles({
                maxWidth: "full",
                height: messageViewAccountNameHeight,
                display: "flex",
                alignItems: "center",
            }),
        );

        const authorNameHtml = authorRowHtml.appendChild(new HtmlElementGenerator("div"));
        authorNameHtml.setAttribute(
            "class",
            sprinkles({
                fontSize: messageViewAccountNameFontSize,
                fontStyle: "truncate",
                color: "grey-60",
            }),
        );
        authorNameHtml.setAttribute(
            "style",
            `line-height: ${spacing[messageViewAccountNameHeight]}`,
        );

        if (
            message.payload.type === "Content" &&
            message.payload.clerical?.type === "ShareNotification"
        ) {
            authorNameHtml.appendChild(
                new HtmlTextGenerator(
                    `${getAccountShortNameWithoutFullNameTooltip(messageAuthor)} shared a ${getFileEntityNoun(message.payload.clerical.entityType)} with you`,
                ),
            );
        } else {
            authorNameHtml.appendChild(new HtmlTextGenerator(messageAuthor.name));
        }
    }

    switch (message.payload.type) {
        case "Content": {
            const contentBlockWidthPx =
                blockWidthPx - convertRemLengthToPx(messageViewMarginLeft, spacingScale);

            const messageTextForBigEmoji = getMessageTextForBigEmojiMessage(message);
            let didRenderMessageContent = false;

            if (messageTextForBigEmoji !== null) {
                const bigEmojiHtml = contentContainerHtml.appendChild(
                    new HtmlElementGenerator("div"),
                );
                bigEmojiHtml.setAttribute(
                    "class",
                    sprinkles({
                        fontSize: "600",
                    }),
                );
                bigEmojiHtml.setAttribute(
                    "style",
                    `line-height: ${spacing[messageViewBigEmojiLineHeight]}`,
                );
                appendBigEmojiMessageChildren(bigEmojiHtml, messageTextForBigEmoji);
                didRenderMessageContent = true;
            } else {
                // This merges the message stream content into the message. So we render the whole
                // thing at once.
                const contentWithReferences = cutMessageContentPayloadWithReferences({
                    payload: message.payload,
                    stream: message.stream,
                });

                if (!isContentEmpty(contentWithReferences.doc)) {
                    const contentHtml = contentContainerHtml.appendChild(
                        new HtmlElementGenerator("div"),
                    );
                    contentHtml.setAttribute(
                        "class",
                        classNames(
                            contentStyles.docClassName,
                            contentStyles.messageDocClassName,
                            contentStyles.withUserSelectNoneDocClassName,
                            contentStyles.narrowRouteLayoutDocClassName,
                            contentStyles.withoutBlockMaxWidthDocClassName,
                        ),
                    );
                    contentHtml.appendChild(
                        renderContentFragmentToHtmlGeneratorStore(get, contentWithReferences, {
                            isInert: true,
                            getContext,
                            clientInfo,
                            spaceId,
                            accountRegistry,
                            searchEntityRegistry,
                            fileRegistry,
                            currentAccount,
                            blockWidth: contentBlockWidthPx,
                            transformScale,
                            platform,
                            spacingScale,
                            routeLayout,
                            isInitialAppRender,
                            currentDate,
                            fileEntityRenderers,
                            suppressHydrationWarning,
                            withFileIdAttribute: true,
                        }),
                    );

                    didRenderMessageContent = true;
                }
            }

            if (message.payload.files.length > 0) {
                renderMessageViewFiles(get, contentContainerHtml, {
                    files: message.payload.files,
                    paddingTop: didRenderMessageContent
                        ? getMessageViewFilesPaddingTop(message)
                        : null,
                    blockWidthPx: contentBlockWidthPx,
                    getContext,
                    clientInfo,
                    spaceId,
                    accountRegistry,
                    searchEntityRegistry,
                    fileRegistry,
                    currentAccount,
                    transformScale,
                    platform,
                    spacingScale,
                    routeLayout,
                    isInitialAppRender,
                    currentDate,
                    fileEntityRenderers,
                    suppressHydrationWarning,
                    // Must include file attribute to properly load files.
                    withFileIdAttribute: true,
                });
            }
            break;
        }
        case "Deleted": {
            const deletedHtml = contentContainerHtml.appendChild(new HtmlElementGenerator("div"));
            deletedHtml.setAttribute(
                "class",
                sprinkles({
                    display: "inline",
                    color: "grey-60",
                    fontSize: "100",
                }),
            );
            deletedHtml.setAttribute(
                "style",
                `line-height: ${contentStyles.paragraphLineHeightPx[spacingScale]}px`,
            );

            deletedHtml.appendChild(
                createSvgHtmlGenerator(
                    trashIconSvg({
                        size: spacing["4"],
                        style: [
                            "display: inline",
                            "vertical-align: top",
                            "position: relative",
                            // Optically align icon with text.
                            "top: 0.1875rem",
                        ].join("; "),
                    }),
                ),
            );

            deletedHtml.appendChild(new HtmlTextGenerator(` Deleted ${messageNoun}`));
            break;
        }
        default:
            throw exhaustive(message.payload);
    }
}

function appendBigEmojiMessageChildren(
    html: HtmlElementGenerator,
    messageTextForBigEmojiMessage: string,
) {
    let lastIndex = 0;

    for (const {index, emoji} of iterateEmojis(messageTextForBigEmojiMessage)) {
        if (lastIndex !== index) {
            html.appendChild(
                new HtmlTextGenerator(messageTextForBigEmojiMessage.slice(lastIndex, index)),
            );
        }

        const emojiHtml = html.appendChild(new HtmlElementGenerator("span"));
        emojiHtml.setAttribute("style", `font-family: ${emojiFontFamily}`);
        emojiHtml.appendChild(new HtmlTextGenerator(emoji));

        lastIndex = index + emoji.length;
    }

    if (lastIndex < messageTextForBigEmojiMessage.length) {
        html.appendChild(new HtmlTextGenerator(messageTextForBigEmojiMessage.slice(lastIndex)));
    }
}

function getMessageViewFilesPaddingTop(message: MessageModel): RemLength {
    assert(message.payload.type === "Content");

    if (
        message.payload.content.doc.childCount === 1 &&
        !hasStandaloneMarginByContentBlockNodeTypeName[
            message.payload.content.doc.firstChild!.type.name
        ]
    ) {
        return spacing[contentStyles.paragraphMargin];
    }

    if (message.payload.content.doc.lastChild!.type.name === "divider") {
        return spacing[contentStyles.messageDividerMargin];
    }

    return spacing[contentStyles.standaloneBlockMargin];
}

type MessageViewHtmlParent =
    | {
          readonly type: "Message";
          readonly message: MessageModel;
      }
    | {
          readonly type: "MessagesRange";
          readonly messages: NonEmptyReadonlyArray<MessageModel>;
          readonly startIndex: number;
          readonly endIndex: number;
          readonly startContentVersion: number;
          readonly endContentVersion: number;
          readonly startPos: number;
          readonly endPos: number;
      };

function getMessageViewHtmlParent(
    actualMessage: MessageModel,
    messageByIndex: Map<number, MessageModel>,
): MessageViewHtmlParent | null {
    if (actualMessage.payload.type !== "Content" || actualMessage.payload.parent === null) {
        return null;
    }

    const {parent} = actualMessage.payload;

    switch (parent.type) {
        case "Message": {
            const message = messageByIndex.get(parent.index);
            if (!message) return null;
            return {type: "Message", message};
        }
        case "MessagesRange": {
            const parentMessages: Array<MessageModel> = [];

            for (let index = parent.startIndex; index <= parent.endIndex; index++) {
                const message = messageByIndex.get(index);
                if (!message) return null;
                parentMessages.push(message);
            }

            return {...parent, messages: assertNonEmptyReadonlyArray(parentMessages)};
        }
        case "PostRange": {
            throw new InternalError("Post range parent may only be used in a post room");
        }
        default:
            throw exhaustive(parent);
    }
}

function renderMessageViewParent(
    get: <Value>(store: Store<Value>) => Value,
    containerHtml: HtmlElementGenerator,
    {
        parent,
        messageNoun,
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
        spacingScale,
    }: {
        parent: MessageViewHtmlParent;
        messageNoun: string;
        accountRegistry: AccountRegistry;
        searchEntityRegistry: SearchEntityRegistry;
        fileRegistry: FileRegistry;
        spacingScale: SpacingScale;
    },
) {
    const {author, truncatedContent} = getMessageViewParentAuthorAndTruncatedContent(get, {
        parent,
        messageNoun,
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
    });

    const accountAvatarSizeRem = parseRemLength(messageViewAccountAvatarSize);
    const parentMessageOffsetRem = parseRemLength(messageViewRailGap) / 2;
    const parentMessageAccountAvatarSizeRem = parseRemLength(messageViewParentAccountAvatarSize);

    const parentHtml = containerHtml.appendChild(new HtmlElementGenerator("div"));
    parentHtml.setAttribute(
        "class",
        sprinkles({
            position: "relative",
            zIndex: "10",
            display: "inline-flex",
            gap: "1.5",
            marginTop: messageViewParentMarginTop,
            marginBottom: messageViewParentMarginBottom,
            maxWidth: "full",
        }),
    );
    parentHtml.setAttribute(
        "style",
        `margin-left: ${accountAvatarSizeRem + parentMessageOffsetRem}rem`,
    );

    const connectorHtml = parentHtml.appendChild(new HtmlElementGenerator("div"));
    connectorHtml.setAttribute(
        "class",
        sprinkles({
            pointerEvents: "none",
            position: "absolute",
            borderLeftWidth: "thick",
            borderTopWidth: "thick",
            borderTopLeftRadius: "2.5",
        }),
    );
    connectorHtml.setAttribute(
        "style",
        [
            `border-left-color: ${colorSchemeVars["grey-5-translucent"]}`,
            `border-top-color: ${colorSchemeVars["grey-5-translucent"]}`,
            "border-style: solid",

            // Remember this code is copied here and in `message_view.ts`. If you update one
            // you probably need to update the other as well.
            `top: calc(${messageViewParentAvatarOffsetYRem + parentMessageAccountAvatarSizeRem / 2}rem - 1px)`,
            `bottom: calc(-${spacing[messageViewParentMarginBottom]} - ${messageViewAvatarOffsetYPx[spacingScale] - 2}px)`,
            `left: calc(-${accountAvatarSizeRem / 2 + parentMessageOffsetRem}rem - 1px)`,
            `width: calc(${accountAvatarSizeRem / 2 + parentMessageOffsetRem}rem - 2px)`,
        ].join("; "),
    );

    const avatarHtml = parentHtml.appendChild(new HtmlElementGenerator("div"));
    avatarHtml.setAttribute(
        "class",
        sprinkles({
            flexShrink: "0",
            position: "relative",
            height: "0",
        }),
    );
    avatarHtml.setAttribute("style", `top: ${messageViewParentAvatarOffsetYRem}rem`);
    avatarHtml.appendChild(
        renderAccountAvatar({
            accountData: author,
            size: messageViewParentAccountAvatarSize,
            spacingScale,
        }),
    );

    const textHtml = parentHtml.appendChild(new HtmlElementGenerator("div"));
    textHtml.setAttribute(
        "class",
        sprinkles({
            overflow: "hidden",
            color: "grey-80",
            fontSize: messageViewParentFontSize,
            fontStyle: "normal",
        }),
    );
    textHtml.setAttribute(
        "style",
        [
            `min-height: ${messageViewParentLineHeightPx[spacingScale]}px`,
            `line-height: ${messageViewParentLineHeightPx[spacingScale]}px`,
            // Allow contextual alternate glyphs in regular text content.
            // eslint-disable-next-line cyberworlds/string-quotes
            'font-feature-settings: "calt" on',
            "display: -webkit-box",
            `-webkit-line-clamp: ${messageViewParentLineClamp}`,
            `line-clamp: ${messageViewParentLineClamp}`,
            "-webkit-box-orient: vertical",
            "text-overflow: ellipsis",
        ].join("; "),
    );
    textHtml.appendChild(
        new HtmlTextGenerator(`${getAccountShortNameWithoutFullNameTooltip(author)}: `),
    );
    textHtml.appendChild(truncatedContent);
}

function getMessageViewParentAuthorAndTruncatedContent(
    get: <Value>(store: Store<Value>) => Value,
    {
        parent,
        messageNoun,
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
    }: {
        parent: MessageViewHtmlParent;
        messageNoun: string;
        accountRegistry: AccountRegistry;
        searchEntityRegistry: SearchEntityRegistry;
        fileRegistry: FileRegistry;
    },
): {
    author: AccountModelData;
    truncatedContent: HtmlFragmentGenerator;
} {
    switch (parent.type) {
        case "Message": {
            return {
                author: get(accountRegistry.getAccountStore(parent.message.author)),
                truncatedContent: getTruncatedMessageContentForReplyHtmlGeneratorPreview(get, {
                    message: parent.message,
                    messageNoun,
                    accountRegistry,
                    searchEntityRegistry,
                    fileRegistry,
                }),
            };
        }
        case "MessagesRange": {
            return {
                author: get(accountRegistry.getAccountStore(parent.messages[0].author)),
                truncatedContent: getTruncatedMessagesRangeContentForReplyHtmlGeneratorPreview(
                    get,
                    {
                        messages: parent.messages,
                        startContentVersion: parent.startContentVersion,
                        startPos: parent.startPos,
                        endContentVersion: parent.endContentVersion,
                        endPos: parent.endPos,
                        messageNoun,
                        accountRegistry,
                        searchEntityRegistry,
                        fileRegistry,
                    },
                ),
            };
        }
        default:
            throw exhaustive(parent);
    }
}
