import {CalendarDate} from "@internationalized/date";
import classNames from "classnames";
import {renderAccountAvatarPile} from "~/client/web/accounts/account_avatar_pile_html.js";
import {AccountRegistry} from "~/client/web/accounts/account_registry.js";
import {ContentFileEntityRenderers} from "~/client/web/content/content_file_entity_renderers_context.js";
import {addContentFileContentViewEntityPreviewBehavior} from "~/client/web/content/file_entity/internal/add_content_file_content_view_entity_preview_behavior.js";
import {setupContentFileEntityPreviewContainer} from "~/client/web/content/file_entity/internal/content_file_entity_preview_container.js";
import {
    addContentFileEntitySubscribeButtonBehavior,
    renderContentFileEntitySubscribeButton,
} from "~/client/web/content/file_entity/internal/content_file_entity_subscribe_button.js";
import {FileRegistry} from "~/client/web/content/file_registry.js";
import {ContentFileLayout} from "~/client/web/content/state/content_file_layout_computations.js";
import {AppContext} from "~/client/web/context/app_context.js";
import {Reporter} from "~/client/web/design/reporter.js";
import {createSvgHtmlGenerator} from "~/client/web/icons/create_svg_html_generator.js";
import {lockBoldFillIconSvg} from "~/client/web/icons/lock_bold_fill_icon_svg.js";
import {renderMessageView} from "~/client/web/messaging/message_view_html.js";
import {SearchEntityRegistry} from "~/client/web/search/core/search_entity_registry.js";
import {
    messageViewAccountAvatarSize,
    messageViewMinHeightPx,
} from "~/client/web/styles/messaging_shared_styles.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {ChatMessageModel} from "~/shared/chat/chat_model.js";
import {
    FileChatEntityModel,
    FileChatEntityModelSchema,
} from "~/shared/chat/file_chat_entity_model_schema.js";
import {Platform} from "~/shared/design/core/platform.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {convertRemLengthToPx, screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {ClientInfo} from "~/shared/remix/client_info.js";
import {subscribeToRoomChat, unsubscribeFromRoomChat} from "~/shared/rpc/chat_rpc_definitions.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";

