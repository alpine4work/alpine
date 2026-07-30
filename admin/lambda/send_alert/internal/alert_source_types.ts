export type AlertSourceAuthorizationResult =
    | {ok: true}
    | {ok: false; statusCode: number; error: string};

export type SendAlertResult = {ok: true} | {ok: false; error: string; statusCode?: number};
