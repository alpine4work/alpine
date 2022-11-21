import {useEffect} from "react";

/**
 * Small utility for attaching debug tools to a global `debug` object in
 * development.
 *
 * These tools are useful for manipulating the application in development from
 * the browser console.
 */
export function useDebugTools(name: string, createTools: () => object) {
    useEffect(() => {
        // Do not add debug tools in production!
        if (process.env.NODE_ENV === "production") return;

        (window as any).debug ??= {};

        // If the tools already exist, don't add them again. Only the first component
        // to attach debug tools will be usable.
        if ((window as any).debug[name]) return;

        (window as any).debug[name] = createTools();
        return () => {
            delete (window as any).debug[name];
        };
    }, [createTools, name]);
}
