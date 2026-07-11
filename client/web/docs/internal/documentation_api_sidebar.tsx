import {useEffect, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {
    DocumentationApiGroup,
    createDocumentationApiOperationUrl,
    createDocumentationApiSchemaUrl,
    getDocumentationApiSchemaBaseName,
} from "~/client/web/docs/documentation_api_model.js";
import {GeneratedDocumentationApiNav} from "~/client/web/docs/generated_documentation.js";
import {DocumentationChevron} from "~/client/web/docs/internal/documentation_chevron.js";
import {DocumentationMethodPill} from "~/client/web/docs/internal/documentation_method_pill.js";
import {DocumentationNavRow} from "~/client/web/docs/internal/documentation_nav_row.js";
import {DocumentationSectionLabel} from "~/client/web/docs/internal/documentation_section_label.js";
import {DocumentationUnstyledButton} from "~/client/web/docs/internal/documentation_unstyled_button.js";
import {sprinkles} from "~/client/web/styles/styles.js";

export type DocumentationApiSidebarActive =
    | {type: "page"; slug: string}
    | {type: "operation"; slug: string}
    | {type: "schema"; name: string};

/**
 * The API reference sidebar: the "Get started" pages (authored as MDX under
 * `content/api/`), then endpoint groups (collapsible, derived from the
 * specification), then a filterable schema list.
 */
export function DocumentationApiSidebar({
    apiNav,
    active,
}: {
    apiNav: GeneratedDocumentationApiNav;
    active: DocumentationApiSidebarActive;
}) {
    return (
        <Box display="flex" flexDirection="column" gap="6">
            <Box>
                <DocumentationSectionLabel>Get started</DocumentationSectionLabel>
                <Box display="flex" flexDirection="column" gap="0.5">
                    {apiNav.pages.map(page => (
                        <DocumentationNavRow
                            key={page.name}
                            url={page.url}
                            active={active.type === "page" && active.slug === page.name}
                        >
                            {page.title}
                        </DocumentationNavRow>
                    ))}
                </Box>
            </Box>

            <Box>
                <DocumentationSectionLabel>Endpoints</DocumentationSectionLabel>
                <Box display="flex" flexDirection="column" gap="1">
                    {apiNav.groups.map(group => (
                        <DocumentationApiSidebarGroup
                            key={group.name}
                            group={group}
                            active={active}
                        />
                    ))}
                </Box>
            </Box>

            <DocumentationApiSidebarSchemaList schemaNames={apiNav.schemaNames} active={active} />
        </Box>
    );
}

function DocumentationApiSidebarGroup({
    group,
    active,
}: {
    group: DocumentationApiGroup;
    active: DocumentationApiSidebarActive;
}) {
    const activeSlug = active.type === "operation" ? active.slug : null;
    const containsActiveOperation = group.operations.some(
        operation => operation.slug === activeSlug,
    );
    const [open, setOpen] = useState(containsActiveOperation);

    useEffect(() => {
        if (containsActiveOperation) setOpen(true);
    }, [containsActiveOperation]);

    return (
        <Box>
            <DocumentationUnstyledButton
                ariaExpanded={open}
                onClick={() => setOpen(!open)}
                box={{
                    display: "flex",
                    alignItems: "center",
                    gap: "1.5",
                    width: "full",
                    border: "none",
                    backgroundColor: "transparent",
                    cursor: "pointer",
                    paddingX: "2.5",
                    paddingY: "1.5",
                    borderRadius: "2",
                    color: "grey-90",
                    fontSize: "75",
                    fontStyle: "semi-bold",
                    textAlign: "left",
                }}
            >
                <DocumentationChevron open={open} />
                <Box as="span" flex="1" minWidth="flex-fit">
                    {group.title}
                </Box>
                <Box as="span" fontSize="50" fontStyle="normal" color="grey-40">
                    {group.operations.length}
                </Box>
            </DocumentationUnstyledButton>
            {open ? (
                <Box
                    display="flex"
                    flexDirection="column"
                    gap="0.5"
                    marginLeft="2"
                    paddingLeft="1.5"
                    borderLeft="grey-5"
                >
                    {group.operations.map(operation => (
                        <DocumentationNavRow
                            key={operation.slug}
                            url={createDocumentationApiOperationUrl(operation.slug)}
                            active={operation.slug === activeSlug}
                            tooltip={operation.description}
                            badge={
                                <DocumentationMethodPill method={operation.method} size="mini" />
                            }
                        >
                            {operation.title}
                        </DocumentationNavRow>
                    ))}
                </Box>
            ) : null}
        </Box>
    );
}

function DocumentationApiSidebarSchemaList({
    schemaNames,
    active,
}: {
    schemaNames: Array<string>;
    active: DocumentationApiSidebarActive;
}) {
    const activeName = active.type === "schema" ? active.name : null;
    const [filter, setFilter] = useState("");
    const schemaListScrollbarRef = useScrollbar<HTMLElement>();

    const names = schemaNames.filter(
        name => filter.length === 0 || name.toLowerCase().includes(filter.toLowerCase()),
    );

    return (
        <Box>
            <DocumentationSectionLabel>Schemas</DocumentationSectionLabel>
            <Box display="flex" flexDirection="column" gap="1.5">
                <input
                    value={filter}
                    onChange={event => setFilter(event.currentTarget.value)}
                    placeholder="Filter schemas…"
                    aria-label="Filter schemas"
                    className={sprinkles({
                        width: "full",
                        paddingX: "2",
                        paddingY: "1.5",
                        fontSize: "75",
                        fontStyle: "normal",
                        borderRadius: "1.5",
                        border: "grey-10",
                        backgroundColor: "grey-1",
                        color: "grey-90",
                    })}
                    style={{boxSizing: "border-box", margin: 0}}
                />
                <Box
                    ref={schemaListScrollbarRef}
                    position="relative"
                    display="flex"
                    flexDirection="column"
                    overflowY="auto"
                    style={{maxHeight: 420}}
                >
                    {names.map(name => (
                        <DocumentationNavRow
                            key={name}
                            url={createDocumentationApiSchemaUrl(name)}
                            active={name === activeName}
                        >
                            {getDocumentationApiSchemaBaseName(name)}
                        </DocumentationNavRow>
                    ))}
                </Box>
            </Box>
        </Box>
    );
}
