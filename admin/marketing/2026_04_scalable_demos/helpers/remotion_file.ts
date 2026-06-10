import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export function remotionFile(path: string) {
    return new URL(
        path,
        `http://localhost:${assertExists((import.meta.env as any)?.REMOTION_PUBLIC_PORT)}`,
    ).toString();
}
