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
}
