import {Result} from "~/shared/helpers/control/result.js";

export const okResult = {ok: true, value: undefined} as const satisfies Result<void, never>;
