import classNames from "classnames";
import {BookOpen, Brain, Check, MagnifyingGlass} from "phosphor-react";
import {Node} from "prosemirror-model";
import {ReactNode} from "react";
import {ContentView} from "~/client/content/content_view.js";
import {MessageStreamSummarySectionOptions} from "~/client/messaging/internal/create_message_stream_summary_sections.js";
import {printAgentThoughtDuration} from "~/client/messaging/internal/print_agent_thought_duration.js";
import {contentStyles, pulseAnimationClassName, sprinkles} from "~/client/styles/styles.js";
import {parseApiMentionPath} from "~/shared/api/parse_api_path.js";
import {ApiMentionPath} from "~/shared/api/types/api_specification_convenience_types.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ContentReferences, ContentWithReferences} from "~/shared/content/content_references.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    MessageContent,
    MessageContentProsemirrorSchema,
} from "~/shared/messaging/message_content_schema.js";

// NOTE(ifitzsimmons): You are not allowed to use the `<Box>` component in this
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

const thinkingSectionFontColor = "grey-60";

export function MessageStreamSummarySection({
    section,
    references,
    spacingScale,
}: {
    section: MessageStreamSummarySectionOptions;
    references: ContentReferences;
    spacingScale: SpacingScale;
}) {
    // Show the duration for any section whose duration is greater than 1 second.
    const shouldShowDuration = section.isCompleted && section.durationMs > 1000;

    return (
        <div className={classNames(!section.isCompleted ? pulseAnimationClassName : undefined)}>
            {/* Section header with main icon */}
            <div
                className={sprinkles({
                    display: "flex",
                    gap: "3",
                    marginBottom: "2",
                    alignItems: "center",
                })}
            >
                {/* Timeline column with icon */}
                <div
                    className={sprinkles({
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        width: "8",
                    })}
                >
                    {getSectionIcon(section)}
                </div>

                {/* Section title */}
                <div className={sprinkles({display: "flex", flexDirection: "column"})}>
                    <div
                        className={sprinkles({
                            color: "grey-100",
                            fontSize: "100",
                            fontStyle: "bold",
                        })}
                        style={{
                            lineHeight: `${contentStyles.paragraphLineHeightPx[spacingScale]}px`,
                        }}
                    >
                        {getSectionTitle(section)}
                    </div>
                </div>
            </div>

            {intoSectionItemsList(section, references).map((item, itemIndex) => {
                return (
                    <div key={itemIndex} className={sprinkles({display: "flex", gap: "3"})}>
                        {/* Timeline column with mini circle and line */}
                        <div
                            className={sprinkles({
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                width: "8",
                            })}
                            style={{flexShrink: 0}}
                        >
                            {/* Vertical line before mini circle */}
                            <div
                                className={sprinkles({
                                    backgroundColor: "grey-20",
                                    height: "2",
                                })}
                                style={{width: "1px"}}
                            />
                            {/* Mini filled circle */}
                            <div
                                className={sprinkles({
                                    backgroundColor: "grey-40",
                                    width: "2",
                                    height: "2",
                                    borderRadius: "full",
                                })}
                            />
                            {/* Vertical line after mini circle. */}
                            <div
                                className={sprinkles({
                                    backgroundColor: "grey-20",
                                    minHeight: "4",
                                })}
                                style={{flexGrow: 1, width: "1px"}}
                            />
                        </div>

                        {/* Item content */}
                        <div
                            className={sprinkles({
                                paddingBottom: "1.5",
                                gap: "0",
                                paddingTop: "1",
                            })}
                            style={{
                                flexGrow: 1,
                            }}
                        >
                            {item}
                        </div>
                    </div>
                );
            })}
            {section.isCompleted && (
                <div
                    className={sprinkles({
                        display: "flex",
                        gap: "3",
                        alignItems: "center",
                        paddingBottom: "3",
                    })}
                >
                    <div
                        className={sprinkles({
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            width: "8",
                        })}
                    >
                        {/* Vertical line before mini circle */}
                        <div
                            className={sprinkles({
                                backgroundColor: "grey-20",
                                height: "0.5",
                            })}
                            style={{
                                width: "1px",
                            }}
                        />
                        {/* Check mark icon with circle drawn around it */}
                        <div
                            className={sprinkles({
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                borderRadius: "full",
                                border: "grey-20",
                                backgroundColor: "grey-0",
                                width: "4",
                                height: "4",
                            })}
                        >
                            <Check size={10} weight="bold" />
                        </div>
                    </div>
                    <div className={sprinkles({color: "grey-40"})} style={{flexGrow: 1}}>
                        {shouldShowDuration ? getDurationTextForSection(section) : "Done"}
                    </div>
                </div>
            )}
        </div>
    );
}

function getSectionTitle(section: MessageStreamSummarySectionOptions) {
    switch (section.type) {
        case "Read":
            return "Reading content";
        case "Search":
            return "Searching Alpine";
        case "Reasoning":
            return "Thinking";
        default:
            throw exhaustive(section);
    }
}

