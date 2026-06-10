export type IterableChange<Value> = {
    readonly type: "Added" | "Deleted" | null;
    readonly value: Value;
};

/**
 * Performs a symmetric difference algorithm on two iterables and returns the
 * result. Similar to `symmetricDiffTree()`. Value equality is determined by
 * `Object.is()`.
 *
 * This function is also spiritually similar to a `git diff`! You could pass in
 * `Iterable<string>`s representing lines of code and get more or less the same
 * output as `git diff`. We could use this function to implement a patch generator
 * utility.
 *
 * Returns a list of changes where values that are unchanged have a type of `null`.
 * Values that were added have a type of `Added` and values that were deleted have
 * a type of `Deleted`. Values that stayed in the iterable but changed relative
 * positions are recorded with a `Deleted` at their old position and an `Added` at
 * their new position.
 *
 * If there's a sequence of `Added`/`Deleted` changes then `Deleted` changes will
 * always come before `Added` changes.
 *
 * This function is generally O(n) where n is the maximum length of `oldIterable`
 * and `newIterable`. This makes it much less efficient than `symmetricDiffTree()`!
 * If you need a fast diff don't use this function. Instead refactor your data
 * types to use trees and call `symmetricDiffTree()`.
 *
 * Performance is consistently O(n) if:
 *
 * 1. Values in your iterables are unique
 * 2. Values are added to `newIterable` that aren't in `oldIterable`
 * 3. Values are deleted from `oldIterable` and don't appear in `newIterable`
 *
 * 2 or 3 may happen if a value moves (changes its relative position). If you have
 * many moves between the two iterables (e.g. a random shuffle) we fear this
 * function could have worst case performance of O(n²). However, after some light
 * benchmarking with data we predict to perform poorly we did not see O(n²)
 * performance characteristics. So it's possible this function performs better than
 * anticipated when there are many moves but we can't tell for certain now.
 *
 * Mathematically speaking, this is only a true symmetric difference if values in
 * the iterable do not change their relative order. For example, if you diff
 * `[1, 2, 3]` with `[2, 3, 1]` then we will report the 1 as being deleted then
 * added. In order for this to be a pure symmetric difference you might be able to
 * consider iterable entries as a pair of their relative position and value but
 * being mathematically sound isn't relevant for our current uses of this function.
 *
 * @deprecated I just added the `shared/prosemirror/internal/diff.ts` function
 * which should probably replace this function eventually. It's based on the Myers
 * diff algorithm and boasts a production grade implementation (forked from a
 * module installed 85M times per week).
 */
// NOTE(calebmer, #interview): Implementing this function could make for a good
// algorithmic interview question.
export function symmetricDiffIterable<Value>(
    oldIterable: Iterable<Value>,
    newIterable: Iterable<Value>,
): Array<IterableChange<Value>> {
    return actuallySymmetricDiffIterable(
        Array.isArray(oldIterable) ? oldIterable : Array.from(oldIterable),
        oldIterable instanceof Set ? oldIterable : new Set(oldIterable),
        Array.isArray(newIterable) ? newIterable : Array.from(newIterable),
        newIterable instanceof Set ? newIterable : new Set(newIterable),
    );
}

/**
 * Same as `symmetricDiffIterable()`. If you happen to already have both an array
 * and a set for your old/new iterables you should call this function directly.
 * Since otherwise we need to construct a `Set`/`Array` from your iterable input.
 *
 * @deprecated I just added the `shared/prosemirror/internal/diff.ts` function
 * which should probably replace this function eventually. It's based on the Myers
 * diff algorithm and boasts a production grade implementation (forked from a
 * module installed 85M times per week).
 */
