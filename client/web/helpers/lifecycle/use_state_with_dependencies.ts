import {DependencyList, Dispatch, SetStateAction, useCallback, useState} from "react";
import {BlockInference} from "~/shared/helpers/types/block_inference.js";

/**
 * `useState()` with a dependency list. When that dependency list changes, the
 * state resets back to the initial state. The state initializer may consume the
 * dependency list as a convenience.
 *
 * You can kind of think of this as a `useMemo(() => useState(), dependencies)`
 * combination.
 */
export function useStateWithDependencies<State, const Dependencies extends DependencyList>(
    initializeState:
        | State
        | ((
              dependencies: BlockInference<Dependencies>,
              previousState: BlockInference<State> | undefined,
              previousDependencies: BlockInference<Dependencies> | undefined,
          ) => State),
    dependencies: Dependencies,
): [State, Dispatch<SetStateAction<State>>] {
    const [stateWithDependencies, setStateWithDependencies] = useState<{
        dependencies: Dependencies;
        state: State;
    }>(() => ({
        dependencies,
        state:
            typeof initializeState === "function"
                ? (
                      initializeState as (
                          dependencies: Dependencies,
                          previousState: State | undefined,
                          previousDependencies: Dependencies | undefined,
                      ) => State
                  )(dependencies, undefined, undefined)
                : initializeState,
    }));

    const setState: Dispatch<SetStateAction<State>> = useCallback(
        (action: SetStateAction<State>) => {
            if (typeof action !== "function") {
                setStateWithDependencies({
                    dependencies,
                    state: action,
                });
            } else {
                setStateWithDependencies(stateWithDependencies => {
                    const areDependenciesEqual =
                        stateWithDependencies.dependencies.length === dependencies.length &&
                        stateWithDependencies.dependencies.every((dependency, index) =>
                            Object.is(dependency, dependencies[index]),
                        );

                    // If our dependencies changed we need to reinitialize the state before running our
                    // updater.
                    const oldState = areDependenciesEqual
                        ? stateWithDependencies.state
                        : // It is ok to use `initialState` here even though it is not in the dependency
                          // array because it has the same lifetime as the dependency array thanks to the
                          // `useMemo()` above.
                          typeof initializeState === "function"
                          ? (
                                initializeState as (
                                    dependencies: Dependencies,
                                    previousState: State | undefined,
                                    previousDependencies: Dependencies | undefined,
                                ) => State
                            )(
                                dependencies,
                                stateWithDependencies.state,
                                stateWithDependencies.dependencies,
                            )
                          : initializeState;

                    const newState = (action as (oldState: State) => State)(oldState);

                    if (areDependenciesEqual && Object.is(oldState, newState))
                        return stateWithDependencies;

                    return {
                        dependencies,
                        state: newState,
                    };
                });
            }
        },
        // eslint-disable-next-line react-compiler/react-compiler
        // eslint-disable-next-line react-hooks/exhaustive-deps
        dependencies,
    );

    const areDependenciesEqual =
        stateWithDependencies.dependencies.length === dependencies.length &&
        stateWithDependencies.dependencies.every((dependency, index) =>
            Object.is(dependency, dependencies[index]),
        );

    if (!areDependenciesEqual) {
        const newStateWithDependencies = {
            dependencies,
            state:
                typeof initializeState === "function"
                    ? (
                          initializeState as (
                              dependencies: Dependencies,
                              previousState: State | undefined,
                              previousDependencies: Dependencies | undefined,
                          ) => State
                      )(
                          dependencies,
                          stateWithDependencies.state,
                          stateWithDependencies.dependencies,
                      )
                    : initializeState,
        };

        setStateWithDependencies(newStateWithDependencies);

        return [newStateWithDependencies.state, setState];
    }

    return [stateWithDependencies.state, setState];
}

/**
 * Same as `useStateWithDependencies()` but slightly more efficient because we
 * don't return the `setState` function.
 *
 * This is pretty similar to `useMemo()` but with a few important differences:
 *
 * 1. You can be confident React won't blow away the memoized value. React may
 *    recompute memo at any time. In `<StrictMode>` React in fact calls the
 *    memoizer function twice to make sure you don't do stateful things with your
 *    memo. So if you need to create a stateful resource, this hook is more
 *    reliable.
 *
 * 2. You have access to the previous value when computing your new value. This is
 *    nice if you need to reuse parts of a previous value. Accumulating some new
 *    value over time.
 *
 * 3. You're free to capture "stale" props in the initializer function and they'll
 *    be saved to state. Useful if you want to capture some initial prop into state
 *    and you don't want to re-compute your state if that prop changes.
 */
export function useStateWithDependenciesWithoutDispatch<
    State,
    const Dependencies extends DependencyList,
>(
    initializeState:
        | State
        | ((
              dependencies: BlockInference<Dependencies>,
              previousState: BlockInference<State> | undefined,
              previousDependencies: BlockInference<Dependencies> | undefined,
          ) => State),
    dependencies: Dependencies,
): State {
    const [stateWithDependencies, setStateWithDependencies] = useState<{
        dependencies: Dependencies;
        state: State;
    }>(() => ({
        dependencies,
        state:
            typeof initializeState === "function"
                ? (
                      initializeState as (
                          dependencies: Dependencies,
                          previousState: State | undefined,
                          previousDependencies: Dependencies | undefined,
                      ) => State
                  )(dependencies, undefined, undefined)
                : initializeState,
    }));

    const areDependenciesEqual =
        stateWithDependencies.dependencies.length === dependencies.length &&
        stateWithDependencies.dependencies.every((dependency, index) =>
            Object.is(dependency, dependencies[index]),
        );

    if (!areDependenciesEqual) {
        const newStateWithDependencies = {
            dependencies,
            state:
                typeof initializeState === "function"
                    ? (
                          initializeState as (
                              dependencies: Dependencies,
                              previousState: State | undefined,
                              previousDependencies: Dependencies | undefined,
                          ) => State
                      )(
                          dependencies,
                          stateWithDependencies.state,
                          stateWithDependencies.dependencies,
                      )
                    : initializeState,
        };

        setStateWithDependencies(newStateWithDependencies);

        return newStateWithDependencies.state;
    }

    return stateWithDependencies.state;
}
