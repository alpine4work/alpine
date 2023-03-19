import {DependencyList, Dispatch, SetStateAction, useCallback, useMemo, useState} from "react";

/**
 * `useState()` with a dependency list. When that dependency list changes, the
 * state resets back to the initial state. The state initializer may consume
 * the dependency list as a convenience.
 *
 * You can kind of think of this as a `useMemo(() => useState(), dependencies)`
 * combination.
 */
export function useStateWithDependencies<State, Dependencies extends DependencyList>(
    initializeState: State | ((...dependencies: Dependencies) => State),
    dependencies: Dependencies,
): [State, Dispatch<SetStateAction<State>>] {
    // Give `initialState` the same lifetime as our dependencies array. You can
    // only use a new `initialState` when dependencies change.
    const initialState = useMemo(
        () =>
            typeof initializeState === "function"
                ? (initializeState as (...dependencies: Dependencies) => State)(...dependencies)
                : initializeState,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        dependencies,
    );

    const [stateWithDependencies, setStateWithDependencies] = useState<{
        dependencies: Dependencies;
        state: State;
    }>(() => ({
        dependencies,
        state: initialState,
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

                    // If our dependencies changed we need to reinitialize the state before running
                    // our updater.
                    const oldState = areDependenciesEqual
                        ? stateWithDependencies.state
                        : // It is ok to use `initialState` here even though it is not in the dependency
                          // array because it has the same lifetime as the dependency array thanks to the
                          // `useMemo()` above.
                          initialState;

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
            state: initialState,
        };

        setStateWithDependencies(newStateWithDependencies);

        return [newStateWithDependencies.state, setState];
    }

    return [stateWithDependencies.state, setState];
}
