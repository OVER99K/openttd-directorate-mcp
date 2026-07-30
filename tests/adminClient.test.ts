import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import { AdminClient, type AdminClientOptions } from "../src/admin/client.js";
import { AdminUpdateFrequency, AdminUpdateType, PacketAdminType } from "../src/protocol/admin.js";
import { PacketDecoder, PacketReader, PacketWriter } from "../src/protocol/codec.js";

test("AdminClient joins, handles ping/pong, GameScript correlation, RCON, and cleanup", async (t) => {
  let welcomeSent = false;
  const mock = await startMockServerOrSkip(t, (socket) => {
    const decoder = new PacketDecoder();
    socket.on("data", (chunk) => {
      for (const packet of decoder.feed(chunk)) {
        if (packet.type === PacketAdminType.AdminJoin) {
          const reader = new PacketReader(packet.payload);
          assert.equal(reader.string(), "pw");
          assert.equal(reader.string(), "test-admin");
          assert.equal(reader.string(), "0.0-test");
          const protocol = protocolPacket();
          const welcome = welcomePacket();
          welcomeSent = true;
          socket.write(Buffer.concat([protocol, welcome]));
        }
        if (packet.type === PacketAdminType.AdminUpdateFrequency) {
          assert.equal(welcomeSent, true);
          const reader = new PacketReader(packet.payload);
          assert.equal(reader.uint16(), AdminUpdateType.Gamescript);
          assert.equal(reader.uint16(), 1 << AdminUpdateFrequency.Automatic);
        }
        if (packet.type === PacketAdminType.AdminPing) {
          const id = new PacketReader(packet.payload).uint32();
          socket.write(new PacketWriter(PacketAdminType.ServerPong).uint32(id).build());
        }
        if (packet.type === PacketAdminType.AdminGameScript) {
          const request = new PacketReader(packet.payload).json();
          assert.ok(isRecord(request));
          const id = String(request.request_id);
          const first = new PacketWriter(PacketAdminType.ServerGameScript)
            .json({ request_id: id, chunk_index: 0, chunk_count: 2, chunk: "{\"answer\":" })
            .build();
          const second = new PacketWriter(PacketAdminType.ServerGameScript)
            .json({ request_id: id, chunk_index: 1, chunk_count: 2, chunk: "42}" })
            .build();
          socket.write(Buffer.concat([first, second]));
        }
        if (packet.type === PacketAdminType.AdminRemoteConsoleCommand) {
          const command = new PacketReader(packet.payload).string();
          socket.write(
            Buffer.concat([
              new PacketWriter(PacketAdminType.ServerRemoteConsoleCommand).uint16(1).string("line one").build(),
              new PacketWriter(PacketAdminType.ServerRemoteConsoleCommandEnd).string(command).build(),
            ]),
          );
        }
      }
    });
  });
  if (!mock) return;
  const client = new AdminClient(clientOptions(mock.port));
  await client.connect();
  assert.equal(client.state, "active");
  assert.equal(await client.ping(), 1);
  assert.deepEqual((await client.requestGameScript("observe", { scope: "map" })).payload, { answer: 42 });
  assert.deepEqual(await client.rcon("status"), { command: "status", lines: ["line one"], correlated: true });
  const pending = client.requestGameScript("never", {});
  mock.closeSockets();
  await assert.rejects(pending, /disconnected|socket disconnected/i);
  await client.shutdown();
  await mock.close();
});

test("AdminClient times out correlated GameScript requests", async (t) => {
  const mock = await startMockServerOrSkip(t, (socket) => {
    const decoder = new PacketDecoder();
    socket.on("data", (chunk) => {
      for (const packet of decoder.feed(chunk)) {
        if (packet.type === PacketAdminType.AdminJoin) socket.write(Buffer.concat([protocolPacket(), welcomePacket()]));
      }
    });
  });
  if (!mock) return;
  const client = new AdminClient({ ...clientOptions(mock.port), requestTimeoutMs: 50 });
  await client.connect();
  await assert.rejects(client.requestGameScript("timeout", {}), /Timed out/);
  await client.shutdown();
  await mock.close();
});

