import {Box} from "~/client/web/design/box.js";
import {DocumentationApiMethod} from "~/client/web/docs/documentation_api_model.js";
import {ColorSchemeVar} from "~/client/web/styles/styles.js";

// Each method gets a hue: a pale tinted background with darker text of the same
// hue. The grey ramp inversion flips these automatically in dark mode.
const methodPillColors: Record<
    DocumentationApiMethod,
    {backgroundColor: ColorSchemeVar; color: ColorSchemeVar}
> = {
    GET: {backgroundColor: "green-10", color: "green-70"},
    POST: {backgroundColor: "indigo-10", color: "indigo-60"},
    PATCH: {backgroundColor: "orange-10", color: "orange-70"},
    PUT: {backgroundColor: "purple-10", color: "purple-70"},
    DELETE: {backgroundColor: "red-10", color: "red-70"},
};

export function DocumentationMethodPill({
    method,
    size = "base",
}: {
    method: DocumentationApiMethod;
    size?: "base" | "mini";
}) {
    const colors = methodPillColors[method];

    if (size === "mini") {
        return (
            <Box
                as="span"
                fontSize="25"
                fontStyle="code-bold"
                color={colors.color}
                style={{width: 34, flex: "0 0 auto", letterSpacing: "0.02em"}}
            >
                {method}
            </Box>
        );
    }

    return (
        <Box
            as="span"
            display="inline-flex"
            alignItems="center"
            paddingX="2"
            paddingY="0.5"
            borderRadius="full"
            fontSize="50"
            fontStyle="code-bold"
            color={colors.color}
            backgroundColor={colors.backgroundColor}
            style={{letterSpacing: "0.03em", whiteSpace: "nowrap"}}
        >
            {method}
        </Box>
    );
}
