import {assert} from "~/shared/helpers/control/assert";

/**
 * Immutable object for keeping track of a partially loaded list of messages.
 * You may have segments of loaded messages at the beginning of the list, the
 * end of the list, or randomly throughout the list.
 */
export class PaginatedMessageList<Message extends {readonly id: number}> {
    private readonly _segments: ReadonlyArray<PaginatedMessageListSegment<Message>>;

    private constructor(segments: ReadonlyArray<PaginatedMessageListSegment<Message>>) {
        this._segments = segments;
    }

    private static _empty = new PaginatedMessageList([]);

    /**
     * An empty list.
     */
    public static empty<Message extends {readonly id: number}>(): PaginatedMessageList<Message> {
        return this._empty as any;
    }

    public getSegmentsForTest() {
        assert(typeof jest !== "undefined");
        return this._segments;
    }

    /**
     * Load messages in when paginating from the start of the list.
     */
    public loadFromStart({
        afterMessageId,
        hasMoreMessagesAfter,
        messages,
    }: {
        afterMessageId: number | null;
        hasMoreMessagesAfter: boolean;
        messages: ReadonlyArray<Message>;
    }): PaginatedMessageList<Message> {
        // Special handling when we are loading zero messages. We will not create any
        // new segments but may update our knowledge about segment bounds.
        if (messages.length === 0) {
            if (afterMessageId === null) return this;

            const newSegments = [...this._segments];

            for (let segmentIndex = 0; segmentIndex < newSegments.length; segmentIndex++) {
                const segment = newSegments[segmentIndex]!;
                assert(segment.messages.length > 0);
                const segmentStartMessageId = segment.messages[0]!.id;
                const segmentEndMessageId = segment.messages[segment.messages.length - 1]!.id;
                assert(segmentStartMessageId <= segmentEndMessageId);

                // Every segment from here on will have greater message IDs than
                // `afterMessageId` so end iteration.
                if (afterMessageId < segmentStartMessageId) break;

                // If we loaded after this segment and got no messages then we definitely know
                // what the value of `hasMoreMessagesAfter` is.
                if (afterMessageId === segmentEndMessageId) {
                    newSegments[segmentIndex] = {
                        ...segment,
                        mayHaveMoreMessagesAfter: hasMoreMessagesAfter,
                    };
                    break;
                }
            }

            return new PaginatedMessageList(newSegments);
        }

        // If no `afterMessageId` was provided then we are loading from the start of
        // the list. The minimum message ID is 1.
        const mayHaveMoreMessagesBefore = afterMessageId !== null;
        afterMessageId ??= 0;

        // Validate that our messages are in ascending ID order and that there are no
        // duplicates.
        for (let i = 0; i < messages.length; i++) {
            const message = messages[i]!;
            const lastMessageId = i > 0 ? messages[i - 1]!.id : afterMessageId;
            assert(lastMessageId < message.id);
        }

        const endMessageId = messages[messages.length - 1]!.id;
        const newSegments = [...this._segments];
        let updatedSegmentIndex: number | null = null;

        for (let segmentIndex = 0; segmentIndex < newSegments.length; segmentIndex++) {
            const segment = newSegments[segmentIndex]!;
            assert(segment.messages.length > 0);
            const segmentStartMessageId = segment.messages[0]!.id;
            const segmentEndMessageId = segment.messages[segment.messages.length - 1]!.id;
            assert(segmentStartMessageId <= segmentEndMessageId);

            // If we did not overlap with any previous segments and will never overlap with
            // future segments, then we need to insert a new segment with our messages at
            // this point.
            if (endMessageId < segmentStartMessageId) {
                newSegments.splice(segmentIndex, 0, {
                    messages,
                    mayHaveMoreMessagesBefore,
                    mayHaveMoreMessagesAfter: hasMoreMessagesAfter,
                });
                updatedSegmentIndex = segmentIndex;

                // If there are no more messages after this one, then delete all segments that
                // come after this one.
                if (!hasMoreMessagesAfter) {
                    newSegments.splice(segmentIndex + 1, newSegments.length - (segmentIndex + 1));
                }
                break;
            }

            // If our loaded data overlaps with an existing segment then we want to merge
            // our new data into that segment. Either growing the segment or replacing
            // messages which already exist.
            if (
                areRangesOverlapping(
                    afterMessageId,
                    endMessageId,
                    segmentStartMessageId,
                    segmentEndMessageId,
                )
            ) {
                newSegments[segmentIndex] = {
                    messages: replaceMessages(
                        segment.messages,
                        messages,
                        afterMessageId + 1,
                        hasMoreMessagesAfter
                            ? endMessageId
                            : // If there are no messages after this one, drop messages in the segment until
                              // the end of the segment.
                              Math.max(endMessageId, segmentEndMessageId),
                    ),
                    mayHaveMoreMessagesBefore:
                        segmentStartMessageId < afterMessageId + 1
                            ? segment.mayHaveMoreMessagesBefore
                            : mayHaveMoreMessagesBefore,
                    mayHaveMoreMessagesAfter:
                        hasMoreMessagesAfter && segmentEndMessageId > endMessageId
                            ? segment.mayHaveMoreMessagesAfter
                            : hasMoreMessagesAfter,
                };
                updatedSegmentIndex = segmentIndex;

                // If there are no more messages after this one, then delete all segments that
                // come after this one.
                if (!hasMoreMessagesAfter) {
                    newSegments.splice(segmentIndex + 1, newSegments.length - (segmentIndex + 1));
                }
                break;
            }
        }

        // If while looping over our segments we did not find a place to load our
        // messages then we need to add a new segment at the end.
        if (updatedSegmentIndex === null) {
            newSegments.push({
                messages,
                mayHaveMoreMessagesBefore,
                mayHaveMoreMessagesAfter: hasMoreMessagesAfter,
            });
        } else if (updatedSegmentIndex < newSegments.length - 1) {
            const updatedSegment = newSegments[updatedSegmentIndex]!;
            const afterUpdatedSegment = newSegments[updatedSegmentIndex + 1]!;

            // If we updated our segment so that it's adjacent to the segment after it then
            // merge the two segments together.
            if (
                updatedSegment.messages[updatedSegment.messages.length - 1]!.id + 1 ===
                afterUpdatedSegment.messages[0]!.id
            ) {
                newSegments.splice(updatedSegmentIndex, 2, {
                    messages: updatedSegment.messages.concat(afterUpdatedSegment.messages),
                    mayHaveMoreMessagesBefore: updatedSegment.mayHaveMoreMessagesBefore,
                    mayHaveMoreMessagesAfter: afterUpdatedSegment.mayHaveMoreMessagesAfter,
                });
            }
        }

        return new PaginatedMessageList(newSegments);
    }

