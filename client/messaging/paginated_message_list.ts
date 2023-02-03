import {OutOfRangeError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {Lazy} from "~/shared/helpers/control/lazy";
import {LazyMap} from "~/shared/helpers/control/lazy_map";

/**
 * The smallest possible message index.
 */
export const minMessageIndex = 0;

/**
 * The largest possible message index.
 */
export const maxMessageIndex = Number.MAX_SAFE_INTEGER;

/**
 * Immutable object for keeping track of a partially loaded list of messages.
 * You may have segments of loaded messages at the beginning of the list, the
 * end of the list, or randomly throughout the list.
 *
 * Takes advantage of the fact that message IDs are dense to predict how big
 * the gap is between message ranges.
 */
export class PaginatedMessageList<Message extends {readonly index: number}> {
    private readonly _segments: ReadonlyArray<PaginatedMessageListSegment<Message>>;

    private constructor(segments: ReadonlyArray<PaginatedMessageListSegment<Message>>) {
        // Validate that our segments are well-formed:
        //
        // 1. Messages should be in ascending order by index
        // 2. Segments should be in ascending order by message index
        // 3. You can not have adjacent loaded segments and you can not have adjacent
        //    unloaded segments
        // 4. A loaded or unloaded segment must have at least one message
        let lastMessageIndex: number | null = null;
        for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
            const segment = segments[segmentIndex]!;
            const previousSegment = segmentIndex > 0 ? segments[segmentIndex - 1]! : null;

            if (!segment.isLoaded) {
                assert(
                    segment.messageCount > 0,
                    "Unloaded segment has an estimated message count of zero",
                );
                assert(
                    !previousSegment || previousSegment.isLoaded,
                    "Can not have adjacent unloaded segments",
                );
            } else {
                assert(segment.messages.length > 0, "Loaded segment has no messages");
                assert(
                    !previousSegment || !previousSegment.isLoaded,
                    "Can not have adjacent loaded segments",
                );

                // In development, we iterate over every message in the segment to make sure
                // IDs are in ascending order. Since this is expensive at O(messages), in
                // production we only validate the first and last message ID.
                if (process.env.NODE_ENV !== "production") {
                    for (const message of segment.messages) {
                        assert(
                            lastMessageIndex === null || lastMessageIndex < message.index,
                            "Messages must be in ascending order by `id`",
                        );
                        lastMessageIndex = message.index;
                    }
                } else {
                    const startMessageIndex = segment.messages[0]!.index;
                    const endMessageIndex = segment.messages[segment.messages.length - 1]!.index;

                    assert(
                        lastMessageIndex === null || lastMessageIndex < startMessageIndex,
                        "Messages must be in ascending order by `id`",
                    );
                    assert(
                        startMessageIndex <= endMessageIndex,
                        "Messages must be in ascending order by `id`",
                    );
                    lastMessageIndex = endMessageIndex;
                }
            }
        }

        this._segments = segments;
    }

    /**
     * Create a new empty list.
     */
    public static new<Message extends {readonly index: number}>(
        estimatedMessageCount: number,
    ): PaginatedMessageList<Message> {
        return new PaginatedMessageList(
            estimatedMessageCount > 0
                ? [{isLoaded: false, messageCount: estimatedMessageCount}]
                : [],
        );
    }

    public static newForTest<Message extends {readonly index: number}>(
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
                messageCount += segment.messageCount;
            }
        }
    }

    /**
     * Get the number of messages count in this list.
     *
     * O(segments) the first time you call this function and then it is cached
     * after that.
     */
    public getMessageCount(): number {
        return this._messageCount.get();
    }

    private readonly _messageCount = new Lazy(() => {
        let messageCount = 0;

        for (const segment of this._segments) {
            if (segment.isLoaded) {
                messageCount += segment.messages.length;
            } else {
                messageCount += segment.messageCount;
            }
        }

        return messageCount;
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
                if (index < segment.messageCount) {
                    return {isLoaded: false};
                } else {
                    index -= segment.messageCount;
                }
            }
        }

        throw new OutOfRangeError("Index out of bounds");
    });

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
    public getFirstLoadedMessageAfter(index: number): Message | null {
        if (index < 0 || index > this.getMessageCount() - 1)
            throw new OutOfRangeError("Index out of bounds");

        // We want to find the message before, not the `index` message precisely.
        index += 1;

        let messageCount = 0;
        for (const segment of this._segments) {
            if (segment.isLoaded) {
                if (index < segment.messages.length) {
                    const message = segment.messages[index]!;
                    assert(
                        message.index === messageCount + index,
                        "Index of the message in the list should be the same as the `index` property of the message itself",
                    );
                    return message;
                } else {
                    index -= segment.messages.length;
                }
                messageCount += segment.messages.length;
            } else {
                if (index < segment.messageCount) {
                    // Return the first message in the next loaded segment.
                    index = 0;
                } else {
                    index -= segment.messageCount;
                }
                messageCount += segment.messageCount;
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
    public getLastLoadedMessageBefore(index: number): Message | null {
        if (index < 0 || index > this.getMessageCount() - 1)
            throw new OutOfRangeError("Index out of bounds");

        if (index === 0) return null;

        // We want to find the message before, not the `index` message precisely.
        index -= 1;

        let messageCount = 0;
        let lastMessage: Message | null = null;
        for (const segment of this._segments) {
            if (segment.isLoaded) {
                if (index < segment.messages.length) {
                    const message = segment.messages[index]!;
                    assert(
                        message.index === messageCount + index,
                        "Index of the message in the list should be the same as the `index` property of the message itself",
                    );
                    return message;
                } else {
                    index -= segment.messages.length;
                    lastMessage = segment.messages[segment.messages.length - 1]!;
                    assert(
                        lastMessage.index === messageCount + segment.messages.length - 1,
                        "Index of the message in the list should be the same as the `index` property of the message itself",
                    );
                }
                messageCount += segment.messages.length;
            } else {
                if (index < segment.messageCount) {
                    // Return the last message in the previously loaded segment.
                    return lastMessage;
                } else {
                    index -= segment.messageCount;
                }
                messageCount += segment.messageCount;
            }
        }

        return null;
    }

    /**
     * Load messages into the paginated list. Filling in more of the partially
     * loaded list or replacing a range of messages that already exists.
     */
    public loadMessages({
        afterMessageIndex,
        beforeMessageIndex,
        mayHaveMoreMessagesBefore,
        mayHaveMoreMessagesAfter,
        messages,
    }: {
        /**
         * All loaded messages indexes come after this index. Must be less than the
         * first message index in `messages`.
         *
         * We assume the provided `messages` list is all the messages between this and
         * `beforeMessageIndex`. If you are loading messages that had a limit applied,
         * you should set this to -1 the index of the message at the limit.
         */
        afterMessageIndex: number;
        /**
         * All loaded messages indexes come before this index. Must be greater than the
         * last message index in `messages`.
         *
         * We assume the provided `messages` list is all the messages between this and
         * `afterMessageIndex`. If you are loading messages that had a limit applied,
         * you should set this to +1 the index of the message at the limit.
         */
        beforeMessageIndex: number;
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
        // NOTE(calebmer): So when I wrote this function (and this class) messages
        // could be deleted and completely removed from a list. That meant:
        //
        // - Message counts were only estimations.
        // - While the message index was still an incrementing sequence, you
        //   could have gaps.
        // - Instead of calling the message identifier `message.index` it was
        //   called `message.id` since I didn't want to use the word "index" for a
        //   key which semantically may have gaps.
        //
        // This function and class can probably be simplified with the knowledge that
        // message indexes must be densely packed and can never be deleted.
        //
        // The naming of variables in this function may also be a little more
        // complicated than I'd like since originally message indexes were called
        // message IDs making them easy to differentiate by name vs segment indexes and
        // an index in the total list.
        //
        // For example, when we load messages in an unloaded range we use fractions to
        // determine how many unloaded messages go above our loaded messages and how
        // many unloaded messages go below our loaded messages. This was designed to be
        // an approximate estimation since there was no way of knowing if any messages
        // in the unloaded range were deleted. Now that we know messages can't be
        // deleted we could compute a precise number of unloaded comments instead of
        // approximating. Likewise the business with `mayHaveMoreMessagesBefore` and
        // `mayHaveMoreMessagesAfter` maybe could be simplified given we don't need
        // these flags from the server and instead can know this purely on the client.
        //
        // I suspect this function will keep working now that messages can't be deleted
        // since it's a superset of the original functionality but maybe someday you'll
        // find weird bugs that could be solved by simplifying this class.

        // Validate the messages we are loading.
        let lastMessageIndex = afterMessageIndex;
        for (let index = 0; index < messages.length; index++) {
            const message = messages[index]!;
            assert(
                lastMessageIndex < message.index,
                index === 0
                    ? "`afterMessageIndex` must be before the first message `index`"
                    : "Newly loaded messages must be in ascending order by `index`",
            );
            assert(
                minMessageIndex <= message.index && message.index <= maxMessageIndex,
                "Message `index` is out of bounds",
            );
            lastMessageIndex = message.index;
        }
        assert(
            lastMessageIndex < beforeMessageIndex,
            messages.length > 0
                ? "`beforeMessageIndex` must be after the last message `index`"
                : "`beforeMessageIndex` must be after `lastMessageIndex`",
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
            previousUnloadedSegment: PaginatedMessageListUnloadedSegment | null,
            loadedSegments: Array<PaginatedMessageListLoadedSegment<Message>>,
            nextUnloadedSegment: PaginatedMessageListUnloadedSegment | null,
        ) => {
            assert(loadedSegments.length > 0);
            const firstLoadedSegment = loadedSegments[0]!;
            const lastLoadedSegment = loadedSegments[loadedSegments.length - 1]!;
            const loadedSegmentsStartMessageIndex = firstLoadedSegment.messages[0]!.index;
            const loadedSegmentsEndMessageIndex =
                lastLoadedSegment.messages[lastLoadedSegment.messages.length - 1]!.index;

            const segmentMessages = [];

            // Count of newly loaded messages that fall outside of our existing
            // loaded segments.
            let newMessageCountBeforeLoadedSegments = 0;
            let newMessageCountAfterLoadedSegments = 0;

            const newMessageIndexes = new Set<number>();

            // This message should be called once at the position we want to insert our
            // messages into `segmentMessages`.
            let hasInsertedNewMessages = false;
            const insertNewMessages = () => {
                assert(!hasInsertedNewMessages);
                hasInsertedNewMessages = true;

                for (const message of messages) {
                    newMessageIndexes.add(message.index);

                    if (message.index < loadedSegmentsStartMessageIndex)
                        newMessageCountBeforeLoadedSegments++;
                    if (loadedSegmentsEndMessageIndex < message.index)
                        newMessageCountAfterLoadedSegments++;

                    segmentMessages.push(message);
                }
            };

            for (let segmentIndex = 0; segmentIndex < loadedSegments.length; segmentIndex++) {
                const segment = loadedSegments[segmentIndex]!;
                for (const message of segment.messages) {
                    // Insert new messages before the first existing message that could be after our
                    // new messages.
                    if (afterMessageIndex < message.index && !hasInsertedNewMessages) {
                        insertNewMessages();
                    }

                    // If this message is outside our newly loaded message range
                    // (`afterMessageIndex` to `beforeMessageIndex`) then add it to the new merged
                    // segment's messages.
                    if (
                        (mayHaveMoreMessagesBefore && message.index <= afterMessageIndex) ||
                        (mayHaveMoreMessagesAfter && beforeMessageIndex <= message.index)
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
                        messageCount: Math.max(
                            1,
                            (previousUnloadedSegment?.messageCount ?? 0) -
                                newMessageCountBeforeLoadedSegments,
                        ),
                    });
                } else {
                    if (previousUnloadedSegment) newSegments.push(previousUnloadedSegment);
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
                        messageCount: Math.max(
                            1,
                            (nextUnloadedSegment?.messageCount ?? 0) -
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
            previousLoadedSegment: PaginatedMessageListLoadedSegment<Message> | null,
            unloadedSegment: PaginatedMessageListUnloadedSegment | null,
            nextLoadedSegment: PaginatedMessageListLoadedSegment<Message> | null,
        ) => {
            // Get the start and end of our unloaded segment. If there is no end we assume
            // the end is the start `id` plus the estimated message count. This leverages
            // the fact that message list `id`s are mostly dense. However deleted messages
            // might mean this is an underestimation of the unloaded segment's end.
            const unloadedSegmentStartMessageIndex = previousLoadedSegment
                ? previousLoadedSegment.messages[previousLoadedSegment.messages.length - 1]!.index
                : minMessageIndex - 1;
            const unloadedSegmentEndMessageIndex = nextLoadedSegment
                ? nextLoadedSegment.messages[0]!.index
                : unloadedSegment
                ? Math.max(
                      unloadedSegmentStartMessageIndex + unloadedSegment.messageCount,
                      beforeMessageIndex + 1,
                  )
                : maxMessageIndex + 1;

            assert(unloadedSegmentStartMessageIndex <= afterMessageIndex);
            assert(beforeMessageIndex <= unloadedSegmentEndMessageIndex);

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

            const estimatedMessageCount = unloadedSegment?.messageCount ?? 0;
            const remainingEstimatedMessageCount = Math.max(
                0,
                estimatedMessageCount - messages.length,
            );

            const messageIndexFraction1 =
                (afterMessageIndex - unloadedSegmentStartMessageIndex) /
                (unloadedSegmentEndMessageIndex - unloadedSegmentStartMessageIndex);
            const messageIndexFraction2 =
                (unloadedSegmentEndMessageIndex - beforeMessageIndex) /
                (unloadedSegmentEndMessageIndex - unloadedSegmentStartMessageIndex);

            const estimatedBeforeMessageCount = Math.max(
                1,
                Math.round(
                    (messageIndexFraction1 / (messageIndexFraction1 + messageIndexFraction2)) *
                        remainingEstimatedMessageCount,
                ),
            );
            const estimatedAfterMessageCount = Math.max(
                1,
                Math.round(
                    (messageIndexFraction2 / (messageIndexFraction1 + messageIndexFraction2)) *
                        remainingEstimatedMessageCount,
                ),
            );

            const newSegments: Array<PaginatedMessageListSegment<Message>> = [];

            if (mayHaveMoreMessagesBefore) {
                // Copy the existing segments before this one...
                for (const segment of this._segments.slice(0, startIndex))
                    newSegments.push(segment);

                if (previousLoadedSegment) newSegments.push(previousLoadedSegment);
            }

            if (messages.length > 0) {
                if (mayHaveMoreMessagesBefore) {
                    // Add the first half of the split unloaded segment.
                    newSegments.push({
                        isLoaded: false,
                        messageCount: estimatedBeforeMessageCount,
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
                        messageCount: estimatedAfterMessageCount,
                    });
                }
            } else {
                if (mayHaveMoreMessagesBefore || mayHaveMoreMessagesAfter) {
                    newSegments.push({
                        isLoaded: false,
                        messageCount:
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
            const segmentStartMessageIndex = segment.messages[0]!.index;
            const segmentEndMessageIndex = segment.messages[segment.messages.length - 1]!.index;

            // If we are at this point it means our newly loaded messages did not overlap
            // with any previous segment. If this condition is true then that means our
            // newly loaded messages also will not overlap with any future segment. That
            // means we should insert a new segment here.
            //
            // Figure out what our adjacent segments are and insert...
            if (beforeMessageIndex < segmentStartMessageIndex) {
                if (segmentIndex >= 2) {
                    const previousLoadedSegment = this._segments[segmentIndex - 2]!;
                    assert(previousLoadedSegment.isLoaded);

                    const previousUnloadedSegment = this._segments[segmentIndex - 1]!;
                    assert(!previousUnloadedSegment.isLoaded);

                    return insertNewLoadedSegment(
                        segmentIndex - 2,
                        segmentIndex,
                        previousLoadedSegment,
                        previousUnloadedSegment,
                        segment,
                    );
                } else if (segmentIndex === 1) {
                    const previousUnloadedSegment = this._segments[segmentIndex - 1]!;
                    assert(!previousUnloadedSegment.isLoaded);

                    return insertNewLoadedSegment(
                        segmentIndex - 1,
                        segmentIndex,
                        null,
                        previousUnloadedSegment,
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
                    afterMessageIndex,
                    beforeMessageIndex,
                    segmentStartMessageIndex,
                    segmentEndMessageIndex,
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
                    const segmentStartMessageIndex = segment.messages[0]!.index;
                    const segmentEndMessageIndex =
                        segment.messages[segment.messages.length - 1]!.index;

                    if (
                        areRangesOverlapping(
                            afterMessageIndex,
                            beforeMessageIndex,
                            segmentStartMessageIndex,
                            segmentEndMessageIndex,
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
                    const previousUnloadedSegment = this._segments[segmentIndex - 1]!;
                    assert(!previousUnloadedSegment.isLoaded);

                    const nextUnloadedSegment = this._segments[lastLoadedSegmentIndex + 1]!;
                    assert(!nextUnloadedSegment.isLoaded);

                    return mergeWithExistingLoadedSegments(
                        segmentIndex - 1,
                        lastLoadedSegmentIndex + 1,
                        previousUnloadedSegment,
                        loadedSegmentsToMerge,
                        nextUnloadedSegment,
                    );
                } else if (segmentIndex > 0) {
                    const previousUnloadedSegment = this._segments[segmentIndex - 1]!;
                    assert(!previousUnloadedSegment.isLoaded);

                    return mergeWithExistingLoadedSegments(
                        segmentIndex - 1,
                        lastLoadedSegmentIndex,
                        previousUnloadedSegment,
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

    /**
     * Load messages into the list that you received from a
     * `getMessagesFromStart()` call. You pass the input and output of that RPC
     * call to this function and we will call `loadMessages()` with the correct
     * options.
     */
    public loadMessagesFromStart({
        afterMessageIndex,
        beforeMessageIndex,
        limit,
        hasMoreMessagesAfter,
        messages,
    }: {
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
        limit: number;
        hasMoreMessagesAfter: boolean;
        messages: ReadonlyArray<Message>;
    }) {
        const hasExceededLimit = messages.length >= limit;

        return this.loadMessages({
            afterMessageIndex: afterMessageIndex ?? minMessageIndex - 1,
            // If we exceeded the limit, we don't want to use the actual `afterMessageIndex`
            // because our list will think the messages between our first message `id` and
            // `afterMessageIndex` were deleted.
            beforeMessageIndex: hasExceededLimit
                ? messages[messages.length - 1]!.index + 1
                : beforeMessageIndex ?? maxMessageIndex + 1,
            mayHaveMoreMessagesBefore:
                afterMessageIndex !== null ? afterMessageIndex >= minMessageIndex : false,
            mayHaveMoreMessagesAfter: beforeMessageIndex !== null || hasMoreMessagesAfter,
            messages,
        });
    }

    /**
     * Load messages into the list that you received from a
     * `getMessagesFromEnd()` call. You pass the input and output of that RPC
     * call to this function and we will call `loadMessages()` with the correct
     * options.
     */
    public loadMessagesFromEnd({
        afterMessageIndex,
        beforeMessageIndex,
        limit,
        hasMoreMessagesBefore,
        messages,
    }: {
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
        limit: number;
        hasMoreMessagesBefore: boolean;
        messages: ReadonlyArray<Message>;
    }) {
        const hasExceededLimit = messages.length >= limit;

        return this.loadMessages({
            // If we exceeded the limit, we don't want to use the actual `beforeMessageIndex`
            // because our list will think the messages between our last message `id` and
            // `beforeMessageIndex` were deleted.
            afterMessageIndex: hasExceededLimit
                ? messages[0]!.index - 1
                : afterMessageIndex ?? minMessageIndex - 1,
            beforeMessageIndex: beforeMessageIndex ?? maxMessageIndex + 1,
            mayHaveMoreMessagesBefore: afterMessageIndex !== null || hasMoreMessagesBefore,
            mayHaveMoreMessagesAfter: beforeMessageIndex !== null,
            messages,
        });
    }
}

/**
 * A segment in a paginated list represents a continuous block of either loaded
 * or unloaded messages. We should never have two adjacent unloaded segments or
 * two adjacent loaded segments.
 */
export type PaginatedMessageListSegment<Message extends {readonly index: number}> =
    | PaginatedMessageListUnloadedSegment
    | PaginatedMessageListLoadedSegment<Message>;

type PaginatedMessageListUnloadedSegment = {
    readonly isLoaded: false;
    readonly messageCount: number;
};

type PaginatedMessageListLoadedSegment<Message extends {readonly index: number}> = {
    readonly isLoaded: true;
    readonly messages: ReadonlyArray<Message>;
};

// https://stackoverflow.com/questions/3269434/whats-the-most-efficient-way-to-test-if-two-ranges-overlap
function areRangesOverlapping(start1: number, end1: number, start2: number, end2: number) {
    assert(start1 <= end1);
    assert(start2 <= end2);
    return start1 <= end2 && end1 >= start2;
}
