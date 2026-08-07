import {useRef, useState} from "react";
import {usePress} from "react-aria";
import {ContentView, ContentViewProps} from "~/client/web/content/content_view.js";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {getSpacingScaleWithoutListening} from "~/client/web/remix/spacing_scale_context.js";
import {backgroundColorVar, contentStyles, fontSizes} from "~/client/web/styles/styles.js";
import {ContentWithReferences} from "~/shared/content/content_references.js";
import {Spacing, addRemLengths, convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

export function ContentViewWithSeeMoreToggle<Content extends ContentWithReferences>({
    content,
    contentSnippet,
    initiallyShowAllContent,
    ...props
}: Omit<ContentViewProps<Content>, "onSeeMoreContent" | "onSeeLessContent"> & {
    /**
     * The content to render.
     */
    contentSnippet: Content;

    /**
     * Are we initially showing all content?
     */
    initiallyShowAllContent?: boolean;
}) {
    const isContentSnippetTruncated = content.doc.nodeSize !== contentSnippet.doc.nodeSize;

    const [isShowingAllContent, setIsShowingAllContent] = useState(
        initiallyShowAllContent || !isContentSnippetTruncated,
    );
    if (!isShowingAllContent && !isContentSnippetTruncated) setIsShowingAllContent(true);

    // If we're running a `jumpAnimation` while content is closed then open the content
    // so we can see what the jump animation is trying to highlight!
    if (!isShowingAllContent && isContentSnippetTruncated && props.jumpAnimation)
        setIsShowingAllContent(true);

    return (
        <ContentViewWithSeeMoreToggleBase
            {...props}
            content={content}
            contentSnippet={contentSnippet}
            isShowingAllContent={isShowingAllContent}
            onIsShowingAllContentChange={setIsShowingAllContent}
        />
    );
}

const defaultSeeMore = {type: "Inline" as const};

export function ContentViewWithSeeMoreToggleBase<Content extends ContentWithReferences>({
    content,
    contentSnippet,
    isShowingAllContent: isShowingAllContentFromProps,
    onIsShowingAllContentChange,
    seeMore = defaultSeeMore,
    ...props
}: Omit<ContentViewProps<Content>, "onSeeMoreContent" | "onSeeLessContent"> & {
    /**
     * The content to render.
     */
    contentSnippet: Content;

    /**
     * Are we showing `content` (true) or `contentSnippet` (false)?
     */
    isShowingAllContent: boolean;

    /**
     * Update `isShowingAllContent` to true or false.
     */
    onIsShowingAllContentChange: (isShowingAllContent: boolean) => void;

    /**
     * How should we render the "See more" button? Defaults to `Inline`.
     */
    seeMore?: {type: "Inline"} | {type: "Gradient"; paddingX: Spacing; paddingY: Spacing};
}) {
    const isContentSnippetTruncated = content.doc.nodeSize !== contentSnippet.doc.nodeSize;
    const isShowingAllContent = isShowingAllContentFromProps || !isContentSnippetTruncated;

    const fixScrollAfterSeeLessContentRef = useRef<{
        targetElement: HTMLElement;
        scrollElement: HTMLElement;
        scrollTop: number;
        bottom: number;
    } | null>(null);

    // When the user presses "See less" then after rendering we want to scroll the
    // nearest scrollable parent such that the bottom of the post's content stays in
    // the same place on screen. Instead of leaving the scroll position as it is which
    // can end up showing completely unrelated content in a large scroll view.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (isShowingAllContent) return;

        const fixScrollAfterSeeLessContent = fixScrollAfterSeeLessContentRef.current;
        fixScrollAfterSeeLessContentRef.current = null;
        if (fixScrollAfterSeeLessContent === null) return;

        const {
            targetElement,
            scrollElement,
            scrollTop,
            bottom: oldBottom,
        } = fixScrollAfterSeeLessContent;

        const newBottom =
            targetElement.getBoundingClientRect().bottom -
            // If we are using the gradient "See more" button design then the bottom of the
            // `targetElement` will be pulled down by the negative margin. So counteract this
            // by subtracting the negative margin again here.
            (seeMore.type === "Gradient"
                ? convertRemLengthToPx(
                      contentViewGradientSeeMoreButtonNegativeMarginBottom,
                      getSpacingScaleWithoutListening(),
                  )
                : 0);

        scrollElement.scrollTop = scrollTop + newBottom - oldBottom;
    }, [isShowingAllContent, seeMore.type]);

    const node = (
        <ContentView
            {...props}
            content={isContentSnippetTruncated && !isShowingAllContent ? contentSnippet : content}
            onSeeMoreContent={
                seeMore.type === "Inline" && isContentSnippetTruncated && !isShowingAllContent
                    ? () => onIsShowingAllContentChange(true)
                    : undefined
            }
            onSeeLessContent={
                isContentSnippetTruncated && isShowingAllContent
                    ? targetElement => {
                          let scrollElement: HTMLElement | null = targetElement;

                          while (scrollElement) {
                              const {overflowY} = getComputedStyle(scrollElement);

                              const isScrollable = overflowY === "scroll" || overflowY === "auto";
                              if (isScrollable) break;

                              scrollElement = scrollElement.parentElement;
                          }

                          if (scrollElement) {
                              fixScrollAfterSeeLessContentRef.current = {
                                  targetElement,
                                  scrollElement,
                                  scrollTop: scrollElement.scrollTop,
                                  bottom: targetElement.getBoundingClientRect().bottom,
                              };
                          }

                          onIsShowingAllContentChange(false);
                      }
                    : undefined
            }
        />
    );

    if (seeMore.type === "Inline") return node;

    assert(seeMore.type === "Gradient");

    return (
        <Box
            position="relative"
            zIndex="0"
            marginBottom={
                !isShowingAllContent
                    ? `-${contentViewGradientSeeMoreButtonNegativeMarginBottom}`
                    : undefined
            }
            style={{
                minHeight: !isShowingAllContent
                    ? contentViewGradientSeeMoreButtonHeight
                    : undefined,
            }}
        >
            {node}
            {isContentSnippetTruncated && !isShowingAllContent && (
                <ContentViewGradientSeeMoreButton
                    paddingX={seeMore.paddingX}
                    paddingY={seeMore.paddingY}
                    onPress={() => onIsShowingAllContentChange(true)}
                />
            )}
        </Box>
    );
}

