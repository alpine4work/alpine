import {ArrowSquareOut, Link as LinkIcon} from "phosphor-react";
import {NodeSelection} from "prosemirror-state";
import {NodeViewConstructor} from "prosemirror-view";
import {To} from "react-router";
import {getAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {handleContentLinkClick} from "~/client/web/content/internal/handle_content_link_click.js";
import {renderContentMentionToHtml} from "~/client/web/content/render_content_mention_to_html.js";
import {
    getContentEditorReferences,
    updateContentEditorReferences,
} from "~/client/web/content/state/content_editor_state.js";
import {addParentScrollWhenPointerDownAndOverListener} from "~/client/web/content/state/parent_scroll_when_pointer_down_and_over_event.js";
import {AppContext} from "~/client/web/context/app_context.js";
import {addContextMenuActions} from "~/client/web/design/context_menu.js";
import {isModifiedPointerEvent} from "~/client/web/helpers/events/is_modified_pointer_event.js";
import {isOpenLinkInSeparateTabPointerEvent} from "~/client/web/helpers/events/is_open_link_in_separate_tab_pointer_event.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {getClientInfo} from "~/client/web/remix/client_info_context.js";
import {getSpacingScaleWithoutListening} from "~/client/web/remix/spacing_scale_context.js";
import {getSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {AccessLevel, hasAccessLevel} from "~/shared/access/access_policy.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {RouteLayout} from "~/shared/design/core/route_layout.open_source.js";
import {isFileEntityId, parseFileEntityId} from "~/shared/files/file_entity_id.js";
import {getFileEntityNoun} from "~/shared/files/get_file_entity_noun.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {getFileEntityIfPossible} from "~/shared/rpc/files_rpc_definitions.js";
import {getDynamicSearchEntityPathForFileEntity} from "~/shared/search/path/get_search_entity_path.js";
import {parseSearchDynamicEntityId} from "~/shared/search/search_entity_id.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {computeStore} from "~/shared/store/compute_store.js";

export function createContentEditorMentionNodeViewConstructor({
    getRouteLayout,
    getSpaceId,
    getCurrentAccountIfExists,
    getContext,
    getAccessLevel,
    onNavigate,
}: {
    getRouteLayout: () => RouteLayout;
    getSpaceId: () => SpaceId;
    getCurrentAccountIfExists: () => AccountModel | null;
    getContext: () => AppContext;
    getAccessLevel: () => AccessLevel;
    onNavigate: (to: To) => Promise<void>;
}): NodeViewConstructor {
    return (node, view, getPos) => {
        const mention: ContentMention = node.attrs.mention;
        const mentionEntityId = mention.type === "SearchEntity" ? mention.entityId : null;

        const routeLayout = getRouteLayout();
        const spaceId = getSpaceId();
        const currentAccount = getCurrentAccountIfExists();
        const accountRegistry = getAccountRegistry(spaceId);
        const searchEntityRegistry = getSearchEntityRegistry(spaceId);
        const {references} = getContentEditorReferences(view.state);
        const spacingScale = getSpacingScaleWithoutListening();

        // When rendering account mentions, only allow them to be clicked if we're
        // currently logged in.
        const isInert = mention.type === "Account" && currentAccount === null;

        const htmlStore = computeStore(get => {
            return renderContentMentionToHtml(get, {
                accountRegistry,
                searchEntityRegistry,
                routeLayout,
                spaceId,
                currentAccount,
                references,
                mention,
                isInert,
                spacingScale,
            });
        });

        let previousHtml = htmlStore.getSnapshot();
        const dom = previousHtml.generateNode();

        // Whenever the content mention text changes, we want to update our mention node
        // with the right value.
        const unsubscribe = htmlStore.subscribe(() => {
            const nextHtml = htmlStore.getSnapshot();
            assert(nextHtml.patchNode(previousHtml, dom));
            previousHtml = nextHtml;
        });

        if (!isInert) {
            assert(dom instanceof HTMLAnchorElement);
            let isPointerDownAndOver = false;

            const maybeUpdateStyle = () => {
                if (isPointerDownAndOver) {
                    dom.classList.add(contentStyles.mentionPressedClassName);
                } else {
                    dom.classList.remove(contentStyles.mentionPressedClassName);
                }
            };

            dom.addEventListener("click", event => {
                // Must call prevent default here in addition to `pointerdown` to stop mobile
                // WebKit from following a link after click.
                event.preventDefault();
            });

            dom.addEventListener("pointerdown", event => {
                isPointerDownAndOver =
                    event.button === 0 &&
                    (!isModifiedPointerEvent(event) ||
                        isOpenLinkInSeparateTabPointerEvent(event, getClientInfo()));

                maybeUpdateStyle();

                // This will be a navigation click if the pointer stays over our element. Don't
                // select the editable text.
                event.preventDefault();

                // If this is a shift click, select the mention.
                if (event.shiftKey || event.altKey) {
                    view.focus();
                    view.dispatch(
                        view.state.tr.setSelection(
                            new NodeSelection(view.state.doc.resolve(assertExists(getPos()))),
                        ),
                    );
                }
            });

            dom.addEventListener("pointerup", event => {
                const wasPointerDownAndOver = isPointerDownAndOver;
                isPointerDownAndOver = false;
                maybeUpdateStyle();

                // Only process pointer up events that started on our element.
                if (!wasPointerDownAndOver) return;

                if (event.shiftKey || event.altKey) {
                    // Do nothing. We selected the mention in `pointerdown`.
                } else {
                    handleContentLinkClick(event, dom.href, onNavigate);
                }
            });

            dom.addEventListener("pointerleave", () => {
                isPointerDownAndOver = false;
                maybeUpdateStyle();
            });

            dom.addEventListener("pointercancel", () => {
                isPointerDownAndOver = false;
                maybeUpdateStyle();
            });

            dom.addEventListener("dragstart", () => {
                isPointerDownAndOver = false;
                maybeUpdateStyle();
            });

            addParentScrollWhenPointerDownAndOverListener(dom, () => {
                isPointerDownAndOver = false;
                maybeUpdateStyle();
            });
        }

        dom.addEventListener("contextmenu", event => {
            if (!hasAccessLevel(getAccessLevel(), "Edit")) return;

            // Right-clicking on a mention selects the mention.
            view.dispatch(
                view.state.tr.setSelection(
                    new NodeSelection(view.state.doc.resolve(assertExists(getPos()))),
                ),
            );

            if (!view.hasFocus()) view.focus();

            if (!mentionEntityId) return;
            if (!isFileEntityId(mentionEntityId)) return;

            const schema = view.state.schema;
            if (!schema.nodes.fileRow || !schema.nodes.file) return;

            const entityNoun = getFileEntityNoun(parseFileEntityId(mentionEntityId).type);

            addContextMenuActions(event, [
                [
                    {
                        label: `Copy ${entityNoun} link`,
                        pressErrorTitle: `Couldn\u2019t copy ${entityNoun} link`,
                        icon: <LinkIcon />,
                        iconPlacement: "end",
                        onPress: async () => {
                            let url: URL;
                            if (!mentionEntityId.startsWith("Site:")) {
                                url = new URL(
                                    getDynamicSearchEntityPathForFileEntity({
                                        spaceId,
                                        fileEntityId: mentionEntityId,
                                        fileEntityResult:
                                            references.fileEntityById?.get(mentionEntityId) ?? null,
                                    }),
                                    window.location.href,
                                );
                            } else {
                                // NOTE(ifitzsimmons, 2026-06-17): `getDynamicSearchEntityPathForFileEntity` will
                                // resolve to the path of the site's first entity if it has one. However, when
                                // copying a link to a site mention, it doesn't really make sense to copy the path
                                // to the first entity.
                                //
                                // Think about the following use case:
                                //
                                // 1. User is looking at a site mention. The site has a Test Channel as its first
                                //    entity.
                                // 2. User copies the link to the site mention.
                                // 3. User pastes the link into a chat message.
                                // 4. The chat message is rendered as a link to the Test Channel.
                                //
                                // So by simply copying and pasting the link, we've created a site effect. This
                                // does mean that if a user copies the link and pastes it into the URL bar, they
                                // will be navigated to the site root and redirected to the Test Channel. Those
                                // interactions will be relatively rare, so it's not a big deal.
                                const siteIdObject = parseSearchDynamicEntityId(mentionEntityId);
                                if (siteIdObject.type !== "Site") return;

                                url = new URL(`/site/${siteIdObject.siteId}`, window.location.href);
                            }
                            await writeTextToClipboard(url.toString());
                        },
                    },
                    {
                        label: `Turn into ${entityNoun} preview`,
                        pressErrorTitle: `Couldn\u2019t turn into ${entityNoun} preview`,
                        icon: <ArrowSquareOut />,
                        iconPlacement: "end",
                        onPress: async () => {
                            if (!hasAccessLevel(getAccessLevel(), "Edit")) return;

                            const {fileEntityResult} = await getFileEntityIfPossible(getContext(), {
                                spaceId: getSpaceId(),
                                fileEntityId: mentionEntityId,
                            });

                            // Get the latest position for this mention node. If the doc changed while we were
                            // loading the file entity this will be the mapped position.
                            const pos = getPos();
                            if (pos === undefined) return;

                            const $pos = view.state.doc.resolve(pos);
                            if ($pos.nodeAfter?.type.name !== "mention") return;

                            let isInTableCell = false;

                            for (let depth = $pos.depth; depth > 0; depth--) {
                                const node = $pos.node(depth);
                                if (node.type.name === "tableCell") {
                                    isInTableCell = true;
                                    break;
                                }
                            }

                            const fileRowNode = (
                                isInTableCell ? schema.nodes.fileRowTable! : schema.nodes.fileRow!
                            ).create(null, [schema.nodes.file!.create({fileId: mentionEntityId})]);

                            const transaction = view.state.tr;

                            let from = pos;

                            // Mention is at the start of our textblock.
                            if ($pos.parentOffset === 0) {
                                from -= 1;

                                // If mention is at the start of all parent nodes going up the tree make sure we
                                // include the parent node start in the replace. For example, if our mention is at
                                // the start of an unordered list item in a block quote then we should subtract 2.
                                //
                                // For example, in this state:
                                //
                                // ```
                                // doc(
                                //   quoteBlock(unorderedListItem(paragraph(mention, text("abc")))),
                                // )
                                // ```
                                //
                                // ...we should get this:
                                //
                                // ```
                                // doc(
                                //   fileRow(file),
                                //   quoteBlock(unorderedListItem(paragraph(text("abc")))),
                                // )
                                // ```
                                //
                                // ...not this:
                                //
                                // ```
                                // doc(
                                //   quoteBlock(unorderedListItem(paragraph)),
                                //   fileRow(file),
                                //   quoteBlock(unorderedListItem(paragraph(text("abc")))),
                                // )
                                // ```
                                for (let depth = $pos.depth; depth > 1; depth--) {
                                    if ($pos.index(depth) === 0) {
                                        from -= 1;
                                    } else {
                                        break;
                                    }
                                }
                            }

                            const to = pos + 1;

                            transaction.replaceWith(from, to, fileRowNode);

                            updateContentEditorReferences(transaction, {
                                type: "MergeBase",
                                references: {
                                    ...emptyContentReferences,
                                    fileEntityById: new Map([[mentionEntityId, fileEntityResult]]),
                                },
                            });

                            // Search for the file node we inserted and select it. It's hard to account for
                            // every single edge case so we brute force it. Some example edge cases:
                            //
                            // - Mention is at beginning of paragraph
                            // - Mention is in the middle of a paragraph (so we split the paragraph)
                            // - Mention is at beginning of a paragraph in a block quote
                            // - Mention is in the middle of a paragraph in a block quote
                            //
                            // Now consider all these cases but in a table.
                            for (let checkPos = from; checkPos <= to + $pos.depth; checkPos++) {
                                if (checkPos < 0) continue;
                                if (checkPos > transaction.doc.nodeSize - 2) continue;

                                const $checkPos = transaction.doc.resolve(checkPos);

                                if (
                                    $checkPos.nodeAfter?.type.name === "file" &&
                                    $checkPos.nodeAfter.attrs.fileId === mentionEntityId
                                ) {
                                    transaction.setSelection(new NodeSelection($checkPos));
                                    break;
                                }
                            }

                            view.dispatch(transaction.scrollIntoView());
                        },
                    },
                ],
            ]);
        });

        return {
            dom,
            destroy: unsubscribe,
        };
    };
}
