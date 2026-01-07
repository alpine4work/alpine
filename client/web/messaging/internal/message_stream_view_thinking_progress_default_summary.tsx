import {useEffect, useState} from "react";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";

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

const messageStreamSectionThinkingProgressDefaultSummaryAlternativeVerbs = [
    "Reasoning",
    "Writing",
    "Crafting",
    "Generating",
    "Composing",
    "Preparing",
    "Considering",
    "Deliberating",
    "Working",
];

export function MessageStreamViewThinkingProgressDefaultSummary() {
    const [state, setState] = useState(() => ({
        verb: "Thinking",
        previousVerbs: new Set<string>(),
        lastChangeTime: new Date(),
    }));

    useEffect(() => {
        const changeIntervalMs = 3000;

        const timeout = createTimeout(
            () => {
                setState(state => {
                    state = {
                        ...state,
                        lastChangeTime: new Date(),
                    };

                    let possibleVerbs =
                        messageStreamSectionThinkingProgressDefaultSummaryAlternativeVerbs.filter(
                            verb => !state.previousVerbs.has(verb),
                        );

                    // We've used all the verbs! Start over.
                    if (possibleVerbs.length === 0) {
                        possibleVerbs =
                            messageStreamSectionThinkingProgressDefaultSummaryAlternativeVerbs;

                        state = {
                            ...state,
                            previousVerbs: new Set(),
                        };
                    }

                    const nextVerb = possibleVerbs[randomInteger(0, possibleVerbs.length)]!;

                    state = {
                        ...state,
                        verb: nextVerb,
                        previousVerbs: new Set([...state.previousVerbs, nextVerb]),
                    };

                    return state;
                });
            },
            state.lastChangeTime.getTime() + changeIntervalMs - Date.now(),
        );

        return () => {
            timeout.clear();
        };
    }, [state.lastChangeTime]);

    return <>{state.verb}</>;
}
