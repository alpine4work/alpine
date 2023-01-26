import binarySearch from "binary-search";
import {OutOfRangeError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {Lazy} from "~/shared/helpers/control/lazy";
import {LazyMap} from "~/shared/helpers/control/lazy_map";

/**
 * The smallest possible message ID.
 */
export const minMessageId = 1;

/**
 * The largest possible message ID.
 */
export const maxMessageId = Number.MAX_SAFE_INTEGER - 1;

/**
 * Immutable object for keeping track of a partially loaded list of messages.
 * You may have segments of loaded messages at the beginning of the list, the
 * end of the list, or randomly throughout the list.
 *
 * Takes advantage of the fact that message IDs are dense to predict how big
 * the gap is between message ranges.
 */
export class PaginatedMessageList<Message extends {readonly id: number}> {
    private readonly _segments: ReadonlyArray<PaginatedMessageListSegment<Message>>;

    private constructor(segments: ReadonlyArray<PaginatedMessageListSegment<Message>>) {
        // Validate that our segments are well-formed:
        //
        // 1. Messages should be in ascending order by ID
        // 2. Segments should be in ascending order by message ID
        // 3. You can not have adjacent loaded segments and you can not have adjacent
        //    unloaded segments
        // 4. A loaded or unloaded segment must have at least one message
        let lastMessageId: number | null = null;
        for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
            const segment = segments[segmentIndex]!;
            const lastSegment = segmentIndex > 0 ? segments[segmentIndex - 1]! : null;

            if (!segment.isLoaded) {
                assert(
                    segment.estimatedMessageCount > 0,
                    "Unloaded segment has an estimated message count of zero",
                );
                assert(
                    !lastSegment || lastSegment.isLoaded,
                    "Can not have adjacent unloaded segments",
                );
            } else {
                assert(segment.messages.length > 0, "Loaded segment has no messages");
                assert(
                    !lastSegment || !lastSegment.isLoaded,
                    "Can not have adjacent loaded segments",
                );

                // In development, we iterate over every message in the segment to make sure
                // IDs are in ascending order. Since this is expensive at O(messages), in
                // production we only validate the first and last message ID.
                if (process.env.NODE_ENV !== "production") {
                    for (const message of segment.messages) {
                        assert(
                            lastMessageId === null || lastMessageId < message.id,
                            "Messages must be in ascending order by `id`",
                        );
                        lastMessageId = message.id;
                    }
                } else {
                    const startMessageId = segment.messages[0]!.id;
                    const endMessageId = segment.messages[segment.messages.length - 1]!.id;

                    assert(
                        lastMessageId === null || lastMessageId < startMessageId,
                        "Messages must be in ascending order by `id`",
                    );
                    assert(
                        startMessageId <= endMessageId,
                        "Messages must be in ascending order by `id`",
                    );
                    lastMessageId = endMessageId;
                }
            }
        }

        this._segments = segments;
    }

    /**
     * Create a new empty list.
     */
    public static new<Message extends {readonly id: number}>(
        estimatedMessageCount: number,
    ): PaginatedMessageList<Message> {
        return new PaginatedMessageList(
            estimatedMessageCount > 0 ? [{isLoaded: false, estimatedMessageCount}] : [],
        );
    }

    public static newForTest<Message extends {readonly id: number}>(
        segments: ReadonlyArray<PaginatedMessageListSegment<Message>>,
    ) {
        assert(typeof jest !== "undefined");
        return new PaginatedMessageList(segments);
    }

    public getSegmentsForTest() {
        assert(typeof jest !== "undefined");
        return this._segments;
    }

    // It's expensive to iterate over every item so for now we only allow iteration
    // in tests.
    public *iterateMessagesForTest(): IterableIterator<{index: number; message: Message}> {
        assert(typeof jest !== "undefined");

        let messageCount = 0;
        for (const segment of this._segments) {
            if (segment.isLoaded) {
                for (let index = 0; index < segment.messages.length; index++) {
                    yield {
                        index: messageCount + index,
                        message: segment.messages[index]!,
                    };
                }
                messageCount += segment.messages.length;
            } else {
                messageCount += segment.estimatedMessageCount;
            }
        }
    }

    /**
     * Get the total estimated message count for this list.
     *
     * O(segments) the first time you call this function and then it is cached
     * after that.
     */
    public getEstimatedMessageCount(): number {
        return this._estimatedMessageCount.get();
    }

    private readonly _estimatedMessageCount = new Lazy(() => {
        let estimatedMessageCount = 0;

        for (const segment of this._segments) {
            if (segment.isLoaded) {
                estimatedMessageCount += segment.messages.length;
            } else {
                estimatedMessageCount += segment.estimatedMessageCount;
            }
        }

        return estimatedMessageCount;
    });

    /**
     * Get the message at the provided index. Returns null if the message is
     * not loaded.
     *
     * Will throw an `OutOfRangeError` if index is less than 0 or greater than
     * `getEstimatedMessageCount() - 1`.
     *
     * O(segments) the first time you call this function for an `index` and then
     * the message at that index is cached after that.
     */
    public getMessage(index: number): {isLoaded: true; message: Message} | {isLoaded: false} {
        return this._messageByIndex.get(index);
    }

    private readonly _messageByIndex = new LazyMap<
        number,
        {isLoaded: true; message: Message} | {isLoaded: false}
    >(index => {
        if (index < 0) throw new OutOfRangeError("Index out of bounds");

        for (const segment of this._segments) {
            if (segment.isLoaded) {
                if (index < segment.messages.length) {
                    return {isLoaded: true, message: segment.messages[index]!};
                } else {
                    index -= segment.messages.length;
                }
            } else {
                if (index < segment.estimatedMessageCount) {
                    return {isLoaded: false};
                } else {
                    index -= segment.estimatedMessageCount;
                }
            }
        }

        throw new OutOfRangeError("Index out of bounds");
    });

    /**
     * Get the index for a given message ID in the list. If the message ID is not
     * found in the list we return null.
     */
    public getIndexByMessageId(messageId: number): number | null {
        let messageCount = 0;
        for (const segment of this._segments) {
            if (segment.isLoaded) {
                const segmentStartMessageId = segment.messages[0]!.id;
                const segmentEndMessageId = segment.messages[segment.messages.length - 1]!.id;

                // If the message is within this segment then search through the messages of
                // the segment to find the specific index.
                if (segmentStartMessageId <= messageId && messageId <= segmentEndMessageId) {
                    const index = binarySearch(
                        segment.messages,
                        messageId,
                        (message, messageId) => message.id - messageId,
                    );
                    if (index < 0) return null;
                    return messageCount + index;
                }

                // All future segments will not include the `messageId` so abort.
                if (messageId < segmentStartMessageId) return null;

                messageCount += segment.messages.length;
            } else {
                messageCount += segment.estimatedMessageCount;
            }
        }

        return null;
    }

    /**
     * Get the first loaded message after the provided index. If there is no loaded
     * message after the provided index we return null. Throws an error if the
     * index is out of bounds.
     *
     * - If the index is loaded and the next index is loaded then return the next
     *   message.
     * - If the index is loaded and the next index is unloaded then return the
     *   first loaded message after the unloaded segment (or null if there is none).
     * - If the index is unloaded then return the first loaded message after the
     *   unloaded segment (or null if there is none).
     *
     * O(segments) time. This method is not cached.
     */
    public getFirstLoadedMessageAfter(index: number): {index: number; message: Message} | null {
        if (index < 0 || index > this.getEstimatedMessageCount() - 1)
            throw new OutOfRangeError("Index out of bounds");

        // We want to find the message before, not the `index` message precisely.
        index += 1;

        let messageCount = 0;
        for (const segment of this._segments) {
            if (segment.isLoaded) {
                if (index < segment.messages.length) {
                    return {
                        index: messageCount + index,
                        message: segment.messages[index]!,
                    };
                } else {
                    index -= segment.messages.length;
                }
                messageCount += segment.messages.length;
            } else {
                if (index < segment.estimatedMessageCount) {
                    // Return the first message in the next loaded segment.
                    index = 0;
                } else {
                    index -= segment.estimatedMessageCount;
                }
                messageCount += segment.estimatedMessageCount;
            }
        }

        return null;
    }

    /**
     * Get the last loaded message before the provided index. If there is no loaded
     * message before the provided index we return null. Throws an error if the
     * index is out of bounds.
     *
     * - If the index is loaded and the previous index is loaded then return the
     *   previous message.
     * - If the index is loaded and the previous index is unloaded then return the
     *   last loaded message before the unloaded segment (or null if there is none).
     * - If the index is unloaded then return the last loaded message before
     *   the unloaded segment (or null if there is none).
     *
     * O(segments) time. This method is not cached.
     */
    public getLastLoadedMessageBefore(index: number): {index: number; message: Message} | null {
        if (index < 0 || index > this.getEstimatedMessageCount() - 1)
            throw new OutOfRangeError("Index out of bounds");

        if (index === 0) return null;

        // We want to find the message before, not the `index` message precisely.
        index -= 1;

        let messageCount = 0;
        let lastMessage: {index: number; message: Message} | null = null;
        for (const segment of this._segments) {
            if (segment.isLoaded) {
                if (index < segment.messages.length) {
                    return {
                        index: messageCount + index,
                        message: segment.messages[index]!,
                    };
                } else {
                    index -= segment.messages.length;
                    lastMessage = {
                        index: messageCount + segment.messages.length - 1,
                        message: segment.messages[segment.messages.length - 1]!,
                    };
                }
                messageCount += segment.messages.length;
            } else {
                if (index < segment.estimatedMessageCount) {
                    // Return the last message in the previously loaded segment.
                    return lastMessage;
                } else {
                    index -= segment.estimatedMessageCount;
                }
                messageCount += segment.estimatedMessageCount;
            }
        }

        return null;
    }

    /**
     * Load messages into the paginated list. Filling in more of the partially
     * loaded list or replacing a range of messages that already exists.
     */
    public loadMessages({
        afterMessageId,
        beforeMessageId,
        mayHaveMoreMessagesBefore,
        mayHaveMoreMessagesAfter,
        messages,
    }: {
        /**
         * All loaded messages IDs come after this ID. Must be less than the first
         * message ID.
         *
         * We assume the provided `messages` list is all the messages between this and
         * `beforeMessageId` IDs. If you are loading messages that had a limit applied,
         * you should set this to +1 the ID of the message at the limit.
         */
        afterMessageId: number;
        /**
         * All loaded messages IDs come before this ID. Must be greater than the last
         * message ID.
         *
         * We assume the provided `messages` list is all the messages between this and
         * `afterMessageId` IDs. If you are loading messages that had a limit applied,
         * you should set this to +1 the ID of the message at the limit.
         */
        beforeMessageId: number;
        /**
         * May there be more messages before the ones we loaded? If true there may be
         * messages but also maybe not. If false then there are definitely no more
         * messages before these.
         */
        mayHaveMoreMessagesBefore: boolean;
        /**
         * May there be more messages after the ones we loaded? If true there may be
         * messages but also maybe not. If false then there are definitely no more
         * messages after these.
         */
        mayHaveMoreMessagesAfter: boolean;
        /**
         * The message data to load.
         */
        messages: ReadonlyArray<Message>;
    }) {
        // Validate the messages we are loading.
        let lastMessageId = afterMessageId;
        for (let index = 0; index < messages.length; index++) {
            const message = messages[index]!;
            assert(
                lastMessageId < message.id,
                index === 0
                    ? "`afterMessageId` must be before the first message `id`"
                    : "Newly loaded messages must be in ascending order by `id`",
            );
            assert(
                minMessageId <= message.id && message.id <= maxMessageId,
                "Message `id` is out of bounds",
            );
            lastMessageId = message.id;
        }
        assert(
            lastMessageId < beforeMessageId,
            messages.length > 0
                ? "`beforeMessageId` must be after the last message `id`"
                : "`beforeMessageId` must be after `lastMessageId`",
        );

        // There are two ways this function may update update the list:
        //
        // 1. `mergeWithExistingLoadedSegments()`: If the messages we are loading
        //    overlap at all with existing messages in the list then we will merge our
        //    newly loaded messages with existing loaded messages. We may merge
        //    with just one segment or we may be merging multiple segments
        //    together.
        //
        // 2. `insertNewLoadedSegment()`: If our messages don't overlap with any
        //    existing messages then we insert a new loaded segment somewhere in the
        //    list. Splitting an unloaded segment in two.

        const mergeWithExistingLoadedSegments = (
            startIndex: number,
            endIndex: number,
            lastUnloadedSegment: PaginatedMessageListUnloadedSegment | null,
            loadedSegments: Array<PaginatedMessageListLoadedSegment<Message>>,
            nextUnloadedSegment: PaginatedMessageListUnloadedSegment | null,
        ) => {
            assert(loadedSegments.length > 0);
            const firstLoadedSegment = loadedSegments[0]!;
            const lastLoadedSegment = loadedSegments[loadedSegments.length - 1]!;
            const loadedSegmentsStartMessageId = firstLoadedSegment.messages[0]!.id;
            const loadedSegmentsEndMessageId =
                lastLoadedSegment.messages[lastLoadedSegment.messages.length - 1]!.id;

            const segmentMessages = [];

            // Count of newly loaded messages that fall outside of our existing
            // loaded segments.
            let newMessageCountBeforeLoadedSegments = 0;
            let newMessageCountAfterLoadedSegments = 0;

            const newMessageIds = new Set<number>();

            // This message should be called once at the position we want to insert our
            // messages into `segmentMessages`.
            let hasInsertedNewMessages = false;
            const insertNewMessages = () => {
                assert(!hasInsertedNewMessages);
                hasInsertedNewMessages = true;

                for (const message of messages) {
                    newMessageIds.add(message.id);

                    if (message.id < loadedSegmentsStartMessageId)
                        newMessageCountBeforeLoadedSegments++;
                    if (loadedSegmentsEndMessageId < message.id)
                        newMessageCountAfterLoadedSegments++;

                    segmentMessages.push(message);
                }
            };

            for (let segmentIndex = 0; segmentIndex < loadedSegments.length; segmentIndex++) {
                const segment = loadedSegments[segmentIndex]!;
                for (const message of segment.messages) {
                    // Insert new messages before the first existing message that could be after our
                    // new messages.
                    if (afterMessageId < message.id && !hasInsertedNewMessages) {
                        insertNewMessages();
                    }

                    // If this message is outside our newly loaded message range (`afterMessageId`
                    // to `beforeMessageId`) then add it to the new merged segment's messages.
                    if (
                        (mayHaveMoreMessagesBefore && message.id <= afterMessageId) ||
                        (mayHaveMoreMessagesAfter && beforeMessageId <= message.id)
                    ) {
                        segmentMessages.push(message);
                    }
                }
            }

            if (!hasInsertedNewMessages) {
                insertNewMessages();
            }

            const newSegments: Array<PaginatedMessageListSegment<Message>> = [];

            if (mayHaveMoreMessagesBefore) {
                // Copy the existing segments before this one...
                for (const segment of this._segments.slice(0, startIndex))
                    newSegments.push(segment);

                // If we have new messages before the existing segment then subtract that new
                // message count from the previous estimated count. We must always estimate at
                // least 1 message since there may be more messages before, we don't know.
                if (newMessageCountBeforeLoadedSegments > 0) {
                    newSegments.push({
                        isLoaded: false,
                        estimatedMessageCount: Math.max(
                            1,
                            (lastUnloadedSegment?.estimatedMessageCount ?? 0) -
                                newMessageCountBeforeLoadedSegments,
                        ),
                    });
                } else {
                    if (lastUnloadedSegment) newSegments.push(lastUnloadedSegment);
                }
            }

            // Add the new, merged, segment.
            newSegments.push({
                isLoaded: true,
                messages: segmentMessages,
            });

            if (mayHaveMoreMessagesAfter) {
                // If we have new messages after the existing segment then subtract that new
                // message count from the next estimated count. We must always estimate at
                // least 1 message since there may be more messages after, we don't know.
                if (newMessageCountAfterLoadedSegments > 0) {
                    newSegments.push({
                        isLoaded: false,
                        estimatedMessageCount: Math.max(
                            1,
                            (nextUnloadedSegment?.estimatedMessageCount ?? 0) -
                                newMessageCountAfterLoadedSegments,
                        ),
                    });
                } else {
                    if (nextUnloadedSegment) newSegments.push(nextUnloadedSegment);
                }

                // Copy the existing segments after this one...
                for (const segment of this._segments.slice(endIndex + 1)) newSegments.push(segment);
            }

            return new PaginatedMessageList(newSegments);
        };

        const insertNewLoadedSegment = (
            startIndex: number,
            endIndex: number,
            lastLoadedSegment: PaginatedMessageListLoadedSegment<Message> | null,
            unloadedSegment: PaginatedMessageListUnloadedSegment | null,
            nextLoadedSegment: PaginatedMessageListLoadedSegment<Message> | null,
        ) => {
            // Get the start and end of our unloaded segment. If there is no end we assume
            // the end is the start `id` plus the estimated message count. This leverages
            // the fact that message list `id`s are mostly dense. However deleted messages
            // might mean this is an underestimation of the unloaded segment's end.
            const unloadedSegmentStartMessageId = lastLoadedSegment
                ? lastLoadedSegment.messages[lastLoadedSegment.messages.length - 1]!.id
                : minMessageId - 1;
            const unloadedSegmentEndMessageId = nextLoadedSegment
                ? nextLoadedSegment.messages[0]!.id
                : unloadedSegment
                ? Math.max(
                      unloadedSegmentStartMessageId + unloadedSegment.estimatedMessageCount,
                      beforeMessageId + 1,
                  )
                : maxMessageId + 1;

            assert(unloadedSegmentStartMessageId <= afterMessageId);
            assert(beforeMessageId <= unloadedSegmentEndMessageId);

            // We split the unloaded segment into two and insert a loaded segment in the
            // middle. Each of the split unloaded segments must have a message count of at
            // least 1 since we don't know if there are messages between the new segment
            // and adjacent loaded segments.
            //
            // We take the existing estimated message count and subtract our message
            // length. We allocate the remaining estimated message count proportionally to
            // message `id` magnitude. This takes advantage of the fact that message `id`s
            // are mostly dense. A message with `id` 12 and a message with `id` 32 will
            // most of the time have 20 messages in between them unless a message was
            // deleted which is uncommon.

            const estimatedMessageCount = unloadedSegment?.estimatedMessageCount ?? 0;
            const remainingEstimatedMessageCount = Math.max(
                0,
                estimatedMessageCount - messages.length,
            );

            const messageIdFraction1 =
                (afterMessageId - unloadedSegmentStartMessageId) /
                (unloadedSegmentEndMessageId - unloadedSegmentStartMessageId);
            const messageIdFraction2 =
                (unloadedSegmentEndMessageId - beforeMessageId) /
                (unloadedSegmentEndMessageId - unloadedSegmentStartMessageId);

            const estimatedBeforeMessageCount = Math.max(
                1,
                Math.round(
                    (messageIdFraction1 / (messageIdFraction1 + messageIdFraction2)) *
                        remainingEstimatedMessageCount,
                ),
            );
            const estimatedAfterMessageCount = Math.max(
                1,
                Math.round(
                    (messageIdFraction2 / (messageIdFraction1 + messageIdFraction2)) *
                        remainingEstimatedMessageCount,
                ),
            );

            const newSegments: Array<PaginatedMessageListSegment<Message>> = [];

            if (mayHaveMoreMessagesBefore) {
                // Copy the existing segments before this one...
                for (const segment of this._segments.slice(0, startIndex))
                    newSegments.push(segment);

                if (lastLoadedSegment) newSegments.push(lastLoadedSegment);
            }

            if (messages.length > 0) {
                if (mayHaveMoreMessagesBefore) {
                    // Add the first half of the split unloaded segment.
                    newSegments.push({
                        isLoaded: false,
                        estimatedMessageCount: estimatedBeforeMessageCount,
                    });
                }

                // Add the newly inserted loaded segment.
                newSegments.push({
                    isLoaded: true,
                    messages,
                });

                if (mayHaveMoreMessagesAfter) {
                    // Add the second half of the split unloaded segment.
                    newSegments.push({
                        isLoaded: false,
                        estimatedMessageCount: estimatedAfterMessageCount,
                    });
                }
            } else {
                if (mayHaveMoreMessagesBefore || mayHaveMoreMessagesAfter) {
                    newSegments.push({
                        isLoaded: false,
                        estimatedMessageCount:
                            (mayHaveMoreMessagesBefore ? estimatedBeforeMessageCount : 0) +
                            (mayHaveMoreMessagesAfter ? estimatedAfterMessageCount : 0),
                    });
                }
            }

            if (mayHaveMoreMessagesAfter) {
                if (nextLoadedSegment) newSegments.push(nextLoadedSegment);

                // Copy the existing segments after this one...
                for (const segment of this._segments.slice(endIndex + 1)) newSegments.push(segment);
            }

            return new PaginatedMessageList(newSegments);
        };

        for (let segmentIndex = 0; segmentIndex < this._segments.length; segmentIndex++) {
            const segment = this._segments[segmentIndex]!;
            if (!segment.isLoaded) continue;
            const segmentStartMessageId = segment.messages[0]!.id;
            const segmentEndMessageId = segment.messages[segment.messages.length - 1]!.id;

            // If we are at this point it means our newly loaded messages did not overlap
            // with any previous segment. If this condition is true then that means our
            // newly loaded messages also will not overlap with any future segment. That
            // means we should insert a new segment here.
            //
            // Figure out what our adjacent segments are and insert...
            if (beforeMessageId < segmentStartMessageId) {
                if (segmentIndex >= 2) {
                    const lastLoadedSegment = this._segments[segmentIndex - 2]!;
                    assert(lastLoadedSegment.isLoaded);

                    const lastUnloadedSegment = this._segments[segmentIndex - 1]!;
                    assert(!lastUnloadedSegment.isLoaded);

                    return insertNewLoadedSegment(
                        segmentIndex - 2,
                        segmentIndex,
                        lastLoadedSegment,
                        lastUnloadedSegment,
                        segment,
                    );
                } else if (segmentIndex === 1) {
                    const lastUnloadedSegment = this._segments[segmentIndex - 1]!;
                    assert(!lastUnloadedSegment.isLoaded);

                    return insertNewLoadedSegment(
                        segmentIndex - 1,
                        segmentIndex,
                        null,
                        lastUnloadedSegment,
                        segment,
                    );
                } else {
                    assert(segmentIndex === 0);
                    return insertNewLoadedSegment(segmentIndex, segmentIndex, null, null, segment);
                }
            }

            // If our newly loaded messages overlap with this segment then find all
            // contiguous loaded segments overlapping with our newly loaded messages and
            // merge those segments together with our new messages.
            if (
                areRangesOverlapping(
                    afterMessageId,
                    beforeMessageId,
                    segmentStartMessageId,
                    segmentEndMessageId,
                )
            ) {
                // Find our contiguous series of loaded segments that overlap with our newly
                // loaded messages...
                const loadedSegmentsToMerge = [segment];
                let lastLoadedSegmentIndex = segmentIndex;
                for (
                    let otherSegmentIndex = segmentIndex + 1;
                    otherSegmentIndex < this._segments.length;
                    otherSegmentIndex++
                ) {
                    const segment = this._segments[otherSegmentIndex]!;
                    if (!segment.isLoaded) continue;
                    const segmentStartMessageId = segment.messages[0]!.id;
                    const segmentEndMessageId = segment.messages[segment.messages.length - 1]!.id;

                    if (
                        areRangesOverlapping(
                            afterMessageId,
                            beforeMessageId,
                            segmentStartMessageId,
                            segmentEndMessageId,
                        )
                    ) {
                        loadedSegmentsToMerge.push(segment);
                        lastLoadedSegmentIndex = otherSegmentIndex;
                    } else {
                        break;
                    }
                }

                // Figure out what segments are adjacent to our segments to merge then merge...
                if (segmentIndex > 0 && lastLoadedSegmentIndex < this._segments.length - 1) {
                    const lastUnloadedSegment = this._segments[segmentIndex - 1]!;
                    assert(!lastUnloadedSegment.isLoaded);

                    const nextUnloadedSegment = this._segments[lastLoadedSegmentIndex + 1]!;
                    assert(!nextUnloadedSegment.isLoaded);

                    return mergeWithExistingLoadedSegments(
                        segmentIndex - 1,
                        lastLoadedSegmentIndex + 1,
                        lastUnloadedSegment,
                        loadedSegmentsToMerge,
                        nextUnloadedSegment,
                    );
                } else if (segmentIndex > 0) {
                    const lastUnloadedSegment = this._segments[segmentIndex - 1]!;
                    assert(!lastUnloadedSegment.isLoaded);

                    return mergeWithExistingLoadedSegments(
                        segmentIndex - 1,
                        lastLoadedSegmentIndex,
                        lastUnloadedSegment,
                        loadedSegmentsToMerge,
                        null,
                    );
                } else if (lastLoadedSegmentIndex < this._segments.length - 1) {
                    const nextUnloadedSegment = this._segments[lastLoadedSegmentIndex + 1]!;
                    assert(!nextUnloadedSegment.isLoaded);

                    return mergeWithExistingLoadedSegments(
                        segmentIndex,
                        lastLoadedSegmentIndex + 1,
                        null,
                        loadedSegmentsToMerge,
                        nextUnloadedSegment,
                    );
                } else {
                    return mergeWithExistingLoadedSegments(
                        segmentIndex,
                        lastLoadedSegmentIndex,
                        null,
                        loadedSegmentsToMerge,
                        null,
                    );
                }
            }
        }

        // If we are at this point it means our newly loaded messages did not overlap
        // with any segments. So we should insert a new segment at the end.
        //
        // Figure out what our adjacent segments are and insert...
        if (this._segments.length === 0) {
            return insertNewLoadedSegment(0, 0, null, null, null);
        } else {
            const lastSegment = this._segments[this._segments.length - 1]!;
            if (lastSegment.isLoaded) {
                return insertNewLoadedSegment(
                    this._segments.length - 1,
                    this._segments.length - 1,
                    lastSegment,
                    null,
                    null,
                );
            } else {
                if (this._segments.length >= 2) {
                    const lastLoadedSegment = this._segments[this._segments.length - 2]!;
                    assert(lastLoadedSegment.isLoaded);

                    return insertNewLoadedSegment(
                        this._segments.length - 2,
                        this._segments.length - 1,
                        lastLoadedSegment,
                        lastSegment,
                        null,
                    );
                } else {
                    return insertNewLoadedSegment(
                        this._segments.length - 1,
                        this._segments.length - 1,
                        null,
                        lastSegment,
                        null,
                    );
                }
            }
        }
    }
}

/**
 * A segment in a paginated list represents a continuous block of either loaded
 * or unloaded messages. We should never have two adjacent unloaded segments or
 * two adjacent loaded segments.
 */
export type PaginatedMessageListSegment<Message extends {readonly id: number}> =
    | PaginatedMessageListUnloadedSegment
    | PaginatedMessageListLoadedSegment<Message>;

type PaginatedMessageListUnloadedSegment = {
    readonly isLoaded: false;
    readonly estimatedMessageCount: number;
};

type PaginatedMessageListLoadedSegment<Message extends {readonly id: number}> = {
    readonly isLoaded: true;
    readonly messages: ReadonlyArray<Message>;
};

// https://stackoverflow.com/questions/3269434/whats-the-most-efficient-way-to-test-if-two-ranges-overlap
function areRangesOverlapping(start1: number, end1: number, start2: number, end2: number) {
    assert(start1 <= end1);
    assert(start2 <= end2);
    return start1 <= end2 && end1 >= start2;
}