// The largest possible line height for text in content. So if we truncate within
// the largest possible line it will be covered under our "See more" gradient.
const largestContentLineHeight = fontSizes[contentStyles.headingLevel1FontSize.wide].lineHeight;

const contentViewGradientSeeMoreButtonHeight = addRemLengths("20", largestContentLineHeight);

const contentViewGradientSeeMoreButtonNegativeMarginBottom = "2";

function ContentViewGradientSeeMoreButton({
    paddingX,
    paddingY,
    onPress,
}: {
    paddingX: Spacing;
    paddingY: Spacing;
    onPress: () => void;
}) {
    const {isPressed, pressProps} = usePress({onPress});

    return (
        <Box
            {...pressProps}
            position="absolute"
            zIndex="10"
            bottom={paddingY}
            left="0"
            right="0"
            style={{
                height: contentViewGradientSeeMoreButtonHeight,
                background: `linear-gradient(to top, ${backgroundColorVar} ${largestContentLineHeight}, rgb(from ${backgroundColorVar} r g b / 0%) ${contentViewGradientSeeMoreButtonHeight})`,
            }}
        >
            <Box
                position="absolute"
                bottom={contentViewGradientSeeMoreButtonNegativeMarginBottom}
                left="0"
                right="0"
                marginX="auto"
                paddingX={paddingX}
                display="flex"
                justifyContent="flex-start"
                alignItems="center"
            >
                <FocusRing>
                    <Box
                        tabIndex={0}
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        gap="1.5"
                        cursor="pointer"
                        marginRight="2"
                        opacity={isPressed ? "60" : undefined}
                    >
                        <Box
                            fontStyle="semi-bold"
                            color="grey-90"
                            style={contentStyles.paragraphFontSize}
                        >
                            See more…
                        </Box>
                    </Box>
                </FocusRing>
            </Box>
        </Box>
    );
}
