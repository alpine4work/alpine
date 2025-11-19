import {NodeSelection} from "prosemirror-state";
import {NodeViewConstructor} from "prosemirror-view";
import {To} from "react-router";
import {getAccountRegistry} from "~/client/accounts/account_registry_context.js";
import {handleContentLinkClick} from "~/client/content/internal/handle_content_link_click.js";
import {renderContentMentionToHtml} from "~/client/content/internal/render_content_mention_to_html.js";
import {getContentEditorReferences} from "~/client/content/state/content_editor_state.js";
import {addParentScrollWhenPointerDownAndOverListener} from "~/client/content/state/parent_scroll_when_pointer_down_and_over_event.js";
import {isModifiedPointerEvent} from "~/client/helpers/events/is_modified_pointer_event.js";
import {isOpenLinkInSeparateTabPointerEvent} from "~/client/helpers/events/is_open_link_in_separate_tab_pointer_event.js";
import {getClientInfo} from "~/client/remix/client_info_context.js";
import {getSpacingScaleWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {getSearchEntityRegistry} from "~/client/search/core/search_entity_registry_context.js";
import {contentStyles} from "~/client/styles/styles.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {computeStore} from "~/shared/store/compute_store.js";

export function createContentEditorMentionNodeViewConstructor({
    getRouteLayout,
    getSpaceId,
    getCurrentAccountIfExists,
    onNavigate,
}: {
    getRouteLayout: () => RouteLayout;
    getSpaceId: () => SpaceId;
    getCurrentAccountIfExists: () => AccountModel | null;
    onNavigate: (to: To) => Promise<void>;
}): NodeViewConstructor {
    return (node, view, getPos) => {
        const mention: ContentMention = node.attrs.mention;

        const routeLayout = getRouteLayout();
        const spaceId = getSpaceId();
        const currentAccount = getCurrentAccountIfExists();
        const accountRegistry = getAccountRegistry(spaceId);
        const searchEntityRegistry = getSearchEntityRegistry(spaceId);
        const {references} = getContentEditorReferences(view.state);
        const spacingScale = getSpacingScaleWithoutListening();

        // When rendering account mentions, only allow them to be clicked
        // if we're currently logged in.
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

        // Whenever the content mention text changes, we want to update our mention
        // node with the right value.
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

        return {
            dom,
            destroy: unsubscribe,
        };
    };
}
