import {DocumentationApiModel} from "~/client/web/docs/documentation_api_model.js";
import {createDocumentationApiBaseUrlComponent} from "~/client/web/docs/internal/documentation_api_base_url.js";
import {DocumentationApiExampleId} from "~/client/web/docs/internal/documentation_api_example_id.js";
import {createDocumentationApiSchemaComponent} from "~/client/web/docs/internal/documentation_api_schema.js";
import {createDocumentationApiStatsComponent} from "~/client/web/docs/internal/documentation_api_stats.js";
import {
    DocumentationApiTypeLink,
    documentationApiTypeLinkToMarkdown,
} from "~/client/web/docs/internal/documentation_api_type_link.js";
import {DocumentationBlockquote} from "~/client/web/docs/internal/markdown/components/documentation_blockquote.js";
import {DocumentationBold} from "~/client/web/docs/internal/markdown/components/documentation_bold.js";
import {DocumentationCallout} from "~/client/web/docs/internal/markdown/components/documentation_callout.js";
import {DocumentationCard} from "~/client/web/docs/internal/markdown/components/documentation_card.js";
import {DocumentationCardGrid} from "~/client/web/docs/internal/markdown/components/documentation_card_grid.js";
import {DocumentationCheckbox} from "~/client/web/docs/internal/markdown/components/documentation_checkbox.js";
import {DocumentationCodeFence} from "~/client/web/docs/internal/markdown/components/documentation_code_fence.js";
import {DocumentationDivider} from "~/client/web/docs/internal/markdown/components/documentation_divider.js";
import {DocumentationFrame} from "~/client/web/docs/internal/markdown/components/documentation_frame.js";
import {DocumentationHeader1} from "~/client/web/docs/internal/markdown/components/documentation_header1.js";
import {DocumentationHeader2} from "~/client/web/docs/internal/markdown/components/documentation_header2.js";
import {DocumentationHeader3} from "~/client/web/docs/internal/markdown/components/documentation_header3.js";
import {DocumentationImage} from "~/client/web/docs/internal/markdown/components/documentation_image.js";
import {DocumentationInlineCode} from "~/client/web/docs/internal/markdown/components/documentation_inline_code.js";
import {DocumentationItalic} from "~/client/web/docs/internal/markdown/components/documentation_italic.js";
import {DocumentationKbd} from "~/client/web/docs/internal/markdown/components/documentation_kbd.js";
import {DocumentationLineBreak} from "~/client/web/docs/internal/markdown/components/documentation_line_break.js";
import {DocumentationListItem} from "~/client/web/docs/internal/markdown/components/documentation_list_item.js";
import {DocumentationOrderedList} from "~/client/web/docs/internal/markdown/components/documentation_ordered_list.js";
import {DocumentationParagraph} from "~/client/web/docs/internal/markdown/components/documentation_paragraph.js";
import {DocumentationProseLink} from "~/client/web/docs/internal/markdown/components/documentation_prose_link.js";
import {DocumentationStep} from "~/client/web/docs/internal/markdown/components/documentation_step.js";
import {DocumentationSteps} from "~/client/web/docs/internal/markdown/components/documentation_steps.js";
import {DocumentationStrikethrough} from "~/client/web/docs/internal/markdown/components/documentation_strikethrough.js";
import {DocumentationTab} from "~/client/web/docs/internal/markdown/components/documentation_tab.js";
import {DocumentationTable} from "~/client/web/docs/internal/markdown/components/documentation_table.js";
import {DocumentationTableBody} from "~/client/web/docs/internal/markdown/components/documentation_table_body.js";
import {DocumentationTableCell} from "~/client/web/docs/internal/markdown/components/documentation_table_cell.js";
import {DocumentationTableHead} from "~/client/web/docs/internal/markdown/components/documentation_table_head.js";
import {DocumentationTableHeaderCell} from "~/client/web/docs/internal/markdown/components/documentation_table_header_cell.js";
import {DocumentationTableRow} from "~/client/web/docs/internal/markdown/components/documentation_table_row.js";
import {DocumentationTabs} from "~/client/web/docs/internal/markdown/components/documentation_tabs.js";
import {DocumentationUnorderedList} from "~/client/web/docs/internal/markdown/components/documentation_unordered_list.js";
import {DocumentationYoutubeEmbed} from "~/client/web/docs/internal/markdown/components/documentation_youtube_embed.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {DocumentationMarkdownComponent} from "~/client/web/docs/internal/markdown/documentation_markdown_component.js";