test("AdminClient rejects oversized GameScript responses", async (t) => {
  const mock = await startMockServerOrSkip(t, (socket) => {
    const decoder = new PacketDecoder();
    socket.on("data", (chunk) => {
      for (const packet of decoder.feed(chunk)) {
        if (packet.type === PacketAdminType.AdminJoin) socket.write(Buffer.concat([protocolPacket(), welcomePacket()]));
        if (packet.type === PacketAdminType.AdminGameScript) {
          const request = new PacketReader(packet.payload).json();
          assert.ok(isRecord(request));
          socket.write(new PacketWriter(PacketAdminType.ServerGameScript).json({ request_id: String(request.request_id), chunk: "x".repeat(128) }).build());
        }
      }
    });
  });
  if (!mock) return;
  const client = new AdminClient({ ...clientOptions(mock.port), maxResponseBytes: 16 });
  await client.connect();
  await assert.rejects(client.requestGameScript("too_big", {}), /exceeds 16 bytes/);
  await client.shutdown();
  await mock.close();
});

test("AdminClient rejects servers without automatic GameScript updates", async (t) => {
  const mock = await startMockServerOrSkip(t, (socket) => {
    const decoder = new PacketDecoder();
    socket.on("data", (chunk) => {
      for (const packet of decoder.feed(chunk)) {
        if (packet.type === PacketAdminType.AdminJoin) {
          socket.write(Buffer.concat([new PacketWriter(PacketAdminType.ServerProtocol).uint8(2).bool(false).build(), welcomePacket()]));
        }
      }
    });
  });
  if (!mock) return;
  const client = new AdminClient(clientOptions(mock.port));
  await assert.rejects(client.connect(), /does not advertise automatic GameScript updates/);
  await client.shutdown();
  await mock.close();
});

test("AdminClient bounds RCON output", async (t) => {
  const mock = await startMockServerOrSkip(t, (socket) => {
    const decoder = new PacketDecoder();
    socket.on("data", (chunk) => {
      for (const packet of decoder.feed(chunk)) {
        if (packet.type === PacketAdminType.AdminJoin) socket.write(Buffer.concat([protocolPacket(), welcomePacket()]));
        if (packet.type === PacketAdminType.AdminRemoteConsoleCommand) {
          socket.write(new PacketWriter(PacketAdminType.ServerRemoteConsoleCommand).uint16(1).string("x".repeat(32)).build());
        }
      }
    });
  });
  if (!mock) return;
  const client = new AdminClient({ ...clientOptions(mock.port), maxResponseBytes: 16 });
  await client.connect();
  await assert.rejects(client.rcon("status"), /RCON response exceeded/);
  await client.shutdown();
  await mock.close();
});

test("AdminClient rejects connect when peer closes before welcome", { timeout: 2_000 }, async (t) => {
  const mock = await startMockServerOrSkip(t, (socket) => socket.destroy());
  if (!mock) return;
  const client = new AdminClient({ ...clientOptions(mock.port), connectTimeoutMs: 100 });
  await assert.rejects(client.connect(), /disconnected/i);
  await client.shutdown();
  await mock.close();
});

test("AdminClient rejects connection refusal deterministically", { timeout: 2_000 }, async (t) => {
  const reservation = await startMockServerOrSkip(t, () => undefined);
  if (!reservation) return;
  const port = reservation.port;
  await reservation.close();
  const client = new AdminClient({ ...clientOptions(port), connectTimeoutMs: 100 });
  await assert.rejects(client.connect(), /disconnected/i);
  await client.shutdown();
});

