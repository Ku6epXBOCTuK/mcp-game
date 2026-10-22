import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/server";

export type McpTestClient = {
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  notify: (method: string, params?: Record<string, unknown>) => void;
  close: () => Promise<void>;
};

export async function connectTestClient(
  server: { connect: (transport: InMemoryTransport) => Promise<void> },
): Promise<McpTestClient> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();

  clientTransport.onmessage = (message: JSONRPCMessage) => {
    if (!("id" in message) || message.id === undefined) return;
    const key = Number(message.id);
    const entry = pending.get(key);
    if (!entry) return;
    pending.delete(key);
    if ("error" in message && message.error) {
      entry.reject(new Error(JSON.stringify(message.error)));
      return;
    }
    entry.resolve("result" in message ? message.result : undefined);
  };

  const request = (method: string, params?: Record<string, unknown>) => {
    const id = nextId;
    nextId += 1;
    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      void clientTransport.send({
        jsonrpc: "2.0",
        id,
        method,
        ...(params ? { params } : {}),
      } as never);
    });
  };

  const notify = (method: string, params?: Record<string, unknown>) => {
    void clientTransport.send({
      jsonrpc: "2.0",
      method,
      ...(params ? { params } : {}),
    } as never);
  };

  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0.0.0" },
  });
  notify("notifications/initialized");

  return {
    request,
    notify,
    close: async () => {
      await clientTransport.close();
    },
  };
}
