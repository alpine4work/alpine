declare const __RESOURCE_SERVICE_URL__: string;

/**
 * `import.meta` [env variables provided by Vite][1].
 *
 * [1]: https://vitejs.dev/guide/env-and-mode.html#env-variables
 */
interface ImportMeta {
    readonly env?: {
        readonly BASE_URL?: string;
        readonly MODE?: string;
        readonly DEV?: boolean;
        readonly PROD?: boolean;
        readonly SSR?: boolean;
    };
    readonly hot?: import("vite/types/hot.d.ts").ViteHotContext;
}
