import {useRef, useState} from "react";
import {ContentView, ContentViewProps} from "~/client/content/content_view.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {ContentWithReferences} from "~/shared/content/content_references.js";

export function ContentViewWithSeeMoreToggle<Content extends ContentWithReferences>({
    content,
    contentSnippet,
    initiallyShowAll,
    ...props
}: Omit<ContentViewProps<Content>, "onSeeMoreContent" | "onSeeLessContent"> & {
    /**
     * The content to render.
     */
    contentSnippet: Content;

    /**
     * Are we initially showing all content?
     */
    initiallyShowAll?: boolean;
}) {
    const isContentSnippetTruncated = content.doc.nodeSize !== contentSnippet.doc.nodeSize;

    const [isShowingAllContent, setIsShowingAllContent] = useState(
        initiallyShowAll || !isContentSnippetTruncated,
    );
    if (!isShowingAllContent && !isContentSnippetTruncated) setIsShowingAllContent(true);

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
                    ? () => setIsShowingAllContent(true)
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

                          setIsShowingAllContent(false);
                      }
                    : undefined
            }
        />
    );
}
