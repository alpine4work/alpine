import {DependencyList, useEffect, useRef} from "react";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";

/**
 * Hook to debug why a React effect is re-running. You pass in a list of
 * dependencies and it logs which ones changed. Should generally not be using this
 * in production. It's only useful for debugging.
 */
export function useDebugDependencyChanges(
    dependencies: DependencyList,
    log: (dependencyChanges: Array<{previous: unknown; next: unknown} | null>) => void,
) {
    const previousDependencies = useRef<DependencyList | null>(null);

    const _log = useEvent(log);

    useEffect(() => {
        if (previousDependencies.current) {
            _log(
                dependencies.map((dependency, i) => {
                    const previousDependency = previousDependencies.current![i];
                    return !Object.is(previousDependency, dependency)
                        ? {previous: previousDependency, next: dependency}
                        : null;
                }),
            );
        }

        previousDependencies.current = dependencies;
        // eslint-disable-next-line react-compiler/react-compiler
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, dependencies);
}
