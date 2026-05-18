/**
 * NOTE(calebmer, 2026-04-09): This is a fork of the [`diff`][1] npm library for
 * our repository. We couldn't directly use the `diff` library because when two
 * tokens are equal we need both the old token value and the new token value. The
 * `diff` npm library only provides the new token value.
 *
 * So we forked! The core diff algorithm is implemented in [`src/diff/base.ts`][2]
 * and is based on "[An O(ND) Difference Algorithm and Its Variations][3]" (Myers,
 * 1986).
 *
 * Our fork simplifies the library to just the core diffing algorithm. We remove
 * many options and the class abstraction to make the code more straightforward and
 * to improve performance.
 *
 * [1]: https://www.npmjs.com/package/diff
 * [2]:
 *     https://github.com/kpdecker/jsdiff/blob/afe5aecad189c9f5941ad3feb3c94c46b32ecb0a/src/diff/base.ts
 * [3]: http://www.xmailserver.org/diff2.pdf
 *
 * BSD 3-Clause License
 *
 * Copyright (c) 2009-2015, Kevin Decker <kpdecker@gmail.com> All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 * 1.  Redistributions of source code must retain the above copyright notice, this
 *     list of conditions and the following disclaimer.
 *
 * 2.  Redistributions in binary form must reproduce the above copyright notice,
 *     this list of conditions and the following disclaimer in the documentation
 *     and/or other materials provided with the distribution.
 *
 * 3.  Neither the name of the copyright holder nor the names of its contributors
 *     may be used to endorse or promote products derived from this software
 *     without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
 * ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export type DiffChange<Token> =
    | {type: "Added"; oldToken: null; newToken: Token}
    | {type: "Removed"; oldToken: Token; newToken: null}
    | {type: "Equal"; oldToken: Token; newToken: Token};

type DiffOptions<Token> = {
    equals: (a: Token, b: Token) => boolean;
};

type Component = {
    type: "Added" | "Removed" | "Equal";
    previousComponent: Component | undefined;
};

type Path = {
    oldPos: number;
    lastComponent: Component | undefined;
};

/**
 * Diff two arrays using an algorithm based on "[An O(ND) Difference Algorithm and
 * Its Variations][1]" (Myers, 1986)
 *
 * You may set `maxEditLength` or `timeout` to control how much computation time is
 * spent on a diff. If either of those thresholds are met then the function returns
 * undefined. If neither of those thresholds are set then the algorithm keeps
 * working until a diff is produced.
 *
 * [1]: http://www.xmailserver.org/diff2.pdf
 */
