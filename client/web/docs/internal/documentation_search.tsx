import {useNavigate} from "@remix-run/react";
import {MagnifyingGlass} from "phosphor-react";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {Modal} from "~/client/web/design/modal.js";
import {DocumentationSectionLabel} from "~/client/web/docs/internal/documentation_section_label.js";
import {DocumentationUnstyledButton} from "~/client/web/docs/internal/documentation_unstyled_button.js";
import {
    DocumentationSearchIndex,
    DocumentationSearchResult,
    searchDocumentationEntries,
} from "~/client/web/docs/search_documentation_entries.js";
import {sprinkles} from "~/client/web/styles/styles.js";

/**
 * The docs search: a header button that opens a keyboard-driven quick switcher
 * (also on ⌘K / Ctrl+K).
 */
export function DocumentationSearch({searchIndex}: {searchIndex: DocumentationSearchIndex}) {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        /**
         * Open docs search from the global keyboard shortcut.
         */
        function onKeyDown(event: KeyboardEvent) {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                setOpen(true);
            }
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    return (
        <>
            <DocumentationSearchTrigger onOpen={() => setOpen(true)} />
            {open ? (
                <DocumentationSearchDialog
                    searchIndex={searchIndex}
                    onClose={() => setOpen(false)}
                />
            ) : null}
        </>
    );
}

/**
 * Render the compact header control that opens docs search.
 */
function DocumentationSearchTrigger({onOpen}: {onOpen: () => void}) {
    return (
        <DocumentationUnstyledButton
            ariaLabel="Search the docs"
            className="documentationSearchStub"
            onClick={onOpen}
            box={{
                alignItems: "center",
                gap: "2",
                backgroundColor: "grey-1",
                border: "grey-5",
                borderRadius: "2",
                paddingX: "2.5",
                paddingY: "1.5",
                color: "grey-40",
                cursor: "text",
            }}
            style={{minWidth: 190}}
        >
            <MagnifyingGlass size={15} />
            <Box as="span" fontSize="75" flex="1" textAlign="left">
                Search
            </Box>
            <Box
                as="kbd"
                fontSize="25"
                fontStyle="code"
                border="grey-10"
                borderRadius="1"
                paddingX="1"
                backgroundColor="grey-0"
                color="grey-40"
            >
                ⌘K
            </Box>
        </DocumentationUnstyledButton>
    );
}

function DocumentationSearchDialog({
    searchIndex,
    onClose,
}: {
    searchIndex: DocumentationSearchIndex;
    onClose: () => void;
}) {
    const navigate = useNavigate();
    const [query, setQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const resultsRef = useRef<HTMLDivElement>(null);
    const results = useMemo(
        () => searchDocumentationEntries(searchIndex, query, {limit: 20}),
        [searchIndex, query],
    );

    // Focus the input on open; reset the highlighted row whenever the query changes.
    useEffect(() => inputRef.current?.focus(), []);
    useEffect(() => setSelectedIndex(0), [query]);

    const activeIndex = Math.min(selectedIndex, Math.max(0, results.length - 1));

    // Keep the highlighted row scrolled into view as the selection moves.
    useEffect(() => {
        resultsRef.current
            ?.querySelector('[data-active="true"]')
            ?.scrollIntoView({block: "nearest"});
    }, [activeIndex]);

    const select = useCallback(
        (result: DocumentationSearchResult) => {
            onClose();
            navigate(result.entry.url);
        },
        [navigate, onClose],
    );

    /**
     * Move the active result or open it from the search input keyboard controls.
     */
    function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                setSelectedIndex(index => Math.min(index + 1, results.length - 1));
                break;
            case "ArrowUp":
                event.preventDefault();
                setSelectedIndex(index => Math.max(index - 1, 0));
                break;
            case "Enter": {
                event.preventDefault();
                const result = results[activeIndex];
                if (result !== undefined) select(result);
                break;
            }
            // The `<Modal>` handles Escape (and clicking the underlay) to close.
            default:
                break;
        }
    }

    return (
        <Modal
            aria-label="Search the docs"
            onClose={onClose}
            maxWidth="160"
            // A fixed height keeps the input pinned in place: the box no longer grows and
            // shrinks with the result count, so it never re-centers as you type.
            height="full"
            maxHeight="128"
            withoutCloseButton
            withoutOpenAnimation
            withoutCloseAnimation
        >
            <Box display="flex" flexDirection="column" width="full" height="full">
                <Box
                    display="flex"
                    alignItems="center"
                    gap="2.5"
                    paddingX="4"
                    borderBottom="grey-5"
                    color="grey-40"
                    flexShrink="0"
                    style={{height: 56}}
                >
                    <MagnifyingGlass size={18} />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={event => setQuery(event.currentTarget.value)}
                        onKeyDown={onInputKeyDown}
                        placeholder="Search the docs…"
                        aria-label="Search the docs"
                        role="combobox"
                        aria-expanded={true}
                        aria-controls="docs-search-results"
                        autoComplete="off"
                        className={sprinkles({
                            flex: "1",
                            fontSize: "200",
                            fontStyle: "normal",
                            color: "grey-90",
                            border: "none",
                            backgroundColor: "transparent",
                        })}
                        style={{outline: "none", minWidth: 0}}
                    />
                </Box>

                <Box
                    ref={resultsRef}
                    // The results list scrolls; use the native scrollbar since our overlay scrollbar
                    // can't attach inside a portalled modal cleanly.
                    data-scrollbar="false"
                    id="docs-search-results"
                    role="listbox"
                    flex="1"
                    overflowY="auto"
                    padding="1.5"
                    style={{minHeight: 0}}
                >
                    {results.length === 0 ? (
                        <Box
                            paddingX="4"
                            paddingY="6"
                            fontSize="100"
                            color="grey-40"
                            textAlign="center"
                        >
                            {query.trim().length === 0
                                ? "Start typing to search the docs."
                                : `No results for \u201C${query.trim()}\u201D.`}
                        </Box>
                    ) : (
                        <DocumentationSearchResultSections
                            results={results}
                            activeIndex={activeIndex}
                            onHover={setSelectedIndex}
                            onSelect={select}
                        />
                    )}
                </Box>
            </Box>
        </Modal>
    );
}

