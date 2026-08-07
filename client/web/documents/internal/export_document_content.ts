import {highlightCode} from "@lezer/highlight";
import {parser as lezerHtmlParser} from "@lezer/html";
import {parser as lezerMarkdownParser} from "@lezer/markdown";
import escapeHtml from "escape-html";
import {Heading, Parent} from "mdast";
import {micromark} from "micromark";
import {frontmatter, frontmatterHtml} from "micromark-extension-frontmatter";
import {gfmStrikethrough, gfmStrikethroughHtml} from "micromark-extension-gfm-strikethrough";
import {gfmTable, gfmTableHtml} from "micromark-extension-gfm-table";
import {gfmTaskListItem, gfmTaskListItemHtml} from "micromark-extension-gfm-task-list-item";
import {math, mathHtml} from "micromark-extension-math";
import * as prettier from "prettier";
import * as htmlPrettierPlugin from "prettier/plugins/html";
import * as markdownPrettierPlugin from "prettier/plugins/markdown";
import {getAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {getFileRegistry} from "~/client/web/content/file_registry_context.js";
import {DocumentContentExportFormat} from "~/client/web/documents/internal/document_content_export_modal.js";
import {getSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {intoApiContent} from "~/shared/api/content/closed_source/into_api_content.js";
import {prepareApiMentionTitle} from "~/shared/api/content/closed_source/prepare_api_mention_title.js";
import {
    printApiContentToMarkdownTree,
    printMarkdownTree,
} from "~/shared/api/content/print_api_content_to_markdown.open_source.js";
import {visitAndProduceApiContent} from "~/shared/api/content/visit_and_produce_api_content.open_source.js";
import {DocumentContentWithReferences} from "~/shared/documents/document_content_references.js";
import {getDocumentContentTitle} from "~/shared/documents/document_model.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {lezerClassHighlighter} from "~/shared/lezer/lezer_class_highlighter.open_source.js";
import {getSearchEntityNoun} from "~/shared/search/get_search_entity_noun.js";
import {
    missingSearchEntityTitle,
    privateSearchEntityTitle,
} from "~/shared/search/missing_and_private_search_entity_titles.js";
import {parseSearchMentionEntityId} from "~/shared/search/search_entity_id.js";

export async function exportDocumentContent({
    spaceId,
    format,
    content,
}: {
    spaceId: SpaceId;
    format: DocumentContentExportFormat;
    content: DocumentContentWithReferences;
}): Promise<{
    string: string;
    html: string;
}> {
    let apiContent = intoApiContent(content.doc, {
        getAccountIfExists: accountId => {
            const account = content.references.accountById.get(accountId);
            if (!account) return;
            return getAccountRegistry(spaceId).getAccountStore(account).getSnapshot();
        },
        getSearchEntityMentionTitleIfExists: entityId => {
            const entityResult = content.references.searchEntityById.get(entityId);

            if (!entityResult) {
                const {type} = parseSearchMentionEntityId(entityId);
                return `${missingSearchEntityTitle} ${getSearchEntityNoun(type)}`;
            }

            if (entityResult.isPrivate) {
                const {type} = parseSearchMentionEntityId(entityId);
                return `${privateSearchEntityTitle} ${getSearchEntityNoun(type)}`;
            }

            const entityData = getSearchEntityRegistry(spaceId)
                .getEntityStore(entityResult.entity)
                .getSnapshot();

            return prepareApiMentionTitle(entityId, entityData, account =>
                getAccountRegistry(spaceId).getAccountStore(account).getSnapshot(),
            );
        },
        getSearchTaskEntityDisplayStatusIfExists: taskId => {
            const entity = content.references.searchEntityById.get(`Task:${taskId}`);
            if (!entity || entity.isPrivate) return;

            const entityData = getSearchEntityRegistry(spaceId)
                .getEntityStore(entity.entity)
                .getSnapshot();

            if (entityData.type !== "Task") return;
            return entityData.task.displayStatus.value;
        },
        getFileIfExists: fileId => {
            const fileReference = content.references.fileById?.get(fileId);
            if (!fileReference) return undefined;
            return getFileRegistry(spaceId).getFileStore(fileReference).getSnapshot();
        },
    });

    apiContent = visitAndProduceApiContent(apiContent, {
        visitBlockElement: element => {
            // Remove table and column widths from the content. Our table/column width
            // Markdown/HTML syntax is non-standard. Better to not include it in the export so
            // the user gets a clean export.
            if (
                element.type === "Table" &&
                (element.width !== 1 || element.columns.some(column => column.width !== 1))
            ) {
                element.width = 1;
                element.columns = element.columns.map(column => ({...column, width: 1}));
            }
        },
        visitInlineElement: element => {
            // Remove all comment marks from the content before converting to Markdown.
            if (element.marks?.find(mark => mark.type === "Comment")) {
                element.marks = element.marks.filter(mark => mark.type !== "Comment");
            }
        },
    });

    const markdownTree = printApiContentToMarkdownTree(apiContent);

    const traverse = (node: Parent) => {
        // Headings from `ApiContent` should always start at level 2. That way we can add
        // level 1 headings elsewhere in the agent context (e.g. document titles) without
        // fear of conflict.
        if (node.type === "heading") {
            (node as Heading).depth += 1;
        }

        for (let index = 0; index < node.children.length; index++) {
            const childNode = node.children[index]!;

            if ("children" in childNode) {
                traverse(childNode);
            }
        }
    };

    traverse(markdownTree);

    markdownTree.children.unshift({
        type: "heading",
        depth: 1,
        children: [{type: "text", value: getDocumentContentTitle(content.doc)}],
    });

    let string = printMarkdownTree(markdownTree);

    if (format === "HTML") {
        string = micromark(string, "utf-8", {
            // Allow raw HTML blocks (e.g. file gallery `<div>`, `<video>`, `<audio>`,
            // `<object>` tags) to pass through to the HTML output instead of being escaped.
            allowDangerousHtml: true,
            extensions: [
                gfmStrikethrough({singleTilde: false}),
                gfmTable(),
                gfmTaskListItem(),
                math(),
                // NOTE(calebmer, 2025-09-02): We don't currently support frontmatter in our
                // Markdown but we want to reserve the syntax so we have the ability to use
                // frontmatter in the future.
                frontmatter("yaml"),
            ],
            htmlExtensions: [
                gfmStrikethroughHtml(),
                gfmTableHtml(),
                gfmTaskListItemHtml(),
                mathHtml(),
                // NOTE(calebmer, 2025-09-02): We don't currently support frontmatter in our
                // Markdown but we want to reserve the syntax so we have the ability to use
                // frontmatter in the future.
                frontmatterHtml("yaml"),
            ],
        });
    }

    // Pretty print our exported Markdown or HTML.
    string = await prettier.format(string, {
        parser: format === "HTML" ? "html" : "markdown",
        printWidth: 80,
        tabWidth: 2,
        proseWrap: "always",
        // While technically this changes the HTML semantics, it gives us a much nicer
        // output.
        htmlWhitespaceSensitivity: "ignore",
        plugins: [htmlPrettierPlugin, markdownPrettierPlugin],
    });

    string = string.trim();

    let html = "";

    // Highlight our exported Markdown or HTML.
    highlightCode(
        string,
        (format === "HTML" ? lezerHtmlParser : lezerMarkdownParser).parse(string),
        lezerClassHighlighter.get(),
        (text: string, classes: string) => {
            if (classes.length === 0) {
                html += escapeHtml(text);
            } else {
                html += `<span class="${classes}">${escapeHtml(text)}</span>`;
            }
        },
        () => {
            html += "\n";
        },
    );

    return {string, html};
}
