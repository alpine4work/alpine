import {DependencyList, EffectCallback, useEffect, useRef} from "react";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask";

/**
 * `useEffect()` but does not immediately cleanup and re-execute when in
 * `<StrictMode>`. In strict mode, React [double executes][1] effects on the
 * first mount to make sure the effect is reusable.
 *
 * If you are very confident your effect works correctly when cleaning up, you
 * may use this hook which is carefully written to not double-execute effects.
 *
 * [1]: https://reactjs.org/docs/strict-mode.html#ensuring-reusable-state
 */
export const useEffectWithoutStrictModeUnmountSimulation: typeof useEffect =
    process.env.NODE_ENV !== "production"
        ? useEffectWithoutStrictModeUnmountSimulationInDevelopment
        : useEffect;

function useEffectWithoutStrictModeUnmountSimulationInDevelopment(
    callback: EffectCallback,
    dependencies?: DependencyList,
) {
    const isFirstMountRef = useRef(true);
    const cleanupEffectFromFirstMountRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        const isFirstMount = isFirstMountRef.current;
        isFirstMountRef.current = false;

        if (cleanupEffectFromFirstMountRef.current) {
            const cleanupEffect = cleanupEffectFromFirstMountRef.current;
            cleanupEffectFromFirstMountRef.current = null;
            return cleanupEffect;
        }

        // React only double-executes the effect on the first mount. We can run the
        // effect normally after that.
        if (!isFirstMount) return callback();

        // If this is the first mount, then store our cleanup effect and only cleanup
        // after a microtask. If the effect is run again, we cancel the cleanup
        // microtask and don't rerun the effect.
        const cleanupEffect = callback();
        cleanupEffectFromFirstMountRef.current = () => cleanupEffect?.();

        return () => {
            scheduleMicrotask(() => {
                const cleanupEffect = cleanupEffectFromFirstMountRef.current;
                cleanupEffectFromFirstMountRef.current = null;
                cleanupEffect?.();
            });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, dependencies);
}
