import {ReactNode, useMemo, useState} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {getUndecidedAlphaAccessRequests} from "~/server/alpha/alpha_access_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {AlphaAccessRequestModel} from "~/shared/alpha/alpha_access_request_model.js";
import {getIntlDateTimeFormat} from "~/shared/helpers/intl/get_intl_date_time_format.js";
import {
    approveAlphaAccessRequest,
    denyAlphaAccessRequest,
} from "~/shared/rpc/alpha_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";

export function meta() {
    return [{title: `Closed Alpha Management${metaTitlePostfix}`}];
}

const LoaderSchema = Schema.object({
    requests: Schema.array(AlphaAccessRequestModel.schema()),
});

export async function loader({context}: LoaderArgs) {
    const requests = await getUndecidedAlphaAccessRequests(await context.actor.authenticate());
    return jsonWithSchema(LoaderSchema, {requests});
}

export default function AlphaManagementPage() {
    const {locale, timeZone} = useClientInfo();
    const {requests: loadedRequests} = useLoaderDataWithSchema(LoaderSchema);

    const dateTimeFormatter = useMemo(() => {
        return getIntlDateTimeFormat({
            locale,
            timeZone,
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "numeric",
        });
    }, [locale, timeZone]);

    const [decidedEmailAddresses, setDecidedEmailAddresses] = useState<ReadonlySet<string>>(
        new Set(),
    );

    const requests = loadedRequests.filter(
        request => !decidedEmailAddresses.has(request.emailAddress),
    );

    return (
        <Box display="flex" justifyContent="center" backgroundColor="grey-0" height="full">
            <main
                className={sprinkles({
                    width: "full",
                    maxWidth: "128",
                    paddingX: "4",
                    paddingY: "6",
                })}
            >
                <h1
                    className={sprinkles({
                        fontSize: "400",
                        fontStyle: "bold",
                    })}
                >
                    Alpha Control Panel
                </h1>
                <Spacer space="12" />
                <Box borderTop="grey-10" />
                <Spacer space="12" />
                <Box>
                    <Box fontSize="300" fontStyle="bold">
                        Access Requests
                    </Box>
                    <Spacer space="3" />
                    {requests.length === 0 && <Box color="grey-80">No alpha access requests</Box>}
                    <Box display="flex" flexDirection="column" gap="3">
                        {requests.map(request => (
                            <AlphaAccessRequest
                                key={request.emailAddress}
                                request={request}
                                dateTimeFormatter={dateTimeFormatter}
                                onDecided={() =>
                                    setDecidedEmailAddresses(decidedEmailAddresses =>
                                        new Set(decidedEmailAddresses).add(request.emailAddress),
                                    )
                                }
                            />
                        ))}
                    </Box>
                </Box>
            </main>
        </Box>
    );
}

function AlphaAccessRequest({
    request,
    dateTimeFormatter,
    onDecided,
}: {
    request: AlphaAccessRequestModel;
    dateTimeFormatter: Intl.DateTimeFormat;
    onDecided: () => void;
}) {
    const context = useAppContext();

    return (
        <Box padding="3" borderRadius="1" border="grey-10">
            <Box marginBottom="3" paddingBottom="3" borderBottom="grey-10" display="flex" gap="2">
                <Box flexGrow="1" fontStyle="bold" fontSize="300" userSelect="text">
                    {request.emailAddress}
                </Box>
                <Button
                    variant="quiet"
                    pressErrorTitle="Couldn\u2019t deny access request"
                    onPress={async () => {
                        await denyAlphaAccessRequest(context, {
                            emailAddress: request.emailAddress,
                        });
                        onDecided();
                    }}
                >
                    Deny
                </Button>
                <Button
                    variant="accent"
                    pressErrorTitle="Couldn\u2019t approve access request"
                    onPress={async () => {
                        await approveAlphaAccessRequest(context, {
                            emailAddress: request.emailAddress,
                        });
                        onDecided();
                    }}
                >
                    Approve
                </Button>
            </Box>
            <Box display="flex" flexDirection="column" gap="2">
                <AlphaAccessRequestField
                    label="Requested"
                    value={dateTimeFormatter.format(request.createdTime)}
                />
                <AlphaAccessRequestField label="Name" value={request.name} />
                <AlphaAccessRequestField
                    label="Message"
                    value={
                        request.message.length !== 0
                            ? request.message
                                  .split("\n")
                                  .flatMap((message, i) =>
                                      i === 0 ? [message] : [<br key={i} />, message],
                                  )
                            : "\u2013"
                    }
                />
            </Box>
        </Box>
    );
}

function AlphaAccessRequestField({label, value}: {label: string; value: ReactNode}) {
    return (
        <Box display="flex" gap="2">
            <Box flexShrink="0" width="16" color="grey-60">
                {label}
            </Box>
            <Box flexGrow="1" userSelect="text">
                {value}
            </Box>
        </Box>
    );
}
