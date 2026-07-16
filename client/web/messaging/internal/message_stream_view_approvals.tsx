import {CaretDown, CaretLeft, CaretRight, Check, ShieldCheck, X} from "phosphor-react";
import {ReactNode, useEffect, useMemo, useRef, useState} from "react";
import {AccountRegistry} from "~/client/web/accounts/account_registry.js";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {AccountShortName} from "~/client/web/accounts/account_short_name.js";
import {FileRegistry} from "~/client/web/content/file_registry.js";
import {useFileRegistry} from "~/client/web/content/file_registry_context.js";
import {printContentSingleLineTextSnippetForClient} from "~/client/web/content/print_content_single_line_text_snippet_for_client.js";
import {Button} from "~/client/web/design/button.js";
import {Checkbox} from "~/client/web/design/checkbox.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {Tooltip} from "~/client/web/design/tooltip.js";
import {
    addResizeListenerForElement,
    removeResizeListenerForElement,
} from "~/client/web/helpers/use_resize_observer.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {SearchEntityRegistry} from "~/client/web/search/core/search_entity_registry.js";
import {useSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {MessageContent} from "~/shared/content/message_content_schema.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Locale} from "~/shared/helpers/intl/locale.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.js";
import {
    MessageExperimentalApproval,
    MessageExperimentalApprovalDecisionOption,
    MessageExperimentalApprovalDecisionValue,
    MessageExperimentalApprovalDecisionValueWithoutDecider,
    MessageStreamExperimentalApprovalsPartPayload,
    isMessageApprovalDecisionValueForOption,
} from "~/shared/messaging/message_schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {Store} from "~/shared/store/store.js";

export type MessageStreamApprovalSessionNoun = "post" | "chat" | "task" | "thread";

// Used for pagination, checkbox w/ text, and approved/canceled text.
const lightGreyAccentColor = "grey-50" as const;

// Used for "<shield icon>ChatGPT wants to:" – we make this a little darker to make
// it stand out more.
const darkerGreyAccentColor = "grey-60" as const;

// NOTE(calebmer): You are not allowed to use the `<Box>` component in this
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

/**
 * Record the current account's decisions on the approvals part rendered by
 * `MessageStreamViewApprovals`. Bound to a specific message by `MessageView`.
 * `null` when the current account can't decide (e.g. an optimistic message or a
 * room that doesn't support approval decisions).
 */
export type PutMessageStreamApprovalDecisionsFunction = (
    decisions: ReadonlyArray<{
        readonly index: number;
        readonly value: MessageExperimentalApprovalDecisionValueWithoutDecider;
    }>,
) => Promise<void>;

/**
 * Renders a message stream's approval requests at the bottom of the message, one
 * card at a time. Each card asks the reader to allow the message author (an agent)
 * to take the action the approval summarizes: "Allow ChatGPT to: {summary}". The
 * "Allow"/"Cancel" actions sit at the bottom right of the card and any session
 * scoped options ("Allow for this chat") collapse into a checkbox with a dropdown
 * at the bottom left. When the message has more than one approval the card pages
 * through them, starting from the first undecided approval and automatically
 * advancing to the next undecided approval as decisions come in.
 *
 * Decisions are not applied optimistically. Recording a decision goes through the
 * room's realtime WebSocket which sends the updated approvals part back to this
 * client as a `PutMessageStreamPart` event before the procedure resolves. The
 * picked option shows a pending spinner until that event flips the card to its
 * decided state (and pages to the next undecided approval, if any).
 */
export function MessageStreamViewApprovals({
    part,
    references,
    author,
    approvalSessionNoun,
    putApprovalDecisions,
}: {
    part: MessageStreamExperimentalApprovalsPartPayload;
    references: ContentReferences;
    author: AccountModel;
    approvalSessionNoun: MessageStreamApprovalSessionNoun;
    putApprovalDecisions: PutMessageStreamApprovalDecisionsFunction | null;
}) {
    if (part.approvals.length === 0) return null;

    return (
        <div
            className={sprinkles({
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
                paddingTop: contentStyles.standaloneBlockMargin,
            })}
        >
            {part.approvals.length === 1 ? (
                <MessageStreamViewApprovalCard
                    approval={assertExists(part.approvals[0])}
                    approvalIndex={0}
                    references={references}
                    author={author}
                    approvalSessionNoun={approvalSessionNoun}
                    putApprovalDecisions={putApprovalDecisions}
                />
            ) : (
                <MessageStreamViewApprovalsPagination
                    approvals={part.approvals}
                    references={references}
                    author={author}
                    approvalSessionNoun={approvalSessionNoun}
                    putApprovalDecisions={putApprovalDecisions}
                />
            )}
        </div>
    );
}

/**
 * Pages through a message's approval requests one card at a time.
 *
 * The first render starts on the first undecided approval. When the approval the
 * user is viewing becomes decided — by them or by anyone else, either way the
 * decision arrives with the realtime approvals part update — we automatically
 * advance to the next undecided approval so a batch can be decided without ever
 * touching the pagination buttons. Navigating between cards manually never
 * triggers an advance.
 */
function MessageStreamViewApprovalsPagination({
    approvals,
    references,
    author,
    approvalSessionNoun,
    putApprovalDecisions,
}: {
    approvals: ReadonlyArray<MessageExperimentalApproval>;
    references: ContentReferences;
    author: AccountModel;
    approvalSessionNoun: MessageStreamApprovalSessionNoun;
    putApprovalDecisions: PutMessageStreamApprovalDecisionsFunction | null;
}) {
    const [viewedApprovalIndex, setViewedApprovalIndex] = useState(
        () => findNextUndecidedApprovalIndex(approvals, -1) ?? 0,
    );

    // The approvals part is replaced whole on updates and the approval count isn't
    // expected to change, but clamp so we never render out of bounds if it does.
    const approvalIndex = Math.min(viewedApprovalIndex, approvals.length - 1);
    const approval = assertExists(approvals[approvalIndex]);
    const isDecided = approval.decision.value !== undefined;

    const previousViewedRef = useRef({approvalIndex, isDecided});
    useEffect(() => {
        const previousViewed = previousViewedRef.current;
        previousViewedRef.current = {approvalIndex, isDecided};

        // Only advance when the approval the user is already viewing transitions from
        // undecided to decided — never on manual navigation between cards.
        if (previousViewed.approvalIndex !== approvalIndex) return;
        if (previousViewed.isDecided || !isDecided) return;

        const nextUndecidedApprovalIndex = findNextUndecidedApprovalIndex(approvals, approvalIndex);
        if (nextUndecidedApprovalIndex !== null) {
            setViewedApprovalIndex(nextUndecidedApprovalIndex);
        }
    }, [approvals, approvalIndex, isDecided]);

    return (
        <MessageStreamViewApprovalCard
            // Keying by approval keeps per-card state (pending option, session checkbox) from
            // leaking between approvals as the user pages.
            key={approvalIndex}
            approval={approval}
            approvalIndex={approvalIndex}
            references={references}
            author={author}
            approvalSessionNoun={approvalSessionNoun}
            putApprovalDecisions={putApprovalDecisions}
            paginationNode={
                <div
                    className={sprinkles({
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5",
                        color: lightGreyAccentColor,
                        fontSize: "75",
                    })}
                >
                    <IconButton
                        description="Previous approval"
                        variant="quietest"
                        size="xs"
                        isDisabled={approvalIndex === 0}
                        onPress={() => setViewedApprovalIndex(approvalIndex - 1)}
                    >
                        <CaretLeft />
                    </IconButton>
                    <span style={{whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums"}}>
                        {approvalIndex + 1} of {approvals.length}
                    </span>
                    <IconButton
                        description="Next approval"
                        variant="quietest"
                        size="xs"
                        isDisabled={approvalIndex === approvals.length - 1}
                        onPress={() => setViewedApprovalIndex(approvalIndex + 1)}
                    >
                        <CaretRight />
                    </IconButton>
                </div>
            }
        />
    );
}

function MessageStreamViewApprovalCard({
    approval,
    approvalIndex,
    references,
    author,
    approvalSessionNoun,
    putApprovalDecisions,
    paginationNode,
}: {
    approval: MessageExperimentalApproval;
    approvalIndex: number;
    references: ContentReferences;
    author: AccountModel;
    approvalSessionNoun: MessageStreamApprovalSessionNoun;
    putApprovalDecisions: PutMessageStreamApprovalDecisionsFunction | null;
    paginationNode?: ReactNode;
}) {
    const accountRegistry = useAccountRegistry();
    const searchEntityRegistry = useSearchEntityRegistry();
    const fileRegistry = useFileRegistry();

    const summaryText = useStore(
        useMemo(
            () =>
                computeStore(get =>
                    getMessageApprovalContentText(get, references, approval.summary, {
                        accountRegistry,
                        searchEntityRegistry,
                        fileRegistry,
                    }),
                ),
            [accountRegistry, approval.summary, fileRegistry, references, searchEntityRegistry],
        ),
    );

    const decisionValue = approval.decision.value;

    const [summaryElement, setSummaryElement] = useState<HTMLDivElement | null>(null);
    const [isSummaryTruncated, setIsSummaryTruncated] = useState(false);

    // The summary tooltip repeats the summary line so it's only useful when the line
    // is actually truncated, which we can only know by measuring the rendered element.
    useEffect(() => {
        // NOTE(ifitzsimmons, 2026-07-16): The summary element renders `summaryText` so
        // re-measure when it changes. As of writing, the summary text is fixed and really
        // shouldn't change. We'll leave this here for now in case it does in the future.
        //
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        summaryText;

        if (summaryElement === null) return;

        const measureIsSummaryTruncated = () => {
            setIsSummaryTruncated(summaryElement.scrollWidth > summaryElement.clientWidth);
        };

        measureIsSummaryTruncated();

        // Resizing the element changes how much text fits on the summary's single line.
        addResizeListenerForElement(summaryElement, measureIsSummaryTruncated);
        return () => removeResizeListenerForElement(summaryElement, measureIsSummaryTruncated);
    }, [summaryElement, summaryText]);

    return (
        <div
            className={sprinkles({
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
                gap: "4",
                padding: "4",
                backgroundColor: "grey-0",
                boxShadow: "elevation-5-with-grey-10-border",
                borderRadius: "1.5",
                userSelect: "text",
            })}
        >
            <div
                className={sprinkles({
                    display: "flex",
                    alignItems: "center",
                    gap: "3",
                })}
            >
                <div
                    className={sprinkles({
                        display: "flex",
                        alignItems: "center",
                        gap: "1.5",
                        flexGrow: "1",
                        minWidth: "flex-fit",
                        fontSize: "75",
                    })}
                    style={{lineHeight: spacing["4"]}}
                >
                    {/* Center the badge on the truncated summary line. */}
                    <div
                        className={sprinkles({
                            display: "flex",
                            alignItems: "center",
                            flexShrink: "0",
                            color: darkerGreyAccentColor,
                            marginTop: "-0.5",
                        })}
                        style={{height: spacing["4"]}}
                    >
                        <ShieldCheck size={spacing["4"]} />
                    </div>
                    <Tooltip
                        isDisabled={!isSummaryTruncated}
                        // Place the tooltip on the right, next to the truncation ellipsis, and let it grow
                        // wide enough to comfortably fit a full summary line.
                        placement="top-end"
                        maxWidth="128"
                        content={
                            <>
                                <AccountShortName account={author} isTooltipDisabled={true} /> wants
                                to: {summaryText}
                            </>
                        }
                    >
                        <div
                            ref={setSummaryElement}
                            className={sprinkles({
                                flexGrow: "1",
                                minWidth: "flex-fit",
                                fontStyle: "truncate",
                            })}
                        >
                            <span className={sprinkles({color: darkerGreyAccentColor})}>
                                <AccountShortName account={author} isTooltipDisabled={true} /> wants
                                to:
                            </span>{" "}
                            {summaryText}
                        </div>
                    </Tooltip>
                </div>
                {paginationNode}
            </div>
            <div
                className={sprinkles({
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: "2",
                    // Decisions replace the option buttons with a line of text. Reserve the buttons'
                    // height so the card never changes size when a decision is made.
                    minHeight: "6",
                })}
            >
                {decisionValue !== undefined ? (
                    <MessageStreamViewApprovalCardDecision
                        approval={approval}
                        decisionValue={decisionValue}
                        references={references}
                        approvalSessionNoun={approvalSessionNoun}
                    />
                ) : putApprovalDecisions !== null ? (
                    <MessageStreamViewApprovalCardOptions
                        approval={approval}
                        approvalIndex={approvalIndex}
                        references={references}
                        approvalSessionNoun={approvalSessionNoun}
                        putApprovalDecisions={putApprovalDecisions}
                    />
                ) : (
                    <div
                        className={sprinkles({
                            alignSelf: "flex-end",
                            color: lightGreyAccentColor,
                            fontSize: "75",
                        })}
                    >
                        Waiting for approval
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * The decision actions for an undecided approval: a session scope checkbox with a
 * dropdown on the left (only when the approval offers session scoped options) and
 * the "Cancel"/"Allow" buttons on the right. After the user picks an option we
 * keep the picked button in a pending state until the updated approvals part
 * arrives over realtime and the parent renders the decided state instead.
 */
function MessageStreamViewApprovalCardOptions({
    approval,
    approvalIndex,
    references,
    approvalSessionNoun,
    putApprovalDecisions,
}: {
    approval: MessageExperimentalApproval;
    approvalIndex: number;
    references: ContentReferences;
    approvalSessionNoun: MessageStreamApprovalSessionNoun;
    putApprovalDecisions: PutMessageStreamApprovalDecisionsFunction;
}) {
    const accountRegistry = useAccountRegistry();
    const searchEntityRegistry = useSearchEntityRegistry();
    const fileRegistry = useFileRegistry();
    const {locale} = useClientInfo();

    const [pendingButton, setPendingButton] = useState<"Allow" | "Cancel" | null>(null);
    const [isSessionScopeChecked, setIsSessionScopeChecked] = useState(false);
    const [sessionOptionIndex, setSessionOptionIndex] = useState(0);

    const options = approval.decision.schema.options;
    const allowOption = options.find(option => option.type === "Approved");
    const cancelOption = options.find(option => option.type === "Rejected");
    const sessionOptions = options.filter(option => option.type === "ApprovedForSession");

    const sessionOptionLabels = useStore(
        useMemo(
            () =>
                computeStore(get =>
                    sessionOptions.map(option =>
                        getMessageApprovalDecisionOptionLabel(
                            option,
                            locale,
                            approvalSessionNoun,
                            content =>
                                getMessageApprovalContentText(get, references, content, {
                                    accountRegistry,
                                    searchEntityRegistry,
                                    fileRegistry,
                                }),
                        ),
                    ),
                ),
            [
                accountRegistry,
                fileRegistry,
                locale,
                references,
                searchEntityRegistry,
                sessionOptions,
                approvalSessionNoun,
            ],
        ),
    );

    // If the approval only offers session scoped approvals then "Allow" always records
    // the selected session option and the checkbox is just informative.
    const sessionOption = sessionOptions[sessionOptionIndex];
    const willAllowForSession =
        sessionOption !== undefined && (isSessionScopeChecked || allowOption === undefined);

    async function decide(
        option: MessageExperimentalApprovalDecisionOption,
        button: "Allow" | "Cancel",
    ) {
        setPendingButton(button);
        try {
            await putApprovalDecisions([
                {index: approvalIndex, value: getMessageApprovalDecisionValueForOption(option)},
            ]);
        } catch (error) {
            setPendingButton(null);
            throw error;
        }
        // Intentionally leave the pending state set on success! The realtime connection
        // sends the updated approvals part to this client before the procedure resolves,
        // so by now the parent has re-rendered this card in its decided state.
    }

    return (
        <>
            {sessionOptions.length > 0 && (
                <div
                    className={sprinkles({
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5",
                        flexGrow: "1",
                        minWidth: "flex-fit",
                        color: lightGreyAccentColor,
                    })}
                >
                    <Checkbox
                        isChecked={willAllowForSession}
                        isDisabled={pendingButton !== null || allowOption === undefined}
                        onChange={setIsSessionScopeChecked}
                        color="grey-60"
                    >
                        {sessionOptionLabels[sessionOptionIndex]}
                    </Checkbox>
                    {sessionOptions.length > 1 && (
                        <MenuButton
                            actions={sessionOptions.map((option, optionIndex) => ({
                                label: sessionOptionLabels[optionIndex] ?? "",
                                isSelected: optionIndex === sessionOptionIndex,
                                onPress: () => {
                                    setSessionOptionIndex(optionIndex);
                                    setIsSessionScopeChecked(true);
                                },
                            }))}
                        >
                            <IconButton
                                description="More approval options"
                                variant="quietest"
                                size="xs"
                                isDisabled={pendingButton !== null}
                            >
                                <CaretDown />
                            </IconButton>
                        </MenuButton>
                    )}
                </div>
            )}
            {cancelOption && (
                <Button
                    variant="quieter"
                    height="6"
                    paddingX="2"
                    isPending={pendingButton === "Cancel"}
                    isDisabled={pendingButton === "Allow"}
                    pressErrorTitle="Couldn&#x2019;t record approval decision"
                    onPress={() => decide(cancelOption, "Cancel")}
                >
                    Cancel
                </Button>
            )}
            {(allowOption !== undefined || sessionOption !== undefined) && (
                <Button
                    variant="neutral"
                    height="6"
                    paddingX="2"
                    isPending={pendingButton === "Allow"}
                    isDisabled={pendingButton === "Cancel"}
                    pressErrorTitle="Couldn&#x2019;t record approval decision"
                    onPress={() =>
                        decide(
                            willAllowForSession
                                ? assertExists(sessionOption)
                                : assertExists(allowOption),
                            "Allow",
                        )
                    }
                >
                    Allow
                </Button>
            )}
        </>
    );
}

/**
 * The status text for an approval that was decided. For example "Allowed by Cass"
 * or "Canceled by you". Rendered in the same spot as the decision buttons. Only a
 * canceled approval gets an icon: a red "x" to draw attention to the rejection.
 */
function MessageStreamViewApprovalCardDecision({
    approval,
    decisionValue,
    references,
    approvalSessionNoun,
}: {
    approval: MessageExperimentalApproval;
    decisionValue: MessageExperimentalApprovalDecisionValue;
    references: ContentReferences;
    approvalSessionNoun: MessageStreamApprovalSessionNoun;
}) {
    const accountRegistry = useAccountRegistry();
    const searchEntityRegistry = useSearchEntityRegistry();
    const fileRegistry = useFileRegistry();
    const {currentAccount} = useSpaceContext();
    const {locale} = useClientInfo();

    const decisionText = useStore(
        useMemo(
            () =>
                computeStore(get =>
                    getMessageApprovalDecisionValueText(
                        approval,
                        decisionValue,
                        locale,
                        approvalSessionNoun,
                        content =>
                            getMessageApprovalContentText(get, references, content, {
                                accountRegistry,
                                searchEntityRegistry,
                                fileRegistry,
                            }),
                    ),
                ),
            [
                accountRegistry,
                approval,
                decisionValue,
                fileRegistry,
                locale,
                references,
                searchEntityRegistry,
                approvalSessionNoun,
            ],
        ),
    );

    const deciderAccountId = decisionValue.decider.account.id;
    const deciderAccount = references.accountById.get(deciderAccountId);

    let deciderNode: ReactNode = null;
    if (currentAccount !== null && currentAccount.id === deciderAccountId) {
        deciderNode = <> by you</>;
    } else if (deciderAccount) {
        deciderNode = (
            <>
                {" by "}
                <AccountShortName account={deciderAccount} />
            </>
        );
    }

    return (
        <div
            className={sprinkles({
                display: "flex",
                alignItems: "center",
                // Sit on the bottom of the footer row so the text keeps the same distance from the
                // bottom edge of the card as from its right edge.
                alignSelf: "flex-end",
                gap: "1",
                color: lightGreyAccentColor,
                fontSize: "75",
                textAlign: "right",
            })}
        >
            {decisionValue.type === "Rejected" ? (
                <X
                    size={spacing["3"]}
                    color={colorSchemeVars["red-50-const"]}
                    className={sprinkles({flexShrink: "0"})}
                />
            ) : (
                <Check size={spacing["3"]} className={sprinkles({flexShrink: "0"})} />
            )}
            <span>
                {decisionText}
                {deciderNode}
            </span>
        </div>
    );
}

/**
 * The index of the next undecided approval after `currentApprovalIndex`, searching
 * forward and wrapping around. Pass `-1` to find the first undecided approval.
 * Returns null when every approval is decided.
 */
function findNextUndecidedApprovalIndex(
    approvals: ReadonlyArray<MessageExperimentalApproval>,
    currentApprovalIndex: number,
): number | null {
    for (let offset = 1; offset <= approvals.length; offset++) {
        // If the user paginates to the third of three requests, we should wrap around to
        // the first request – that's why we have the modulo operator here.
        const approvalIndex = (currentApprovalIndex + offset) % approvals.length;
        if (assertExists(approvals[approvalIndex]).decision.value === undefined) {
            return approvalIndex;
        }
    }
    return null;
}

function getMessageApprovalDecisionValueForOption(
    option: MessageExperimentalApprovalDecisionOption,
): MessageExperimentalApprovalDecisionValueWithoutDecider {
    switch (option.type) {
        case "Approved":
            return {type: "Approved"};
        case "Rejected":
            return {type: "Rejected"};
        case "ApprovedForSession":
            return {
                type: "ApprovedForSession",
                scope: option.scope,
                durationMinutes: option.durationMinutes,
            };
        default:
            throw exhaustive(option);
    }
}

function getMessageApprovalDecisionOptionLabel(
    option: MessageExperimentalApprovalDecisionOption,
    locale: Locale,
    approvalSessionNoun: MessageStreamApprovalSessionNoun,
    getApprovalContentText: (content: MessageContent) => string,
): string {
    switch (option.type) {
        case "Approved":
            return "Allow";
        case "Rejected":
            return "Cancel";
        case "ApprovedForSession":
            // An example summary would be "all writes"
            const summary = option.summary ? getApprovalContentText(option.summary) : "all writes";

            const duration =
                option.durationMinutes === null
                    ? `for this ${approvalSessionNoun}`
                    : `in this ${approvalSessionNoun} for ${printPrettyNumber(locale, option.durationMinutes, "minute")}`;

            // Based on the duration, this might read
            //
            // 1. "Allow all writes for this chat"
            // 2. "Allow all writes in this chat for 10 minutes"
            return `Allow ${summary} ${duration}`;
        default:
            throw exhaustive(option);
    }
}

function getMessageApprovalDecisionValueText(
    approval: MessageExperimentalApproval,
    decisionValue: MessageExperimentalApprovalDecisionValue,
    locale: Locale,
    approvalSessionNoun: MessageStreamApprovalSessionNoun,
    getApprovalContentText: (content: MessageContent) => string,
): string {
    switch (decisionValue.type) {
        case "Approved":
            return "Allowed";
        case "Rejected":
            return "Canceled";
        case "ApprovedForSession": {
            const selectedOption = approval.decision.schema.options.find(option =>
                isMessageApprovalDecisionValueForOption(option, decisionValue),
            );

            if (selectedOption?.type === "ApprovedForSession" && selectedOption.summary) {
                return getApprovalContentText(selectedOption.summary);
            }

            return decisionValue.durationMinutes === null
                ? `Allowed for this ${approvalSessionNoun}`
                : `Allowed for ${printPrettyNumber(locale, decisionValue.durationMinutes, "minute")}`;
        }
        default:
            throw exhaustive(decisionValue);
    }
}

function getMessageApprovalContentText(
    get: <Value>(store: Store<Value>) => Value,
    references: ContentReferences,
    content: MessageContent,
    options: {
        accountRegistry: AccountRegistry;
        searchEntityRegistry: SearchEntityRegistry;
        fileRegistry: FileRegistry;
    },
): string {
    const contentSnippet = getContentSnippet(content.resolve(0), 0);
    return printContentSingleLineTextSnippetForClient(
        get,
        {doc: contentSnippet, references},
        options,
    );
}