test("AdminClient reconnects after an initial pre-welcome disconnect", { timeout: 2_000 }, async (t) => {
  let connections = 0;
  const mock = await startMockServerOrSkip(t, (socket) => {
    connections += 1;
    if (connections === 1) {
      socket.destroy();
      return;
    }
    const decoder = new PacketDecoder();
    socket.on("data", (chunk) => {
      for (const packet of decoder.feed(chunk)) {
        if (packet.type === PacketAdminType.AdminJoin) socket.write(Buffer.concat([protocolPacket(), welcomePacket()]));
      }
    });
  });
  if (!mock) return;
  const client = new AdminClient({
    ...clientOptions(mock.port),
    reconnect: { enabled: true, maxAttempts: 2, initialDelayMs: 10, maxDelayMs: 10 },
  });
  const welcomed = once(client, "welcome");
  await assert.rejects(client.connect(), /disconnected/i);
  await welcomed;
  assert.equal(client.state, "active");
  assert.equal(connections, 2);
  await client.shutdown();
  await mock.close();
});

test("AdminClient permits only one outstanding health ping", async (t) => {
  const mock = await startMockServerOrSkip(t, (socket) => {
    const decoder = new PacketDecoder();
    socket.on("data", (chunk) => {
      for (const packet of decoder.feed(chunk)) {
        if (packet.type === PacketAdminType.AdminJoin) socket.write(Buffer.concat([protocolPacket(), welcomePacket()]));
      }
    });
  });
  if (!mock) return;
  const client = new AdminClient({ ...clientOptions(mock.port), requestTimeoutMs: 50 });
  await client.connect();
  const first = client.ping();
  await assert.rejects(client.ping(), /already pending/);
  await assert.rejects(first, /Timed out waiting for pong/);
  await client.shutdown();
  await mock.close();
});

function clientOptions(port: number): AdminClientOptions {
  return {
    host: "127.0.0.1",
    port,
    password: "pw",
    name: "test-admin",
    version: "0.0-test",
    requestTimeoutMs: 500,
    connectTimeoutMs: 500,
    pingIntervalMs: 0,
    reconnect: { enabled: false, maxAttempts: 0, initialDelayMs: 10, maxDelayMs: 10 },
    maxResponseBytes: 4096,
    maxResponseChunks: 8,
    maxPendingRequests: 4,
  };
}

function protocolPacket(): Buffer {
  return new PacketWriter(PacketAdminType.ServerProtocol)
    .uint8(2)
    .bool(true)
    .uint16(AdminUpdateType.Gamescript)
    .uint16(1 << AdminUpdateFrequency.Automatic)
    .bool(false)
    .build();
}

function welcomePacket(): Buffer {
  return new PacketWriter(PacketAdminType.ServerWelcome)
    .string("server")
    .string("15.1")
    .bool(true)
    .string("map")
    .uint32(1)
    .uint8(0)
    .uint32(0)
    .uint16(256)
    .uint16(256)
    .build();
}

async function startMockServer(onSocket: (socket: Socket) => void): Promise<{ port: number; closeSockets(): void; close(): Promise<void> }> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    onSocket(socket);
  });
  server.listen(0, "127.0.0.1");
  await Promise.race([
    once(server, "listening"),
    once(server, "error").then(([error]) => {
      throw error instanceof Error ? error : new Error("Mock server failed to listen");
    }),
  ]);
  const address = server.address();
  if (!isAddressInfo(address)) throw new Error("Server did not bind to TCP");
  return {
    port: address.port,
    closeSockets() {
      for (const socket of sockets) socket.destroy();
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, "close");
    },
  };
}

async function startMockServerOrSkip(
  t: TestContext,
  onSocket: (socket: Socket) => void,
): Promise<{ port: number; closeSockets(): void; close(): Promise<void> } | undefined> {
  try {
    return await startMockServer(onSocket);
  } catch (error) {
    if (isNodeError(error) && error.code === "EPERM") {
      t.skip("local TCP listeners are blocked by this sandbox");
      return undefined;
    }
    throw error;
  }
}

function isAddressInfo(value: ReturnType<Server["address"]>): value is AddressInfo {
  return typeof value === "object" && value !== null && "port" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
