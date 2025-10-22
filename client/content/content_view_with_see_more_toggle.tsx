import {useRef, useState} from "react";
import {ContentView, ContentViewProps} from "~/client/content/content_view.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {ContentWithReferences} from "~/shared/content/content_references.js";

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

    // If we're running a `jumpAnimation` while content is closed then open the
    // content so we can see what the jump animation is trying to highlight!
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

export function ContentViewWithSeeMoreToggleBase<Content extends ContentWithReferences>({
    content,
    contentSnippet,
    isShowingAllContent: isShowingAllContentFromProps,
    onIsShowingAllContentChange,
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
    // nearest scrollable parent such that the bottom of the post's content stays
    // in the same place on screen. Instead of leaving the scroll position as it is
    // which can end up showing completely unrelated content in a large scroll
    // view.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (isShowingAllContent) return;

        const fixScrollAfterSeeLessContent = fixScrollAfterSeeLessContentRef.current;
        fixScrollAfterSeeLessContentRef.current = null;
        if (fixScrollAfterSeeLessContent === null) return;

        const {targetElement, scrollElement, scrollTop, bottom} = fixScrollAfterSeeLessContent;

        scrollElement.scrollTop = scrollTop + targetElement.getBoundingClientRect().bottom - bottom;
    }, [isShowingAllContent]);

    return (
        <ContentView
            {...props}
            content={isContentSnippetTruncated && !isShowingAllContent ? contentSnippet : content}
            onSeeMoreContent={
                isContentSnippetTruncated && !isShowingAllContent
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
}