// TODO(ifitzsimmons, #ai): While the sections are active, I'd love to show a "streaming text" UX
// for new calls / reasoning summaries so that it looks like they are being typed. The current
// UX for *active* sections is good enough, but could be improved.
function intoSectionItemsList(
    section: MessageStreamSummarySectionOptions,
    references: ContentReferences,
): Array<ReactNode> {
    switch (section.type) {
        case "Reasoning": {
            return section.calls.map((reasoning, callIndex) => {
                const headerAndBody = getReasoningHeaderAndBodyIfPossible(reasoning.content);
                if (!headerAndBody) {
                    return null;
                }

                const {header, contentWithoutHeader} = headerAndBody;

                return (
                    <div
                        key={callIndex}
                        className={sprinkles({
                            color: thinkingSectionFontColor,
                            display: "flex",
                            flexDirection: "column",
                            gap: "1",
                        })}
                    >
                        <div className={sprinkles({fontStyle: "bold"})}>{header}</div>
                        <div className={sprinkles({fontSize: "75"})}>{contentWithoutHeader}</div>
                    </div>
                );
            });
        }
        case "Read": {
            return section.calls.map((read, callIndex) => {
                return (
                    <ContentView
                        key={callIndex}
                        content={
                            {
                                doc: MessageContentProsemirrorSchema.node("doc", {}, [
                                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                                        MessageContentProsemirrorSchema.node("mention", {
                                            mention: getMentionContent(read.targetPath),
                                        }),
                                    ]),
                                ]),
                                references,
                            } as ContentWithReferences
                        }
                        className={sprinkles({
                            color: thinkingSectionFontColor,
                        })}
                    />
                );
            });
        }
        case "Search": {
            return section.calls.map((search, callIndex) => {
                return (
                    <div
                        key={callIndex}
                        className={sprinkles({
                            color: thinkingSectionFontColor,
                        })}
                    >
                        “{search.query}”
                    </div>
                );
            });
        }
        default:
            throw exhaustive(section);
    }
}

function getReasoningHeaderAndBodyIfPossible(summary: MessageContent): {
    header: string | null;
    contentWithoutHeader: string;
} {
    function getContentWithoutHeader(startNodeIndex: number): string {
        const remainingChildren: Array<Node> = [];
        for (let i = startNodeIndex; i < summary.childCount; i++) {
            remainingChildren.push(summary.child(i));
        }
        return remainingChildren.map(node => node.textContent).join("\n");
    }

    const firstParagraph = summary.firstChild;
    if (
        !firstParagraph ||
        firstParagraph.type.name !== "paragraph" ||
        firstParagraph.childCount !== 1
    ) {
        return {header: null, contentWithoutHeader: getContentWithoutHeader(0)};
    }

    // Check if first child of paragraph is bold
    const firstChild = firstParagraph.firstChild;
    if (!firstChild || !firstChild.marks.some(mark => mark.type.name === "bold")) {
        return {header: null, contentWithoutHeader: getContentWithoutHeader(0)};
    }

    const headerText = firstChild.marks.some(mark => mark.type.name === "bold")
        ? firstChild.text
        : null;

    if (!headerText) return {header: null, contentWithoutHeader: getContentWithoutHeader(0)};

    // Case 1: If the first paragraph only has the bold text, skip the entire paragraph
    return {header: headerText, contentWithoutHeader: getContentWithoutHeader(1)};
}

function getDurationTextForSection(section: MessageStreamSummarySectionOptions) {
    const durationText = printAgentThoughtDuration(section.durationMs);
    switch (section.type) {
        case "Reasoning": {
            return `Thought for ${durationText}`;
        }
        case "Read": {
            return `Read for ${durationText}`;
        }
        case "Search": {
            return `Searched for ${durationText}`;
        }
        default:
            throw exhaustive(section);
    }
}

const getMentionContent = (targetPath: ApiMentionPath): ContentMention => {
    const targetPathObject = parseApiMentionPath(targetPath);
    switch (targetPathObject.type) {
        case "Account": {
            return cast<ContentMention>({
                type: "Account",
                accountId: targetPathObject.id,
                isShort: false,
            });
        }
        case "Channel": {
            return cast<ContentMention>({
                type: "SearchEntity",
                entityId: `Channel:${targetPathObject.id}`,
            });
        }
        case "Document": {
            return cast<ContentMention>({
                type: "SearchEntity",
                entityId: `Document:${targetPathObject.id}`,
            });
        }
        case "Post": {
            return cast<ContentMention>({
                type: "SearchEntity",
                entityId: `Post:${targetPathObject.id}`,
            });
        }
        case "Task": {
            return cast<ContentMention>({
                type: "SearchEntity",
                entityId: `Task:${targetPathObject.id}`,
            });
        }
        case "TaskCollection": {
            return cast<ContentMention>({
                type: "SearchEntity",
                entityId: `TaskCollection:${targetPathObject.id}`,
            });
        }
        default:
            throw exhaustive(targetPathObject);
    }
};

function getSectionIcon(section: Pick<MessageStreamSummarySectionOptions, "type">) {
    const iconSize = "20";
    switch (section.type) {
        case "Read": {
            return <BookOpen size={iconSize} weight="bold" />;
        }
        case "Search": {
            return <MagnifyingGlass size={iconSize} weight="bold" />;
        }
        case "Reasoning": {
            return <Brain size={iconSize} weight="bold" />;
        }
        default:
            throw exhaustive(section.type);
    }
}