type DocumentationMdxComponent = ((props: any) => unknown) & {
    markdown: DocumentationMarkdownComponent;
};

/**
 * The component mapping for documentation MDX: HTML element names and custom MDX
 * tags to their documentation components. Guide and API-authored MDX share this
 * one map; API pages render under `DocumentationApiModelProvider`, so API-aware
 * components can read the parsed spec from context when they appear.
 */
export const documentationMdxComponents = createDocumentationMdxComponents(null);

export function createDocumentationMdxComponents(model: DocumentationApiModel | null) {
    return {
        h1: DocumentationHeader1,
        h2: DocumentationHeader2,
        h3: DocumentationHeader3,
        p: DocumentationParagraph,
        a: DocumentationProseLink,
        strong: DocumentationBold,
        em: DocumentationItalic,
        del: DocumentationStrikethrough,
        code: DocumentationInlineCode,
        pre: DocumentationCodeFence,
        br: DocumentationLineBreak,
        hr: DocumentationDivider,
        img: DocumentationImage,
        input: DocumentationCheckbox,
        ul: DocumentationUnorderedList,
        ol: DocumentationOrderedList,
        li: DocumentationListItem,
        blockquote: DocumentationBlockquote,
        table: DocumentationTable,
        thead: DocumentationTableHead,
        tbody: DocumentationTableBody,
        tr: DocumentationTableRow,
        th: DocumentationTableHeaderCell,
        td: DocumentationTableCell,

        Callout: DocumentationCallout,
        Steps: DocumentationSteps,
        Step: DocumentationStep,
        Tabs: DocumentationTabs,
        Tab: DocumentationTab,
        Frame: DocumentationFrame,
        CardGrid: DocumentationCardGrid,
        Card: DocumentationCard,
        Kbd: DocumentationKbd,
        YouTubeEmbed: DocumentationYoutubeEmbed,
        TypeLink: documentationComponent({
            react: DocumentationApiTypeLink,
            markdown: documentationApiTypeLinkToMarkdown,
        }),

        Schema: createDocumentationApiSchemaComponent(model),
        ApiStats: createDocumentationApiStatsComponent(model),
        BaseUrl: createDocumentationApiBaseUrlComponent(model),
        ExampleId: DocumentationApiExampleId,
    } satisfies Record<string, DocumentationMdxComponent>;
}

export type DocumentationMdxMarkdownComponentName = keyof typeof documentationMdxComponents;

/**
 * The markdown variant of every component in {@link documentationMdxComponents}.
 * API pages bind their parsed API model into these same `.markdown` renderers with
 * {@link createDocumentationMdxMarkdownComponents}.
 */
export const documentationMdxMarkdownComponents = Object.fromEntries(
    Object.entries(documentationMdxComponents).map(([name, component]) => [
        name,
        component.markdown,
    ]),
) as Record<DocumentationMdxMarkdownComponentName, DocumentationMarkdownComponent>;

export function createDocumentationMdxMarkdownComponents(
    model: DocumentationApiModel | null,
): Record<DocumentationMdxMarkdownComponentName, DocumentationMarkdownComponent> {
    const components = createDocumentationMdxComponents(model);
    return Object.fromEntries(
        Object.entries(components).map(([name, component]) => [name, component.markdown]),
    ) as Record<DocumentationMdxMarkdownComponentName, DocumentationMarkdownComponent>;
}
