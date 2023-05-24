import {WebSocketConnectionProcedures} from "~/server/cloudflare/web_socket_server";
import {MyAccountProtocol} from "~/shared/notifications/my_account_protocol";

export class MyAccountConnection {
    public readonly procedures: WebSocketConnectionProcedures<typeof MyAccountProtocol> = {};
}
