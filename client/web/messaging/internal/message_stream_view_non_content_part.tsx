import {useMemo, useRef} from "react";
import {AccountRegistry} from "~/client/web/accounts/account_registry.js";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {addContentViewLinkBehavior} from "~/client/web/content/add_content_view_link_behavior.js";
import {FileRegistry} from "~/client/web/content/file_registry.js";
import {useFileRegistry} from "~/client/web/content/file_registry_context.js";
import {printContentSingleLineTextSnippetForClient} from "~/client/web/content/print_content_single_line_text_snippet_for_client.js";
import {renderContentMentionToHtml} from "~/client/web/content/render_content_mention_to_html.js";
import {HtmlGeneratorView} from "~/client/web/helpers/html_generator_view.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {SearchEntityRegistry} from "~/client/web/search/core/search_entity_registry.js";
import {useSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {parseApiMentionPath} from "~/shared/api/parse_api_path.js";
import {ApiMentionPath} from "~/shared/api/types/api_specification_convenience_types.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {MessageStreamPartPayload} from "~/shared/messaging/message_schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {Store} from "~/shared/store/store.js";

// NOTE(calebmer): You are not allowed to use the `<Box>` component in this
// file. It is critical for scroll performance that this component renders
// fast. Manually use the `sprinkles()` function instead. This reduces the
// number of fibers React needs to render. One day we'd like to introduce
// transformations that automatically inline `<Box>` components and
// `sprinkles()` functions at which point using `<Box>` would not make a
// performance difference.
//
// Assign a variable to null so you get a TypeScript error if you try to
// use `<Box>`.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Box = null;

function renderMessageStreamNonContentPart(
    get: <Value>(store: Store<Value>) => Value,
    references: ContentReferences,
    part: Exclude<MessageStreamPartPayload, {type: "Content"}>,
    {
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
        spacingScale,
        routeLayout,
        spaceId,
        currentAccount,
    }: {
        accountRegistry: AccountRegistry;
        searchEntityRegistry: SearchEntityRegistry;
        fileRegistry: FileRegistry;
        spacingScale: SpacingScale;
        routeLayout: RouteLayout;
        spaceId: SpaceId | null;
        currentAccount: AccountModel | null;
    },
): HtmlElementGenerator {
    switch (part.type) {
        case "Reasoning": {
            // Get only the first line of the reasoning content. 0 gets no lines after the
            // start so only the single line of text at the start.
            const contentSnippet = getContentSnippet(part.content.resolve(0), 0);

            const contentSnippetText = printContentSingleLineTextSnippetForClient(
                get,
                {doc: contentSnippet, references},
                {accountRegistry, searchEntityRegistry, fileRegistry},
            );

            const html = new HtmlElementGenerator("span");
            html.appendChild(new HtmlTextGenerator(contentSnippetText));
            return html;
        }
        case "ToolCall": {
            switch (part.call.type) {
                case "Read": {
                    const html = new HtmlElementGenerator("span");

                    html.appendChild(new HtmlTextGenerator("Reading "));

                    html.appendChild(
                        renderContentMentionToHtml(get, {
                            accountRegistry,
                            searchEntityRegistry,
                            spacingScale,
                            routeLayout,
                            spaceId,
                            currentAccount,
                            references,
                            mention: getApiMentionPathContentMention(part.call.targetPath),
                            isInert: false,
                        }),
                    );

                    return html;
                }
                case "Search": {
                    const html = new HtmlElementGenerator("span");
                    html.appendChild(new HtmlTextGenerator(`Searching “${part.call.query}”`));
                    return html;
                }
                default:
                    throw exhaustive(part.call);
            }
        }
        default: {
            throw exhaustive(part);
        }
    }
}

function getApiMentionPathContentMention(targetPath: ApiMentionPath): ContentMention {
    const targetPathObject = parseApiMentionPath(targetPath);

    switch (targetPathObject.type) {
        case "Account": {
            return {
                type: "Account",
                accountId: targetPathObject.id,
                isShort: false,
            };
        }
        case "Channel": {
            return {
                type: "SearchEntity",
                entityId: `Channel:${targetPathObject.id}`,
            };
        }
        case "Document": {
            return {
                type: "SearchEntity",
                entityId: `Document:${targetPathObject.id}`,
            };
        }
        case "Post": {
            return {
                type: "SearchEntity",
                entityId: `Post:${targetPathObject.id}`,
            };
        }
        case "Task": {
            return {
                type: "SearchEntity",
                entityId: `Task:${targetPathObject.id}`,
            };
        }
        case "TaskCollection": {
            return {
                type: "SearchEntity",
                entityId: `TaskCollection:${targetPathObject.id}`,
            };
        }
        default:
            throw exhaustive(targetPathObject);
    }
}

export function MessageStreamViewNonContentPart({
    references,
    part,
}: {
    references: ContentReferences;
    part: Exclude<MessageStreamPartPayload, {type: "Content"}>;
}) {
    const accountRegistry = useAccountRegistry();
    const searchEntityRegistry = useSearchEntityRegistry();
    const fileRegistry = useFileRegistry();
    const spacingScale = useSpacingScale();
    const routeLayout = useRouteLayout();
    const {space, currentAccount} = useSpaceContext();
    const navigate = useNavigate();

    const containerRef = useRef<HTMLElement>(null);

    const htmlGenerator = useStore(
        useMemo(
            () =>
                computeStore(get =>
                    renderMessageStreamNonContentPart(get, references, part, {
                        accountRegistry,
                        searchEntityRegistry,
                        fileRegistry,
                        spacingScale,
                        routeLayout,
                        spaceId: space.id,
                        currentAccount,
                    }),
                ),
            [
                accountRegistry,
                currentAccount,
                fileRegistry,
                part,
                references,
                routeLayout,
                searchEntityRegistry,
                space.id,
                spacingScale,
            ],
        ),
    );

    useLayoutEffectWithoutServerSideWarning(() => {
        // Run this effect whenever `htmlGenerator` changes since we may have new
        // mentions we need to attach behavior to.
        //
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        htmlGenerator;

        const containerElement = assertExists(containerRef.current);

        const cleanupFunctions: Array<() => void> = [];

        for (const element of containerElement.querySelectorAll(
            `.${contentStyles.mentionContainerClassName}`,
        )) {
            if (!(element instanceof HTMLElement)) continue;

            if (
                element.classList.contains(contentStyles.mentionContainerClassName) &&
                element instanceof HTMLAnchorElement
            ) {
                cleanupFunctions.push(addContentViewLinkBehavior(element, navigate));
            }
        }

        return () => {
            for (const cleanup of cleanupFunctions) {
                cleanup();
            }
        };
    }, [htmlGenerator, navigate]);

    return (
        <HtmlGeneratorView
            ref={containerRef}
            // Must be an inline element `<span>` instead of a `<div>` so text truncation
            // works properly.
            as="span"
            htmlGenerator={htmlGenerator}
        />
    );
}