export function diff<Token>(
    oldTokens: ReadonlyArray<Token>,
    newTokens: ReadonlyArray<Token>,
    options: DiffOptions<Token> & {maxEditLength?: undefined; timeout?: undefined},
): Array<DiffChange<Token>>;
export function diff<Token>(
    oldTokens: ReadonlyArray<Token>,
    newTokens: ReadonlyArray<Token>,
    options:
        | (DiffOptions<Token> & {maxEditLength: number; timeout?: number})
        | (DiffOptions<Token> & {maxEditLength?: number; timeout: number}),
): Array<DiffChange<Token>> | undefined;
export function diff<Token>(
    oldTokens: ReadonlyArray<Token>,
    newTokens: ReadonlyArray<Token>,
    options: DiffOptions<Token> & {maxEditLength?: number; timeout?: number},
): Array<DiffChange<Token>> | undefined {
    const {equals} = options;
    const newLen = newTokens.length,
        oldLen = oldTokens.length;
    let editLength = 1;
    const maxEditLength = Math.min(newLen + oldLen, options.maxEditLength ?? Infinity);
    const maxExecutionTime = options.timeout ?? Infinity;
    const abortAfterTimestamp = Date.now() + maxExecutionTime;

    const bestPath: Array<Path> = [{oldPos: -1, lastComponent: undefined}];

    // Seed editLength = 0, i.e. the content starts with the same values
    let newPos = extractCommon(bestPath[0]!, newTokens, oldTokens, 0, equals);
    if (bestPath[0]!.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
        // Identity per the equality and tokenizer
        return buildValues(bestPath[0]!.lastComponent, newTokens, oldTokens);
    }

    // Once we hit the right edge of the edit graph on some diagonal k, we can
    // definitely reach the end of the edit graph in no more than k edits, so there's
    // no point in considering any moves to diagonal k+1 any more (from which we're
    // guaranteed to need at least k+1 more edits). Similarly, once we've reached the
    // bottom of the edit graph, there's no point considering moves to lower diagonals.
    // We record this fact by setting minDiagonalToConsider and maxDiagonalToConsider
    // to some finite value once we've hit the edge of the edit graph. This
    // optimization is not faithful to the original algorithm presented in Myers's
    // paper, which instead pointlessly extends D-paths off the end of the edit graph -
    // see page 7 of Myers's paper which notes this point explicitly and illustrates it
    // with a diagram. This has major performance implications for some common
    // scenarios. For instance, to compute a diff where the new text simply appends d
    // characters on the end of the original text of length n, the true Myers algorithm
    // will take O(n+d^2) time while this optimization needs only O(n+d) time.
    let minDiagonalToConsider = -Infinity,
        maxDiagonalToConsider = Infinity;

    // Main worker method. checks all permutations of a given edit length for
    // acceptance.
    const execEditLength = () => {
        for (
            let diagonalPath = Math.max(minDiagonalToConsider, -editLength);
            diagonalPath <= Math.min(maxDiagonalToConsider, editLength);
            diagonalPath += 2
        ) {
            let basePath;
            const removePath = bestPath[diagonalPath - 1],
                addPath = bestPath[diagonalPath + 1];
            if (removePath) {
                // No one else is going to attempt to use this value, clear it
                // @ts-expect-error - perf optimisation. This type-violating value will never be read.
                bestPath[diagonalPath - 1] = undefined;
            }

            let canAdd = false;
            if (addPath) {
                // what newPos will be after we do an insertion:
                const addPathNewPos = addPath.oldPos - diagonalPath;
                canAdd = 0 <= addPathNewPos && addPathNewPos < newLen;
            }

            const canRemove = removePath && removePath.oldPos + 1 < oldLen;
            if (!canAdd && !canRemove) {
                // If this path is a terminal then prune
                // @ts-expect-error - perf optimisation. This type-violating value will never be read.
                bestPath[diagonalPath] = undefined;
                continue;
            }

            // Select the diagonal that we want to branch from. We select the prior path whose
            // position in the old string is the farthest from the origin and does not pass the
            // bounds of the diff graph
            if (!canRemove || (canAdd && removePath.oldPos < addPath!.oldPos)) {
                basePath = addToPath(addPath!, "Added", 0);
            } else {
                basePath = addToPath(removePath, "Removed", 1);
            }

            newPos = extractCommon(basePath, newTokens, oldTokens, diagonalPath, equals);

            if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
                // If we have hit the end of both strings, then we are done
                return buildValues(basePath.lastComponent, newTokens, oldTokens);
            } else {
                bestPath[diagonalPath] = basePath;
                if (basePath.oldPos + 1 >= oldLen) {
                    maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
                }
                if (newPos + 1 >= newLen) {
                    minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
                }
            }
        }

        editLength++;
    };

    // Performs the length of edit iteration. Loops over execEditLength until a value
    // is produced, or until the edit length exceeds options.maxEditLength (if given),
    // in which case it will return undefined.
    while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
        const ret = execEditLength();
        if (ret) {
            return ret;
        }
    }
}

function addToPath(path: Path, type: "Added" | "Removed" | "Equal", oldPosInc: number): Path {
    const last = path.lastComponent;

    return {
        oldPos: path.oldPos + oldPosInc,
        lastComponent: {type, previousComponent: last},
    };
}

function extractCommon<Token>(
    basePath: Path,
    newTokens: ReadonlyArray<Token>,
    oldTokens: ReadonlyArray<Token>,
    diagonalPath: number,
    equals: DiffOptions<Token>["equals"],
): number {
    const newLen = newTokens.length,
        oldLen = oldTokens.length;
    let oldPos = basePath.oldPos,
        newPos = oldPos - diagonalPath;

    while (
        newPos + 1 < newLen &&
        oldPos + 1 < oldLen &&
        equals(oldTokens[oldPos + 1]!, newTokens[newPos + 1]!)
    ) {
        newPos++;
        oldPos++;
        basePath.lastComponent = {
            type: "Equal",
            previousComponent: basePath.lastComponent,
        };
    }

    basePath.oldPos = oldPos;
    return newPos;
}

function buildValues<Token>(
    component: Component | undefined,
    newTokens: ReadonlyArray<Token>,
    oldTokens: ReadonlyArray<Token>,
): Array<DiffChange<Token>> {
    const changes: Array<DiffChange<Token>> = [];

    let oldPos = oldTokens.length;
    let newPos = newTokens.length;

    while (component) {
        switch (component.type) {
            case "Added": {
                changes.push({
                    type: "Added",
                    oldToken: null,
                    newToken: newTokens[newPos - 1]!,
                });
                newPos -= 1;
                break;
            }
            case "Removed": {
                changes.push({
                    type: "Removed",
                    oldToken: oldTokens[oldPos - 1]!,
                    newToken: null,
                });
                oldPos -= 1;
                break;
            }
            case "Equal": {
                changes.push({
                    type: "Equal",
                    oldToken: oldTokens[oldPos - 1]!,
                    newToken: newTokens[newPos - 1]!,
                });
                newPos -= 1;
                oldPos -= 1;
                break;
            }
            default:
                throw exhaustive(component.type);
        }

        component = component.previousComponent;
    }

    changes.reverse();

    return changes;
}
