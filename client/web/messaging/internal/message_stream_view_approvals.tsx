import {CaretDown, CaretLeft, CaretRight, Check, ShieldCheck, SpinnerGap, X} from "phosphor-react";
import prettyMs from "pretty-ms";
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
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {
    addResizeListenerForElement,
    removeResizeListenerForElement,
} from "~/client/web/helpers/use_resize_observer.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {SearchEntityRegistry} from "~/client/web/search/core/search_entity_registry.js";
import {useSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {
    colorSchemeVars,
    contentStyles,
    spinAnimationClassName,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {MessageContent} from "~/shared/content/message_content_schema.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
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
 * How long we keep showing a loading indicator on a fully decided approvals card
 * while we wait for the agent's response to appear.
 *
 * The agent isn't running when a decision lands — deciding wakes it, and it
 * sometimes has to start a container before it can create its response message
 * (see `run_claude_agent_webhook.ts`). So there's a real gap between the last
 * click and the first sign of the agent thinking, and without this the card would
 * just sit there looking finished.
 *
 * This is sort of an arbitrary value. The longest observed time to start a
 * container has been about 6 seconds, but let's call it 10 conservatively.
 *
 * If the agent still hasn't responded after 30 seconds, there's likely a bug in
 * the system somewhere - we shouldn't show loading state forever.
 */
const messageStreamApprovalsResponseTimeoutMs = 30 * 1000;

/**
 * How long the waiting card sits under the overlay before the spinner joins it.
 *
 * Short on purpose. The overlay has to land on the click that settles the batch —
 * anything later reads as the card changing its mind — but a spinner appearing in
 * the same frame would flash for the rare decision the agent answers instantly. So
 * the overlay is immediate and only the spinner is delayed, which is also why this
 * is well under the design system's default loading delay.
 */
const messageStreamApprovalsLoadingIndicatorDelayMs = 200;

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
    isLastMessage,
}: {
    part: MessageStreamExperimentalApprovalsPartPayload;
    references: ContentReferences;
    author: AccountModel;
    approvalSessionNoun: MessageStreamApprovalSessionNoun;
    putApprovalDecisions: PutMessageStreamApprovalDecisionsFunction | null;
    isLastMessage: boolean;
}) {
    const isFullyDecided =
        part.approvals.length > 0 &&
        part.approvals.every(approval => approval.decision.value !== undefined);

    // TODO(ifitzsimmons, 2026-08-18): We don't persist when an approval was decided,
    // so only the client that submits the final decision can know to render this
    // loading state. We should probably persist something like a `decidedTime` for
    // each approval decision and then use the last decided time to determine if we
    // should show the loading state.
    //
    // For now, we'll use `shouldShowLoadingStateAfterApprovalCompletion` to gate the
    // loading state to the current client - it's only ever set to true when the client
    // calls `putApprovalDecisions` with the last decision option.
    const [
        shouldShowLoadingStateAfterApprovalCompletion,
        setShouldShowLoadingStateAfterApprovalCompletion,
    ] = useState(false);
    const isAwaitingResponse =
        shouldShowLoadingStateAfterApprovalCompletion &&
        isFullyDecided &&
        // NOTE(ifitzsimmons, 2026-08-18): We use `isLastMessage` as a deliberate
        // approximation. What the card actually wants to know is "has the agent started
        // its response to the approval decision?", and instead this answers "has anyone
        // sent any message since the approval stream part?". So in a room with other
        // people, someone else posting between the decision and the agent's reply clears
        // the waiting state early. The card settles into its decided form a few seconds
        // sooner than it should.
        //
        // The accurate version isn't reachable from here once any message follows this
        // one, this row stops re-rendering, so it can't observe a later message from the
        // author. It would have to come from the message list, which would have to track
        // "latest message by author" or something like that and thread it down.
        isLastMessage;
    const isLoadingIndicatorVisible = useDelayLoadingIndicator(
        isAwaitingResponse,
        messageStreamApprovalsLoadingIndicatorDelayMs,
    );

    useEffect(() => {
        // `didClientCompleteApprovalDecisions` starts as false, so this `useEffect`
        // returns early after mount.
        if (!shouldShowLoadingStateAfterApprovalCompletion || !isFullyDecided) return;

        if (!isLastMessage) {
            setShouldShowLoadingStateAfterApprovalCompletion(false);
            return;
        }

        const timeout = createTimeout(
            () => setShouldShowLoadingStateAfterApprovalCompletion(false),
            messageStreamApprovalsResponseTimeoutMs,
        );
        return () => timeout.clear();
    }, [isFullyDecided, isLastMessage, shouldShowLoadingStateAfterApprovalCompletion]);

    async function putApprovalDecisionsAndTrackAwaitingResponse(
        decisions: ReadonlyArray<{
            readonly index: number;
            readonly value: MessageExperimentalApprovalDecisionValueWithoutDecider;
        }>,
    ) {
        assert(putApprovalDecisions !== null);

        const willFullyDecideApprovals =
            part.approvals.length > 0 &&
            part.approvals.every(
                (approval, approvalIndex) =>
                    approval.decision.value !== undefined ||
                    decisions.some(decision => decision.index === approvalIndex),
            );

        if (willFullyDecideApprovals) {
            setShouldShowLoadingStateAfterApprovalCompletion(true);
        }

        try {
            await putApprovalDecisions(decisions);
        } catch (error) {
            if (willFullyDecideApprovals) {
                setShouldShowLoadingStateAfterApprovalCompletion(false);
            }
            throw error;
        }
    }

    const trackedPutApprovalDecisions =
        putApprovalDecisions === null ? null : putApprovalDecisionsAndTrackAwaitingResponse;

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
                    putApprovalDecisions={trackedPutApprovalDecisions}
                    isAwaitingResponse={isAwaitingResponse}
                    isLoadingIndicatorVisible={isLoadingIndicatorVisible}
                />
            ) : (
                <MessageStreamViewApprovalsPagination
                    approvals={part.approvals}
                    references={references}
                    author={author}
                    approvalSessionNoun={approvalSessionNoun}
                    putApprovalDecisions={trackedPutApprovalDecisions}
                    isAwaitingResponse={isAwaitingResponse}
                    isLoadingIndicatorVisible={isLoadingIndicatorVisible}
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
    isAwaitingResponse,
    isLoadingIndicatorVisible,
}: {
    approvals: ReadonlyArray<MessageExperimentalApproval>;
    references: ContentReferences;
    author: AccountModel;
    approvalSessionNoun: MessageStreamApprovalSessionNoun;
    putApprovalDecisions: PutMessageStreamApprovalDecisionsFunction | null;
    isAwaitingResponse: boolean;
    isLoadingIndicatorVisible: boolean;
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
            isAwaitingResponse={isAwaitingResponse}
            isLoadingIndicatorVisible={isLoadingIndicatorVisible}
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
                        isDisabled={approvalIndex === 0 || isAwaitingResponse}
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
                        isDisabled={approvalIndex === approvals.length - 1 || isAwaitingResponse}
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
    isAwaitingResponse,
    isLoadingIndicatorVisible,
    paginationNode,
}: {
    approval: MessageExperimentalApproval;
    approvalIndex: number;
    references: ContentReferences;
    author: AccountModel;
    approvalSessionNoun: MessageStreamApprovalSessionNoun;
    putApprovalDecisions: PutMessageStreamApprovalDecisionsFunction | null;
    isAwaitingResponse: boolean;
    isLoadingIndicatorVisible: boolean;
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
                position: "relative",
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
            {/*
             * Everything is decided and we're waiting on the agent (see
             * the response wait in `MessageStreamViewApprovals`). Wash the card out rather than
             * swapping anything for a spinner, so the decision stays readable underneath —
             * the user sees both what they chose and that we're still working. Covering
             * the card also intercepts clicks, which is what we want: there's nothing left
             * to act on until the agent responds.
             *
             * The overlay lands on the click that settled the batch; the spinner follows
             * only once the wait is long enough to be worth reporting. Showing both at once
             * would make the card visibly change twice for one click.
             */}
            {isAwaitingResponse && (
                <div
                    className={sprinkles({
                        position: "absolute",
                        inset: "0",
                        backgroundColor: "grey-0",
                        borderRadius: "1.5",
                        opacity: "60",
                    })}
                />
            )}
            {isLoadingIndicatorVisible && (
                <div
                    className={sprinkles({
                        position: "absolute",
                        inset: "0",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    })}
                >
                    <SpinnerGap
                        className={spinAnimationClassName}
                        size={spacing["5"]}
                        color={colorSchemeVars["grey-50"]}
                    />
                </div>
            )}
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
    const decisionText = useStore(
        useMemo(
            () =>
                computeStore(get =>
                    getMessageApprovalDecisionValueText(
                        approval,
                        decisionValue,
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
                    : `in this ${approvalSessionNoun} for ${prettyMs(
                          option.durationMinutes * 60_000,
                      )}`;

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
                : `Allowed for ${prettyMs(decisionValue.durationMinutes * 60_000)}`;
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
