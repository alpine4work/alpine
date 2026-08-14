import {IGif} from "@giphy/js-types";
import {MagnifyingGlass, SpinnerGap} from "phosphor-react";
import {
    ReactElement,
    KeyboardEvent as ReactKeyboardEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    GifPickerRowLayoutItem,
    computeGifPickerRowLayout,
} from "~/client/web/content/internal/compute_gif_picker_row_layout.js";
import {
    GiphyPageResult,
    createGiphyFetcher,
    giphyFetchPage,
    giphySwrKey,
} from "~/client/web/content/internal/giphy_fetch.js";
import {preloadGifThumbnails} from "~/client/web/content/internal/preload_gif_thumbnails.js";
import {useAppContextIfExists} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {ErrorInlineAlert} from "~/client/web/design/error_inline_alert.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {TextInputWithoutLabel} from "~/client/web/design/text_input.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useResizeObserver} from "~/client/web/helpers/use_resize_observer.js";
import {GiphyWordmark} from "~/client/web/icons/socials/giphy_wordmark.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useSwr} from "~/client/web/rpc/use_swr.js";
import {colorSchemeVars, spinAnimationClassName} from "~/client/web/styles/styles.js";
import {Platform} from "~/shared/design/core/platform.js";
import {Spacing, convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

/**
 * The debounce timeout before we'll send a new search request.
 *
 * TODO(#giphy-paid-api-key): when we have a paid API key we should use a shorter
 * debounce in production.
 */
const searchDebounceMs = 1000;

const gutterRemLength: Spacing = "2.5";

function GifPickerLoader(): ReactElement {
    return (
        <Box display="flex" justifyContent="center" paddingY="4">
            <SpinnerGap
                className={spinAnimationClassName}
                size={24}
                color={colorSchemeVars["grey-40"]}
            />
        </Box>
    );
}

/**
 * GIF picker panel with search, row-based justified layout, keyboard navigation,
 * and Giphy attribution.
 */
export function ContentEditorGifPicker({
    onSelectGif,
    onClose,
    platform,
}: {
    onSelectGif: (url: URL) => void;
    onClose: () => void;
    platform: Platform;
}): ReactElement {
    const [searchTerm, setSearchTerm] = useState("");
    const [debouncedTerm, setDebouncedTerm] = useState("");
    const [subsequentGifs, setSubsequentGifs] = useState<ReadonlyArray<IGif>>([]);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [isDone, setIsDone] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const reporter = useReporter();
    const context = useAppContextIfExists();
    const inputRef = useRef<HTMLInputElement>(null);
    const gridContainerRef = useRef<HTMLDivElement>(null);
    const [resizeObserverRef, gridSize] = useResizeObserver();
    const gifElementsRef = useRef<Map<number, HTMLElement>>(new Map());
    const sentinelRef = useRef<HTMLDivElement>(null);
    const offsetRef = useRef(0);
    const spacingScale = useSpacingScale();

    const gridWidth = gridSize?.width
        ? // Subtract the left and right gutters from the container width.
          gridSize.width - convertRemLengthToPx(gutterRemLength, spacingScale) * 2
        : null;

    // Debounce search input.
    useEffect(() => {
        if (searchTerm === "") {
            setDebouncedTerm("");
            return;
        }

        const timeout = createTimeout(() => {
            setDebouncedTerm(searchTerm);
        }, searchDebounceMs);

        return () => {
            timeout.clear();
        };
    }, [searchTerm]);

    // Reset subsequent pages when the search term changes.
    useEffect(() => {
        setSubsequentGifs([]);
        setIsDone(false);
        setError(null);
        offsetRef.current = 0;
    }, [debouncedTerm]);

    // Use SWR for the first page so it benefits from cache deduplication: if the user
    // opens the picker, closes it, and reopens it the trending results appear
    // instantly without a network request. `preloadGiphyTrending()` also seeds this
    // same cache key on editor mount. Subsequent pages are fetched directly via
    // `giphyFetchPage()` and appended to local state since they're append-only
    // pagination with no caching benefit.
    const giphyFetcher = useMemo(
        () =>
            context
                ? createGiphyFetcher(context)
                : async () => ({gifs: [] as ReadonlyArray<IGif>, isDone: true}),
        [context],
    );
    const firstPage = useSwr(giphySwrKey(debouncedTerm, 0), giphyFetcher);
    const firstPageData = isGiphyPageResult(firstPage.data) ? firstPage.data : null;

    // Once the first page loads, set the offset for subsequent fetches and mark done
    // immediately if the first page already exhausted results.
    const hasSeededOffsetForTermRef = useRef<string | null>(null);
    useEffect(() => {
        if (firstPageData && hasSeededOffsetForTermRef.current !== debouncedTerm) {
            hasSeededOffsetForTermRef.current = debouncedTerm;
            offsetRef.current = firstPageData.gifs.length;
            if (firstPageData.isDone) {
                setIsDone(true);
            }
        }
    }, [firstPageData, debouncedTerm]);

    // Preload first page thumbnails so images are ready when the grid renders.
    const [preloadedFirstPageTerm, setPreloadedFirstPageTerm] = useState<string | null>(null);
    useEffect(() => {
        if (
            firstPageData &&
            firstPageData.gifs.length > 0 &&
            preloadedFirstPageTerm !== debouncedTerm
        ) {
            void preloadGifThumbnails(firstPageData.gifs).then(() => {
                setPreloadedFirstPageTerm(debouncedTerm);
            });
        }
    }, [firstPageData, debouncedTerm, preloadedFirstPageTerm]);

    // Combine the first page (from SWR) with subsequent pages (from direct fetches).
    const gifs = useMemo(() => {
        if (!firstPageData || preloadedFirstPageTerm !== debouncedTerm) return [];
        return [...firstPageData.gifs, ...subsequentGifs];
    }, [firstPageData, preloadedFirstPageTerm, debouncedTerm, subsequentGifs]);

    const isLoading = firstPage.isLoading || isLoadingMore;

    // Derive the effective "done" flag synchronously so the sentinel element isn't
    // rendered in the gap between SWR completing and the effect that sets `isDone`
    // state.
    const isEffectivelyDone = isDone || (firstPageData?.isDone ?? false);

    // Ref-based guard so the IntersectionObserver callback never fires a duplicate
    // fetch between React re-renders.
    const isFetchingMoreRef = useRef(false);

    // Fetch subsequent pages directly (pagination beyond the first page).
    const fetchMore = useCallback(async () => {
        if (isFetchingMoreRef.current || isEffectivelyDone || !context) return;
        if (firstPage.isLoading) return;
        if (offsetRef.current === 0) return;
        isFetchingMoreRef.current = true;
        setIsLoadingMore(true);
        setError(null);

        try {
            const result = await giphyFetchPage(context, debouncedTerm, offsetRef.current);

            if (result.isDone) {
                setIsDone(true);
            } else {
                // Preload thumbnails before adding to state so images are ready when the grid
                // renders.
                await preloadGifThumbnails(result.gifs);
                setSubsequentGifs(prev => [...prev, ...result.gifs]);
                offsetRef.current += result.gifs.length;
            }
        } catch (fetchError) {
            reporter.logErrorWithoutDisplaying("Couldn\u2019t load GIFs", fetchError);
            setError(fetchError);
        } finally {
            isFetchingMoreRef.current = false;
            setIsLoadingMore(false);
        }
    }, [context, debouncedTerm, firstPage.isLoading, isEffectivelyDone, reporter]);

    // Infinite scroll via IntersectionObserver on a sentinel element at the bottom of
    // the grid.
    useEffect(() => {
        const sentinel = sentinelRef.current;
        const container = gridContainerRef.current;
        if (!sentinel || !container) return;

        const observer = new IntersectionObserver(
            entries => {
                if (entries[0]?.isIntersecting) {
                    void fetchMore();
                }
            },
            {root: container, rootMargin: "200px"},
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [fetchMore]);

    const selectGif = useCallback(
        (gif: IGif) => {
            onSelectGif(new URL(gif.images.original.url));
            onClose();
        },
        [onSelectGif, onClose],
    );

    const focusGifAtIndex = useCallback((index: number) => {
        const element = gifElementsRef.current.get(index);
        if (!element) return;

        element.focus({preventScroll: true});

        const container = gridContainerRef.current;
        if (!container) return;

        const containerRect = container.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();

        if (elementRect.bottom > containerRect.bottom) {
            container.scrollTop += elementRect.bottom - containerRect.bottom;
        } else if (elementRect.top < containerRect.top) {
            container.scrollTop += elementRect.top - containerRect.top;
        }
    }, []);

    const handleSearchKeyDown = useCallback(
        (event: ReactKeyboardEvent<HTMLInputElement>) => {
            if (event.key === "ArrowDown") {
                event.preventDefault();
                event.stopPropagation();
                if (gifs.length > 0) {
                    focusGifAtIndex(0);
                }
            }
        },
        [focusGifAtIndex, gifs.length],
    );

    // Focus the search input on mount.
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const layout = useMemo(() => {
        if (gridWidth === null) return null;
        return computeGifPickerRowLayout(gifs, gridWidth, {
            targetRowHeight: convertRemLengthToPx(
                platform === "mobile" ? "48" : "32",
                spacingScale,
            ),
            gutter: convertRemLengthToPx(gutterRemLength, spacingScale),
        });
    }, [gifs, gridWidth, platform, spacingScale]);

    const handleGifKeyDown = useCallback(
        (event: ReactKeyboardEvent<HTMLElement>, index: number) => {
            if (!layout) return;

            const current = layout.items[index]!;

            // Find neighbor in the given direction using horizontal-overlap heuristic for
            // up/down.
            const findVerticalNeighbor = (direction: "up" | "down"): number | null => {
                const targetRow = direction === "up" ? current.row - 1 : current.row + 1;
                let bestIndex: number | null = null;
                let bestOverlap = 0;

                for (let i = 0; i < layout.items.length; i++) {
                    const item = layout.items[i]!;
                    if (item.row !== targetRow) continue;

                    const overlapLeft = Math.max(current.left, item.left);
                    const overlapRight = Math.min(
                        current.left + current.width,
                        item.left + item.width,
                    );
                    const overlap = overlapRight - overlapLeft;

                    if (overlap > bestOverlap) {
                        bestOverlap = overlap;
                        bestIndex = i;
                    }
                }

                return bestIndex;
            };

            const findHorizontalNeighbor = (direction: "left" | "right"): number | null => {
                let bestIndex: number | null = null;
                let bestDistance = Infinity;

                for (let i = 0; i < layout.items.length; i++) {
                    if (i === index) continue;
                    const item = layout.items[i]!;
                    if (item.row !== current.row) continue;

                    if (direction === "left" && item.left < current.left) {
                        const distance = current.left - item.left;
                        if (distance < bestDistance) {
                            bestDistance = distance;
                            bestIndex = i;
                        }
                    } else if (direction === "right" && item.left > current.left) {
                        const distance = item.left - current.left;
                        if (distance < bestDistance) {
                            bestDistance = distance;
                            bestIndex = i;
                        }
                    }
                }

                return bestIndex;
            };

            switch (event.key) {
                case "ArrowUp": {
                    event.preventDefault();
                    event.stopPropagation();
                    const target = findVerticalNeighbor("up");
                    if (target !== null) {
                        focusGifAtIndex(target);
                    } else {
                        inputRef.current?.focus();
                    }
                    break;
                }
                case "ArrowDown": {
                    event.preventDefault();
                    event.stopPropagation();
                    const target = findVerticalNeighbor("down");
                    if (target !== null) {
                        focusGifAtIndex(target);
                    }
                    break;
                }
                case "ArrowLeft": {
                    event.preventDefault();
                    event.stopPropagation();
                    const target = findHorizontalNeighbor("left");
                    if (target !== null) {
                        focusGifAtIndex(target);
                    }
                    break;
                }
                case "ArrowRight": {
                    event.preventDefault();
                    event.stopPropagation();
                    const target = findHorizontalNeighbor("right");
                    if (target !== null) {
                        focusGifAtIndex(target);
                    }
                    break;
                }
                case "Enter": {
                    event.preventDefault();
                    event.stopPropagation();
                    selectGif(assertExists(gifs[index]));
                    break;
                }
                case "Escape": {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose();
                    break;
                }
            }
        },
        [focusGifAtIndex, gifs, layout, onClose, selectGif],
    );

    return (
        <Box
            display="flex"
            flexDirection="column"
            backgroundColor="grey-0"
            borderRadius="1"
            boxShadow="elevation-20"
            width={platform === "mobile" ? "full" : "96"}
            height={platform === "mobile" ? "full" : "96"}
            overflow="hidden"
        >
            <Box display="flex" alignItems="center" gap="2" padding="2">
                <Box flex="1">
                    <TextInputWithoutLabel
                        ref={inputRef}
                        aria-label="Search GIFs"
                        placeholder="Search GIFs"
                        value={searchTerm}
                        onChange={setSearchTerm}
                        onEscape={onClose}
                        onKeyDown={handleSearchKeyDown}
                        withoutBorder
                        icon={<MagnifyingGlass size={16} color={colorSchemeVars["grey-40"]} />}
                    />
                </Box>
                {/*
                The GIPHY API license requires "Powered by GIPHY"
                attribution to be displayed wherever the API is used.
                */}
                <Box display="flex" alignItems="center" gap="1.5" flexShrink="0">
                    <Box color="grey-40" fontSize="25">
                        POWERED BY
                    </Box>
                    <GiphyWordmark hideLogo style={{height: 12, opacity: 0.8, marginTop: "-1px"}} />
                </Box>
            </Box>
            <Box
                ref={useMergedRefs(gridContainerRef, useScrollbar(), resizeObserverRef)}
                position="relative"
                borderRadius="1"
                overflowY="auto"
                overflowX="hidden"
                flex="1"
                padding={gutterRemLength}
            >
                {layout !== null && (
                    <Box position="relative" style={{height: layout.containerHeight}}>
                        {gifs.map((gif, index) => (
                            <GifPickerCell
                                key={`${gif.id}`}
                                gif={gif}
                                index={index}
                                layout={layout.items[index]!}
                                gifElementsRef={gifElementsRef}
                                onSelect={selectGif}
                                onKeyDown={handleGifKeyDown}
                            />
                        ))}
                    </Box>
                )}
                {isLoading && <GifPickerLoader />}
                {error !== null && (
                    <Box
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        height={gifs.length === 0 ? "full" : undefined}
                        flex={gifs.length === 0 ? "1" : undefined}
                    >
                        <ErrorInlineAlert
                            title={"Couldn\u2019t load GIFs"}
                            error={error}
                            onDismiss={() => setError(null)}
                        />
                    </Box>
                )}
                {!isEffectivelyDone && !error && <Box ref={sentinelRef} />}
            </Box>
        </Box>
    );
}

/**
 * A single cell in the GIF grid. Renders a thumbnail image with keyboard and click
 * interaction.
 */
function GifPickerCell({
    gif,
    index,
    layout,
    gifElementsRef,
    onSelect,
    onKeyDown,
}: {
    gif: IGif;
    index: number;
    layout: GifPickerRowLayoutItem;
    gifElementsRef: React.MutableRefObject<Map<number, HTMLElement>>;
    onSelect: (gif: IGif) => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>, index: number) => void;
}): ReactElement {
    const cellRef = useCallback(
        (element: HTMLElement | null) => {
            if (element) {
                gifElementsRef.current.set(index, element);
            } else {
                gifElementsRef.current.delete(index);
            }
        },
        [gifElementsRef, index],
    );

    return (
        <FocusRing offset="0" isVisibleFromAnyFocus={true}>
            <Box
                ref={cellRef}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(gif)}
                onKeyDown={event => onKeyDown(event, index)}
                position="absolute"
                borderRadius="1"
                overflow="hidden"
                style={{
                    top: layout.top,
                    left: layout.left,
                    width: layout.width,
                    height: layout.height,
                    cursor: "pointer",
                }}
            >
                <img
                    src={gif.images.fixed_width.url}
                    alt={gif.title}
                    loading="lazy"
                    style={{
                        display: "block",
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        backgroundColor: colorSchemeVars["grey-10"],
                    }}
                />
            </Box>
        </FocusRing>
    );
}

function isGiphyPageResult(data: object | null): data is GiphyPageResult {
    return data !== null && "gifs" in data && "isDone" in data;
}