    /**
     * Load messages in when paginating from the end of the list.
     */
    public loadFromEnd({
        beforeMessageId,
        hasMoreMessagesBefore,
        messages,
    }: {
        beforeMessageId: number | null;
        hasMoreMessagesBefore: boolean;
        messages: ReadonlyArray<Message>;
    }) {
        // Special handling when we are loading zero messages. We will not create any
        // new segments but may update our knowledge about segment bounds.
        if (messages.length === 0) {
            if (beforeMessageId === null) return this;

            const newSegments = [...this._segments];

            for (let segmentIndex = 0; segmentIndex < newSegments.length; segmentIndex++) {
                const segment = newSegments[segmentIndex]!;
                assert(segment.messages.length > 0);
                const segmentStartMessageId = segment.messages[0]!.id;
                const segmentEndMessageId = segment.messages[segment.messages.length - 1]!.id;
                assert(segmentStartMessageId <= segmentEndMessageId);

                // If we loaded before this segment and got no messages then we definitely know
                // what the value of `hasMoreMessagesBefore` is.
                if (beforeMessageId === segmentStartMessageId) {
                    newSegments[segmentIndex] = {
                        ...segment,
                        mayHaveMoreMessagesBefore: hasMoreMessagesBefore,
                    };
                    break;
                }

                // Every segment from here on will have greater message IDs than
                // `beforeMessageId` so end iteration.
                if (beforeMessageId < segmentEndMessageId) break;
            }

            return new PaginatedMessageList(newSegments);
        }

        // If no `beforeMessageId` was provided then we are loading from the start of
        // the list. The maximum message ID is the JavaScript safe integer max.
        const mayHaveMoreMessagesAfter = beforeMessageId !== null;
        beforeMessageId ??= Number.MAX_SAFE_INTEGER;

        // Validate that our messages are in ascending ID order and that there are no
        // duplicates.
        for (let i = 0; i < messages.length; i++) {
            const message = messages[i]!;
            const nextMessageId = i < messages.length - 1 ? messages[i + 1]!.id : beforeMessageId;
            assert(message.id < nextMessageId);
        }

        const startMessageId = messages[0]!.id;
        const newSegments = [...this._segments];
        let updatedSegmentIndex: number | null = null;

        for (let segmentIndex = 0; segmentIndex < newSegments.length; segmentIndex++) {
            const segment = newSegments[segmentIndex]!;
            assert(segment.messages.length > 0);
            const segmentStartMessageId = segment.messages[0]!.id;
            const segmentEndMessageId = segment.messages[segment.messages.length - 1]!.id;
            assert(segmentStartMessageId <= segmentEndMessageId);

            // If we did not overlap with any previous segments and will never overlap with
            // future segments, then we need to insert a new segment with our messages at
            // this point.
            if (beforeMessageId < segmentStartMessageId) {
                newSegments.splice(segmentIndex, 0, {
                    messages,
                    mayHaveMoreMessagesBefore: hasMoreMessagesBefore,
                    mayHaveMoreMessagesAfter,
                });
                updatedSegmentIndex = segmentIndex;

                // If there are no more messages before this one, then delete all segments that
                // come before this one.
                if (!hasMoreMessagesBefore) {
                    newSegments.splice(0, segmentIndex);
                    updatedSegmentIndex = 0;
                }
                break;
            }

            // If our loaded data overlaps with an existing segment then we want to merge
            // our new data into that segment. Either growing the segment or replacing
            // messages which already exist.
            if (
                areRangesOverlapping(
                    startMessageId,
                    beforeMessageId,
                    segmentStartMessageId,
                    segmentEndMessageId,
                )
            ) {
                newSegments[segmentIndex] = {
                    messages: replaceMessages(
                        segment.messages,
                        messages,
                        hasMoreMessagesBefore
                            ? startMessageId
                            : // If there are no messages before this one, drop messages in the segment from
                              // the start of the segment until the end of our new messages.
                              Math.min(startMessageId, segmentStartMessageId),
                        beforeMessageId - 1,
                    ),
                    mayHaveMoreMessagesBefore:
                        hasMoreMessagesBefore && segmentStartMessageId < startMessageId
                            ? segment.mayHaveMoreMessagesBefore
                            : hasMoreMessagesBefore,
                    mayHaveMoreMessagesAfter:
                        segmentEndMessageId > beforeMessageId - 1
                            ? segment.mayHaveMoreMessagesAfter
                            : mayHaveMoreMessagesAfter,
                };
                updatedSegmentIndex = segmentIndex;

                // If there are no more messages before this one, then delete all segments that
                // come before this one.
                if (!hasMoreMessagesBefore) {
                    newSegments.splice(0, segmentIndex);
                    updatedSegmentIndex = 0;
                }
                break;
            }
        }

        // If while looping over our segments we did not find a place to load our
        // messages then we need to add a new segment at the end.
        if (updatedSegmentIndex === null) {
            newSegments.push({
                messages,
                mayHaveMoreMessagesBefore: hasMoreMessagesBefore,
                mayHaveMoreMessagesAfter,
            });

            if (!hasMoreMessagesBefore) {
                newSegments.splice(0, newSegments.length - 1);
            }
        } else if (updatedSegmentIndex > 0) {
            const updatedSegment = newSegments[updatedSegmentIndex]!;
            const beforeUpdatedSegment = newSegments[updatedSegmentIndex - 1]!;

            // If we updated our segment so that it's adjacent to the segment before it then
            // merge the two segments together.
            if (
                beforeUpdatedSegment.messages[beforeUpdatedSegment.messages.length - 1]!.id + 1 ===
                updatedSegment.messages[0]!.id
            ) {
                newSegments.splice(updatedSegmentIndex - 1, 2, {
                    messages: beforeUpdatedSegment.messages.concat(updatedSegment.messages),
                    mayHaveMoreMessagesBefore: beforeUpdatedSegment.mayHaveMoreMessagesBefore,
                    mayHaveMoreMessagesAfter: updatedSegment.mayHaveMoreMessagesAfter,
                });
            }
        }

        return new PaginatedMessageList(newSegments);
    }
}

