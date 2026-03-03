import {TracerServiceName} from "~/shared/tracer/tracer_root.js";

/**
 * HTTP search parameter names we may add to a tracer span. We don't add all search
 * parameters to tracer spans since search parameters may contain sensitive data!
 * We do include some relevant params that meaningfully change the behavior of the
 * route when it loads to help us debug.
 *
 * Search parameter names are meaningful to our system. They are not standardized.
 */
export type TracerEventHttpSearchParamName = keyof TracerEventHttpSearchParamNameMap;

type TracerEventHttpSearchParamNameMap = {
    // Signals we're creating some entity. Like a document or a forum channel.
    create: true;
    // Specifies what in the route should receive focus after navigation completes.
    focus: true;
    // Some routes accept this parameter as a way to configure extra UI to show when
    // the route opens.
    show: true;
    // Specifies where in the route we should initially scroll to after navigation
    // completes.
    scroll: true;
    // Specifies the read consistency with which we should use when reading data. By
    // default we generally use eventual consistency but some routes need to use strong
    // consistency.
    consistency: true;
    // In a messaging view, indicates which message we should scroll to on load. Some
    // messaging implementations use the word "comment" instead of "message" so support
    // that too.
    message: true;
    comment: true;
    // In the document route, indicates which comment thread we should open in the
    // comment sidebar (or in the comment bottom sheet on mobile).
    comments: true;
    // We open notifications with the `inbox=show` search param which shows the
    // notification banner at the top of the page. So the user can dismiss the
    // notification without opening the inbox again.
    inbox: true;
    // If the `file=:fileId-:attachmentTarget` search param is set then we open the
    // file viewer for the user.
    file: true;
    // `variant` and `width` are used by our file endpoint to select which file variant
    // to return and to resize the file to a specific size.
    variant: true;
    width: true;
    // `ApiService` parameters for `/messages` pagination.
    limit: true;
    cursor: true;
    from: true;
    // We have Framer custom code that adds these search params to `/auth/sign-in` and
    // `/auth/sign-up` links.
    www_referrer: true;
    utm_source: true;
    utm_medium: true;
    utm_campaign: true;
    utm_term: true;
    utm_content: true;
};

const tracerEventHttpSearchParamNameMap: TracerEventHttpSearchParamNameMap = {
    create: true,
    focus: true,
    show: true,
    scroll: true,
    consistency: true,
    message: true,
    comment: true,
    comments: true,
    inbox: true,
    file: true,
    variant: true,
    width: true,
    limit: true,
    cursor: true,
    from: true,
    www_referrer: true,
    utm_source: true,
    utm_medium: true,
    utm_campaign: true,
    utm_term: true,
    utm_content: true,
};

/**
 * All of the header names in our `TracerEventHttpSearchParamName` type available
 * at runtime.
 */
export const tracerEventHttpSearchParamNames: ReadonlySet<string> = new Set(
    Object.keys(tracerEventHttpSearchParamNameMap),
);

/**
 * The search params we'll include in `TracerEvent`s by `TracerServiceName`. Search
 * params may have different meanings for each service. So we only want to record
 * search params that are relevant to each service and don't contain sensitive data
 * for that service.
 */
export const tracerEventHttpSearchParamNameByServiceName: {
    [Key in TracerServiceName]?: ReadonlySet<TracerEventHttpSearchParamName>;
} = {
    AppService: new Set([
        "create",
        "focus",
        "show",
        "scroll",
        "consistency",
        "message",
        "comment",
        "comments",
        "inbox",
        "file",
        "www_referrer",
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
    ]),
    EdgeService: new Set(["variant", "width"]),
    TaskRealtimeService: new Set(["consistency"]),
    FileProcessorService: new Set(["variant", "width"]),
    ApiService: new Set(["limit", "cursor", "from"]),
};