export function actuallySymmetricDiffIterable<Value>(
    oldArray: ReadonlyArray<Value>,
    oldSet: ReadonlySet<Value>,
    newArray: ReadonlyArray<Value>,
    newSet: ReadonlySet<Value>,
): Array<IterableChange<Value>> {
    const changes: Array<IterableChange<Value>> = [];

    let oldIndex = 0;
    let newIndex = 0;

    while (oldIndex < oldArray.length && newIndex < newArray.length) {
        const oldValue = oldArray[oldIndex]!;
        const newValue = newArray[newIndex]!;

        if (Object.is(oldValue, newValue)) {
            oldIndex++;
            newIndex++;
            changes.push({type: null, value: newValue});
            continue;
        }

        let hasOldValueLaterInNewArray = newSet.has(oldValue);

        // The set is an optimization that only tells us the value exists somewhere in the
        // array. We need to know if the value exists after our current index.
        if (hasOldValueLaterInNewArray) {
            hasOldValueLaterInNewArray = false;

            for (
                let searchNewIndex = newIndex + 1;
                searchNewIndex < newArray.length;
                searchNewIndex++
            ) {
                const searchNewValue = newArray[searchNewIndex]!;

                if (Object.is(oldValue, searchNewValue)) {
                    hasOldValueLaterInNewArray = true;
                    break;
                }
            }
        }

        // The value has been definitively deleted. We record deletes before additions so
        // add a deleted change and continue.
        if (!hasOldValueLaterInNewArray) {
            oldIndex++;
            changes.push({type: "Deleted", value: oldValue});
            continue;
        }

        let hasNewValueLaterInOldArray = oldSet.has(newValue);

        // The set is an optimization that only tells us the value exists somewhere in the
        // array. We need to know if the value exists after our current index.
        if (hasNewValueLaterInOldArray) {
            hasNewValueLaterInOldArray = false;

            for (
                let searchOldIndex = oldIndex + 1;
                searchOldIndex < oldArray.length;
                searchOldIndex++
            ) {
                const searchOldValue = oldArray[searchOldIndex]!;

                if (Object.is(newValue, searchOldValue)) {
                    hasNewValueLaterInOldArray = true;
                    break;
                }
            }
        }

        // The value has been definitively added. We want to record sequences of deletes
        // before sequences of additions. So we find the point where the arrays converge
        // again (the next item where `Object.is(oldValue, newValue)`) and record all the
        // deletes then additions to get to that point.
        if (!hasNewValueLaterInOldArray) {
            newIndex++;
            const addedNewValues: Array<Value> = [newValue];

            while (newIndex < newArray.length) {
                const nextNewValue = newArray[newIndex]!;

                if (!oldSet.has(nextNewValue)) {
                    newIndex++;
                    addedNewValues.push(nextNewValue);
                    continue;
                }

                let searchOldIndex = oldIndex;
                while (searchOldIndex < oldArray.length) {
                    const searchOldValue = oldArray[searchOldIndex]!;

                    if (Object.is(nextNewValue, searchOldValue)) break;

                    searchOldIndex++;
                }

                // `nextNewValue` is in `oldArray` before `oldIndex`. Consider `nextNewValue` to be
                // an added value.
                if (!(searchOldIndex < oldArray.length)) {
                    newIndex++;
                    addedNewValues.push(nextNewValue);
                    continue;
                }

                while (oldIndex < searchOldIndex) {
                    const nextOldValue = oldArray[oldIndex]!;

                    oldIndex++;
                    changes.push({type: "Deleted", value: nextOldValue});
                }
                break;
            }

            for (const newValue of addedNewValues) {
                changes.push({type: "Added", value: newValue});
            }
            continue;
        }

        const maxLookahead = 3;

        let searchOldIndex = oldIndex;
        let searchNewIndex = newIndex;

        // If the new value exists later in the old array and the old value exists later in
        // the new array this means the value has moved. Our diff function doesn't report
        // moves so find the next place the old array and new array converge then report
        // any values in between as deleted or added.
        //
        // In theory, this would need to check every pair of `(oldIndex, newIndex)` until
        // the end of the array. But that could be very inefficient! So we have a small
        // lookahead constant that will check a little ahead of where we are now.
        for (let lookahead = 1; lookahead <= maxLookahead; lookahead++) {
            searchOldIndex = oldIndex;
            searchNewIndex = newIndex;

            let areOldValueAndNewValueEqual = false;

            while (searchOldIndex < oldArray.length && searchNewIndex < newArray.length) {
                const searchOldValue = oldArray[searchOldIndex]!;
                const searchNewValue = newArray[searchNewIndex]!;

                if (Object.is(searchOldValue, searchNewValue)) {
                    areOldValueAndNewValueEqual = true;
                    break;
                }

                if (searchOldIndex + lookahead < oldArray.length) {
                    const nextSearchOldValue = oldArray[searchOldIndex + lookahead];

                    if (Object.is(nextSearchOldValue, searchNewValue)) {
                        searchOldIndex += lookahead;
                        areOldValueAndNewValueEqual = true;
                        break;
                    }
                }

                if (searchNewIndex + lookahead < newArray.length) {
                    const nextSearchNewValue = newArray[searchNewIndex + lookahead];

                    if (Object.is(nextSearchNewValue, searchOldValue)) {
                        searchNewIndex += lookahead;
                        areOldValueAndNewValueEqual = true;
                        break;
                    }
                }

                searchOldIndex++;
                searchNewIndex++;
            }

            if (areOldValueAndNewValueEqual) break;
        }

        while (oldIndex < searchOldIndex) {
            const nextOldValue = oldArray[oldIndex]!;

            oldIndex++;
            changes.push({type: "Deleted", value: nextOldValue});
        }

        while (newIndex < searchNewIndex) {
            const nextNewValue = newArray[newIndex]!;

            newIndex++;
            changes.push({type: "Added", value: nextNewValue});
        }
    }

    // Record any remaining values as deleted...
    while (oldIndex < oldArray.length) {
        const oldValue = oldArray[oldIndex]!;

        oldIndex++;
        changes.push({type: "Deleted", value: oldValue});
    }

    // Record any remaining values as added...
    while (newIndex < newArray.length) {
        const newValue = newArray[newIndex]!;

        newIndex++;
        changes.push({type: "Added", value: newValue});
    }

    return changes;
}
