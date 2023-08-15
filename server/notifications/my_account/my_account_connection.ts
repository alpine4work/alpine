import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import {MyAccountProtocol} from "~/shared/notifications/my_account_protocol.js";

export class MyAccountConnection {
    public readonly procedures: WebSocketConnectionProcedures<typeof MyAccountProtocol> = {};
}