export type PaginatedMessageListSegment<Message extends {readonly id: number}> = {
    /**
     * A non-empty array of messages.
     */
    readonly messages: ReadonlyArray<Message>;
    /**
     * May there be more unloaded messages between this segment and the previous
     * segment?
     *
     * If `false` then the answer is definitely not. If `true` then the answer is
     * maybe, we'll have to issue a load request to find out.
     *
     * If there is a previous segment, this should be `true`. Because if there were
     * no messages between the segments then we should merge into one segment.
     */
    readonly mayHaveMoreMessagesBefore: boolean;
    /**
     * May there be more unloaded messages between this segment and the next
     * segment?
     *
     * If `false` then the answer is definitely not. If `true` then the answer is
     * maybe, we'll have to issue a load request to find out.
     *
     * If there is a next segment, this should be `true`. Because if there were
     * no messages between the segments then we should merge into one segment.
     */
    readonly mayHaveMoreMessagesAfter: boolean;
};

/**
 * Replaces a range of messages in the first array with the second array.
 * Assumes both arrays are sorted by ID.
 */
function replaceMessages<Message extends {readonly id: number}>(
    oldMessages: ReadonlyArray<Message>,
    newMessages: ReadonlyArray<Message>,
    newStartMessageId: number,
    newEndMessageId: number,
): ReadonlyArray<Message> {
    assert(newStartMessageId <= newEndMessageId);

    const messages: Array<Message> = [];

    let hasInsertedNewMessages = false;

    for (let oldMessageIndex = 0; oldMessageIndex < oldMessages.length; oldMessageIndex++) {
        const oldMessage = oldMessages[oldMessageIndex]!;

        if (newStartMessageId <= oldMessage.id && !hasInsertedNewMessages) {
            hasInsertedNewMessages = true;
            for (const newMessage of newMessages) messages.push(newMessage);
        }

        // Keep all old messages that don't fall in the new message range. New messages
        // with the same ID replace old messages. If the new message range is missing a
        // message ID that means it was deleted.
        if (!(newStartMessageId <= oldMessage.id && oldMessage.id <= newEndMessageId)) {
            messages.push(oldMessage);
        }
    }

    // If we did not find a spot to insert our new messages then insert them at
    // the end.
    if (!hasInsertedNewMessages) {
        hasInsertedNewMessages = true;
        for (const newMessage of newMessages) messages.push(newMessage);
    }

    return messages;
}

// https://stackoverflow.com/questions/3269434/whats-the-most-efficient-way-to-test-if-two-ranges-overlap
function areRangesOverlapping(start1: number, end1: number, start2: number, end2: number) {
    assert(start1 <= end1);
    assert(start2 <= end2);
    return start1 <= end2 && end1 >= start2;
}
