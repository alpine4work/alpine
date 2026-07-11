import {Children, ReactElement, ReactNode, isValidElement, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {DocumentationSegmentedControl} from "~/client/web/docs/internal/documentation_segmented_control.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {documentationMarkdownChildItems} from "~/client/web/docs/internal/markdown/documentation_markdown_child_items.js";

/**
 * Pill-style tabs for guides. Each child must be a `<Tab title="...">`. In
 * markdown the tabs are stacked one after another.
 *
 * ```mdx
 * <Tabs>
 *     <Tab title="cURL">…</Tab>
 *     <Tab title="Node">…</Tab>
 * </Tabs>
 * ```
 */
export const DocumentationTabs = documentationComponent({
    react: function DocumentationTabsView({children}: {children?: ReactNode}) {
        const tabs = Children.toArray(children).filter(
            (child): child is ReactElement<{title: string; children?: ReactNode}> =>
                isValidElement(child) &&
                typeof child.props === "object" &&
                child.props !== null &&
                "title" in child.props,
        );
        const [selectedIndex, setSelectedIndex] = useState(0);
        const selectedTab = tabs[selectedIndex] ?? tabs[0];

        return (
            <Box display="flex" flexDirection="column" gap="3" marginY="5" alignItems="flex-start">
                <DocumentationSegmentedControl
                    ariaLabel="Tabs"
                    options={tabs.map(tab => tab.props.title)}
                    selectedIndex={selectedIndex}
                    onSelect={setSelectedIndex}
                />
                <Box width="full">{selectedTab?.props.children}</Box>
            </Box>
        );
    },
    markdown: props => `${documentationMarkdownChildItems(props.children).join("\n\n")}\n\n`,
});