export function renderContentFileChatEntityPreview(
    get: <Value>(store: Store<Value>) => Value,
    html: HtmlElementGenerator,
    {
        fileEntity: unknownFileEntity,
        layout,
        getContext,
        clientInfo,
        spaceId,
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
        currentAccount,
        transformScale: originalTransformScale,
        platform,
        spacingScale,
        routeLayout,
        isInitialAppRender,
        currentDate,
        fileEntityRenderers,
        suppressHydrationWarning,
    }: {
        fileEntity: FileEntityModel;
        layout: ContentFileLayout;
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
    const fileEntity = unknownFileEntity.deserialize(FileChatEntityModelSchema);

    const {
        scaledContainerHtml,
        transformScale,
        scaledWidthPx,
        isSmallerThanHalfOfBlockMaxWidth,
        containerPaddingPx,
    } = setupContentFileEntityPreviewContainer(html, {
        layout,
        platform,
        spacingScale,
        transformScaleBaseFontSize: "100",
        withoutContainerPaddingY: true,
    });

    scaledContainerHtml.setAttribute(
        "class",
        classNames(
            scaledContainerHtml.getAttribute("class"),
            sprinkles({
                display: "flex",
                flexDirection: "column",
            }),
        ),
    );

    scaledContainerHtml.setAttribute(
        "style",
        [
            assertExists(scaledContainerHtml.getAttribute("style")),
            `height: ${Math.ceil(layout.height / transformScale)}px`,
        ].join("; "),
    );

    renderFileChatEntityPreviewTopBar(get, scaledContainerHtml, {
        fileEntity,
        currentAccount,
        accountRegistry,
        spacingScale,
        isSmallerThanHalfOfBlockMaxWidth,
        transformScale,
        containerPaddingPx,
    });

    const messagesContainerHtml = scaledContainerHtml.appendChild(new HtmlElementGenerator("div"));
    messagesContainerHtml.setAttribute(
        "class",
        sprinkles({
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            flexGrow: "1",
            marginX: `-${screenPaddingX[platform]}`,
        }),
    );

    const messageByIndex = new Map<number, ChatMessageModel>();
    for (const message of fileEntity.otherReferencedMessages) {
        messageByIndex.set(message.index, message);
    }
    for (const message of fileEntity.messages) {
        messageByIndex.set(message.index, message);
    }

    const messagesLayer1Html = messagesContainerHtml.appendChild(new HtmlElementGenerator("div"));

    messagesLayer1Html.setAttribute(
        "class",
        sprinkles({
            width: "full",
            minHeight: "0",
            flexGrow: "1",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            alignItems: "flex-start",
        }),
    );

    const messagesLayer2Html = messagesContainerHtml.appendChild(new HtmlElementGenerator("div"));
    messagesLayer2Html.setAttribute(
        "class",
        sprinkles({
            width: "full",
            minHeight: "0",
            flexShrink: "0",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-start",
            alignItems: "flex-start",
        }),
    );

    if (fileEntity.messages.length !== 1) {
        messagesLayer2Html.setAttribute(
            "style",
            [`height: ${messageViewMinHeightPx[spacingScale]}px`].join("; "),
        );
    } else {
        messagesLayer2Html.setAttribute(
            "style",
            ["height: auto", `padding-top: ${spacing["4"]}`].join("; "),
        );
    }

    for (let index = 0; index < fileEntity.messages.length; index++) {
        const message = fileEntity.messages[index]!;

        renderMessageView(
            get,
            index === fileEntity.messages.length - 1 ? messagesLayer2Html : messagesLayer1Html,
            {
                messageNoun: "message",
                message,
                previousMessage: index > 0 ? fileEntity.messages[index - 1]! : null,
                nextMessage:
                    index < fileEntity.messages.length - 1 ? fileEntity.messages[index + 1]! : null,
                messageByIndex,
                // We don't use `Math.min(scaledWidthPx, blockMaxWidthPx)` like we do in
                // documents because we turn off max width in the message view
                // (`contentStyles.withoutBlockMaxWidthDocClassName`) so the post extends
                // end-to-end within the preview. Usually, the file entity preview width
                // shouldn't be that much more than the block width.
                blockWidthPx: scaledWidthPx,
                getContext,
                clientInfo,
                spaceId,
                accountRegistry,
                searchEntityRegistry,
                fileRegistry,
                currentAccount,
                transformScale: originalTransformScale * transformScale,
                platform,
                spacingScale,
                routeLayout,
                isInitialAppRender,
                currentDate,
                fileEntityRenderers,
                suppressHydrationWarning,
            },
        );
    }
}

function renderFileChatEntityPreviewTopBar(
    get: <Value>(store: Store<Value>) => Value,
    containerHtml: HtmlElementGenerator,
    {
        fileEntity,
        currentAccount,
        accountRegistry,
        spacingScale,
        isSmallerThanHalfOfBlockMaxWidth,
        transformScale,
        containerPaddingPx,
    }: {
        fileEntity: FileChatEntityModel;
        currentAccount: AccountModel | null;
        accountRegistry: AccountRegistry;
        spacingScale: SpacingScale;
        isSmallerThanHalfOfBlockMaxWidth: boolean;
        transformScale: number;
        containerPaddingPx: number;
    },
) {
    const topBarHtml = containerHtml.appendChild(new HtmlElementGenerator("div"));
    topBarHtml.setAttribute(
        "class",
        sprinkles({
            position: "relative",
            flexShrink: "0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "5",
            backgroundColor: "grey-0",
        }),
    );

    const scaledContainerPaddingPx = containerPaddingPx / transformScale;

    topBarHtml.setAttribute(
        "style",
        [
            `padding: ${scaledContainerPaddingPx.toFixed(2)}px 0`,
            `height: ${(convertRemLengthToPx(contentStyles.fileEntityPreviewSubscribeButtonHeight, spacingScale) + scaledContainerPaddingPx * 2).toFixed(2)}px`,
        ].join("; "),
    );

    const topBarBorderHtml = topBarHtml.appendChild(new HtmlElementGenerator("div"));

    topBarBorderHtml.setAttribute(
        "style",
        [
            "position: absolute",
            "bottom: -1px",
            `left: -${Math.ceil(scaledContainerPaddingPx)}px`,
            `right: -${Math.ceil(scaledContainerPaddingPx)}px`,
            "height: 1px",
            `background-color: ${colorSchemeVars["grey-5-translucent"]}`,
        ].join("; "),
    );

    const titleContainerHtml = topBarHtml.appendChild(new HtmlElementGenerator("div"));
    titleContainerHtml.setAttribute(
        "class",
        sprinkles({
            display: "flex",
            alignItems: "center",
            gap: "2",
            minWidth: "flex-fit",
        }),
    );

    switch (fileEntity.definition.type) {
        case "Direct": {
            const otherChatAccounts =
                fileEntity.definition.accounts.length === 1 &&
                fileEntity.definition.accounts[0]!.id === currentAccount?.id
                    ? [currentAccount]
                    : fileEntity.definition.accounts.filter(
                          account => account.id !== currentAccount?.id,
                      );

            const otherChatAccountDatas = otherChatAccounts.map(account =>
                get(accountRegistry.getAccountStore(account)),
            );

            titleContainerHtml.appendChild(
                renderAccountAvatarPile({
                    spacingScale,
                    size: messageViewAccountAvatarSize,
                    previewAccounts: otherChatAccountDatas.slice(0, 4),
                    accountCount: otherChatAccountDatas.length,
                }),
            );

            const chatNameHtml = titleContainerHtml.appendChild(new HtmlElementGenerator("div"));
            chatNameHtml.setAttribute(
                "class",
                sprinkles({
                    marginY: "0",
                    fontStyle: "truncate-semi-bold",
                    fontSize: "200",
                }),
            );

            chatNameHtml.appendChild(
                new HtmlTextGenerator(
                    otherChatAccountDatas.length === 1
                        ? getAccountShortNameWithoutFullNameTooltip(otherChatAccountDatas[0]!)
                        : joinPrettyConjunctionList(
                              otherChatAccountDatas.map(account =>
                                  getAccountShortNameWithoutFullNameTooltip(account),
                              ),
                          ),
                ),
            );
            break;
        }
        case "Room": {
            if (fileEntity.definition.isPrivate) {
                titleContainerHtml.appendChild(
                    createSvgHtmlGenerator(
                        lockBoldFillIconSvg({
                            className: sprinkles({flexShrink: "0"}),
                            size: spacing["4"],
                        }),
                    ),
                );
            }

            const roomNameHtml = titleContainerHtml.appendChild(new HtmlElementGenerator("h1"));
            roomNameHtml.setAttribute(
                "class",
                sprinkles({
                    marginY: "0",
                    fontStyle: "truncate-bold",
                    fontSize: "400",
                }),
            );
            roomNameHtml.appendChild(new HtmlTextGenerator(fileEntity.definition.name));

            renderContentFileEntitySubscribeButton(topBarHtml, {
                isVisible: !isSmallerThanHalfOfBlockMaxWidth,
                isSubscribed: fileEntity.isSubscribed,
            });
            break;
        }
        default:
            throw exhaustive(fileEntity.definition);
    }
}

export function addContentFileChatEntityPreviewBehavior(
    getContext: () => AppContext,
    element: HTMLElement,
    {
        fileEntity: unknownFileEntity,
        fileEntityRenderers,
        getReporter,
        isInert,
        spaceId,
    }: {
        fileEntity: FileEntityModel;
        fileEntityRenderers: ContentFileEntityRenderers | null;
        spaceId: SpaceId;
        getReporter: () => Reporter;
        isInert: boolean;
    },
) {
    const fileEntity = unknownFileEntity.deserialize(FileChatEntityModelSchema);

    const cleanupFunctions: Array<() => void> = [];

    cleanupFunctions.push(
        addContentFileContentViewEntityPreviewBehavior(getContext, element, {
            fileEntity: unknownFileEntity,
            fileEntityRenderers,
            spaceId,
            getReporter,
        }),
    );

    if (fileEntity.definition.type === "Room") {
        cleanupFunctions.push(
            addContentFileEntitySubscribeButtonBehavior(element, {
                getReporter,
                isInert,
                subscribe: () => subscribeToRoomChat(getContext(), {chatId: fileEntity.id}),
                unsubscribe: () => unsubscribeFromRoomChat(getContext(), {chatId: fileEntity.id}),
            }),
        );
    }

    return () => {
        for (const cleanup of cleanupFunctions) {
            cleanup();
        }
    };
}
