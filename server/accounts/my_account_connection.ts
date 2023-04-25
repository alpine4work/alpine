import {WebSocketConnectionProcedures} from "~/server/cloudflare/web_socket_server";
import {MyAccountProtocol} from "~/shared/accounts/my_account_protocol";

export class MyAccountConnection {
    // NOCOMMIT
    // @ts-expect-error
    public readonly procedures: WebSocketConnectionProcedures<typeof MyAccountProtocol> = {};
}