/**
 * Group the ordered results under "Guides", "Blog", and "API Reference" headings.
 * Rows keep their flat index into `results` so the shared keyboard selection still
 * works across sections.
 */
function DocumentationSearchResultSections({
    results,
    activeIndex,
    onHover,
    onSelect,
}: {
    results: Array<DocumentationSearchResult>;
    activeIndex: number;
    onHover: (index: number) => void;
    onSelect: (result: DocumentationSearchResult) => void;
}) {
    const pageResults = results.filter(result => result.entry.type === "page");
    const blogResults = results.filter(result => result.entry.type === "blog");
    const apiResults = results.filter(result => result.entry.type === "api");
    const blogIndexOffset = pageResults.length;
    const apiIndexOffset = blogIndexOffset + blogResults.length;

    return (
        <>
            {pageResults.length > 0 ? (
                <DocumentationSearchResultSection
                    title="Guides"
                    results={pageResults}
                    indexOffset={0}
                    activeIndex={activeIndex}
                    onHover={onHover}
                    onSelect={onSelect}
                />
            ) : null}
            {blogResults.length > 0 ? (
                <DocumentationSearchResultSection
                    title="Blog"
                    results={blogResults}
                    indexOffset={blogIndexOffset}
                    activeIndex={activeIndex}
                    onHover={onHover}
                    onSelect={onSelect}
                />
            ) : null}
            {apiResults.length > 0 ? (
                <DocumentationSearchResultSection
                    title="API Reference"
                    results={apiResults}
                    indexOffset={apiIndexOffset}
                    activeIndex={activeIndex}
                    onHover={onHover}
                    onSelect={onSelect}
                />
            ) : null}
        </>
    );
}

/**
 * Render one labeled group of docs search results.
 */
function DocumentationSearchResultSection({
    title,
    results,
    indexOffset,
    activeIndex,
    onHover,
    onSelect,
}: {
    title: string;
    results: Array<DocumentationSearchResult>;
    indexOffset: number;
    activeIndex: number;
    onHover: (index: number) => void;
    onSelect: (result: DocumentationSearchResult) => void;
}) {
    return (
        <Box marginBottom="1" paddingTop="2">
            <DocumentationSectionLabel>{title}</DocumentationSectionLabel>
            {results.map((result, offset) => {
                const index = indexOffset + offset;
                return (
                    <DocumentationSearchResultRow
                        key={`${result.entry.type}:${result.entry.url}`}
                        result={result}
                        active={index === activeIndex}
                        onHover={() => onHover(index)}
                        onSelect={() => onSelect(result)}
                    />
                );
            })}
        </Box>
    );
}

/**
 * Render one selectable docs search result row.
 */
function DocumentationSearchResultRow({
    result,
    active,
    onHover,
    onSelect,
}: {
    result: DocumentationSearchResult;
    active: boolean;
    onHover: () => void;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            role="option"
            aria-selected={active}
            data-active={active}
            onMouseMove={onHover}
            onClick={onSelect}
            className={sprinkles({
                display: "flex",
                alignItems: "center",
                gap: "3",
                width: "full",
                paddingX: "2.5",
                paddingY: "1.5",
                borderRadius: "2",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                backgroundColor: active ? "grey-5" : "transparent",
            })}
        >
            <Box display="flex" flexDirection="column" gap="0.5" flex="1" style={{minWidth: 0}}>
                <Box
                    as="span"
                    fontSize="100"
                    fontStyle="semi-bold"
                    color="grey-90"
                    display="block"
                    style={{overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}
                >
                    {result.entry.title}
                </Box>
                {result.entry.description !== undefined ? (
                    <Box
                        as="span"
                        fontSize="75"
                        color="grey-50"
                        display="block"
                        style={{overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}
                    >
                        {result.entry.description}
                    </Box>
                ) : null}
            </Box>
        </button>
    );
}
