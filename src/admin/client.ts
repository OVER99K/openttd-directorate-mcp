import { EventEmitter } from "node:events";
import { Socket, createConnection } from "node:net";
import {
  AdminUpdateFrequency,
  AdminUpdateType,
  NetworkAction,
  NetworkChatDestinationType,
  PacketAdminType,
  type AdminPacket,
  type ServerProtocolInfo,
  type ServerWelcomeInfo,
} from "../protocol/admin.js";
import { DEFAULT_CODEC_OPTIONS, PacketDecoder, PacketReader, PacketWriter, type PacketCodecOptions } from "../protocol/codec.js";
import { AdminClientError, ProtocolError } from "../protocol/errors.js";

export type AdminClientState = "idle" | "connecting" | "authenticating" | "active" | "closing" | "closed";

export interface AdminClientOptions {
  readonly host: string;
  readonly port: number;
  readonly password: string;
  readonly name: string;
  readonly version: string;
  readonly requestTimeoutMs: number;
  readonly connectTimeoutMs: number;
  readonly pingIntervalMs: number;
  readonly reconnect: {
    readonly enabled: boolean;
    readonly maxAttempts: number;
    readonly initialDelayMs: number;
    readonly maxDelayMs: number;
  };
  readonly codec?: Partial<PacketCodecOptions>;
  readonly maxResponseBytes: number;
  readonly maxResponseChunks: number;
  readonly maxPendingRequests: number;
}

export interface GameScriptRequest {
  readonly op: string;
  readonly payload: unknown;
}

export interface GameScriptResponse {
  readonly correlation_id: string;
  readonly payload: unknown;
  readonly chunks: number;
  readonly bytes: number;
}

export interface RconResponse {
  readonly command: string;
  readonly lines: readonly string[];
  readonly correlated: true;
}

export interface ChatSendResult {
  readonly message: string;
  readonly correlated: false;
}

interface PendingGameScript {
  readonly requestId: string;
  readonly timeout: NodeJS.Timeout;
  readonly resolve: (value: GameScriptResponse) => void;
  readonly reject: (error: Error) => void;
  readonly chunks: Map<number, string>;
  bytes: number;
  expectedChunks?: number;
}

interface PendingPing {
  readonly timeout: NodeJS.Timeout;
  readonly resolve: (value: number) => void;
  readonly reject: (error: Error) => void;
}

interface PendingRcon {
  readonly command: string;
  readonly timeout: NodeJS.Timeout;
  readonly resolve: (value: RconResponse) => void;
  readonly reject: (error: Error) => void;
  readonly lines: string[];
  bytes: number;
}

export class AdminClient extends EventEmitter {
  private readonly options: AdminClientOptions;
  private readonly decoder: PacketDecoder;
  private socket: Socket | undefined;
  private stateValue: AdminClientState = "idle";
  private connectPromise: Promise<void> | undefined;
  private activeResolve: (() => void) | undefined;
  private activeReject: ((error: Error) => void) | undefined;
  private connectTimer: NodeJS.Timeout | undefined;
  private pingTimer: NodeJS.Timeout | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private reconnectAttempts = 0;
  private requestSeq = 0;
  private pingSeq = 0;
  private readonly pendingGameScript = new Map<string, PendingGameScript>();
  private readonly pendingPings = new Map<number, PendingPing>();
  private pendingRcon: PendingRcon | undefined;
  private protocolInfo: ServerProtocolInfo | undefined;

  public constructor(options: AdminClientOptions) {
    super();
    this.options = options;
    this.decoder = new PacketDecoder({ ...DEFAULT_CODEC_OPTIONS, ...options.codec });
  }

  public get state(): AdminClientState {
    return this.stateValue;
  }

  public async connect(): Promise<void> {
    if (this.stateValue === "active") return;
    if (this.connectPromise) return this.connectPromise;
    this.stateValue = "connecting";
    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.activeResolve = resolve;
      this.activeReject = reject;
      const socket = createConnection({ host: this.options.host, port: this.options.port });
      this.socket = socket;
      this.connectTimer = setTimeout(() => {
        this.failConnect(new AdminClientError("connect_timeout", "Timed out while waiting for Admin welcome"));
        socket.destroy();
      }, this.options.connectTimeoutMs);
      socket.on("connect", () => {
        this.stateValue = "authenticating";
        try {
          this.sendJoin();
        } catch (error) {
          this.closeWithError(error instanceof Error ? error : new Error("Failed to send Admin join"));
        }
      });
      socket.on("data", (chunk) => this.handleData(chunk));
      socket.on("error", (error) => this.handleSocketError(error));
      socket.on("close", () => this.handleSocketClose());
    });
    return this.connectPromise;
  }

  public async shutdown(): Promise<void> {
    this.stateValue = "closing";
    this.clearReconnect();
    this.clearPingTimer();
    try {
      if (this.socket && !this.socket.destroyed) {
        this.write(new PacketWriter(PacketAdminType.AdminQuit).build());
        this.socket.end();
      }
    } finally {
      this.cleanupPending(new AdminClientError("shutdown", "Admin client is shutting down"));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      this.socket?.destroy();
      this.stateValue = "closed";
    }
  }

  public async requestGameScript(op: string, payload: unknown): Promise<GameScriptResponse> {
    await this.ensureActive();
    if (this.pendingGameScript.size >= this.options.maxPendingRequests) {
      throw new AdminClientError("too_many_requests", "Too many pending GameScript requests");
    }
    const requestId = `${Date.now().toString(36)}-${(this.requestSeq += 1).toString(36)}`;
    const message: GameScriptRequest & { readonly request_id: string } = { request_id: requestId, op, payload };
    return new Promise<GameScriptResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingGameScript.delete(requestId);
        reject(new AdminClientError("request_timeout", `Timed out waiting for GameScript response ${requestId}`));
      }, this.options.requestTimeoutMs);
      this.pendingGameScript.set(requestId, {
        requestId,
        timeout,
        resolve,
        reject,
        chunks: new Map<number, string>(),
        bytes: 0,
      });
      try {
        this.write(new PacketWriter(PacketAdminType.AdminGameScript).json(message).build());
      } catch (error) {
        clearTimeout(timeout);
        this.pendingGameScript.delete(requestId);
        reject(error instanceof Error ? error : new Error("Failed to send GameScript request"));
      }
    });
  }

  public async ping(): Promise<number> {
    await this.ensureActive();
    if (this.pendingPings.size >= 1) {
      throw new AdminClientError("ping_pending", "A health ping is already pending");
    }
    const id = (this.pingSeq += 1) >>> 0;
    return new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingPings.delete(id);
        reject(new AdminClientError("ping_timeout", `Timed out waiting for pong ${id}`));
      }, this.options.requestTimeoutMs);
      this.pendingPings.set(id, { timeout, resolve, reject });
      try {
        this.write(new PacketWriter(PacketAdminType.AdminPing).uint32(id).build());
      } catch (error) {
        clearTimeout(timeout);
        this.pendingPings.delete(id);
        reject(error instanceof Error ? error : new Error("Failed to send ping"));
      }
    });
  }

  public async rcon(command: string): Promise<RconResponse> {
    await this.ensureActive();
    if (this.pendingRcon) {
      throw new AdminClientError("rcon_busy", "Only one RCON request may be pending because the protocol has no request id");
    }
    return new Promise<RconResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRcon = undefined;
        reject(new AdminClientError("rcon_timeout", `Timed out waiting for RCON end for ${command}`));
      }, this.options.requestTimeoutMs);
      this.pendingRcon = { command, timeout, resolve, reject, lines: [], bytes: 0 };
      try {
        this.write(new PacketWriter(PacketAdminType.AdminRemoteConsoleCommand).string(command).build());
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRcon = undefined;
        reject(error instanceof Error ? error : new Error("Failed to send RCON command"));
      }
    });
  }

  public async chat(message: string, destination = NetworkChatDestinationType.Broadcast, destinationId = 0): Promise<ChatSendResult> {
    await this.ensureActive();
    this.write(
      new PacketWriter(PacketAdminType.AdminChat)
        .uint8(NetworkAction.ServerMessage)
        .uint8(destination)
        .uint32(destinationId)
        .string(message)
        .build(),
    );
    return { message, correlated: false };
  }

  private sendJoin(): void {
    this.write(new PacketWriter(PacketAdminType.AdminJoin).string(this.options.password).string(this.options.name).string(this.options.version).build());
  }

  private handleData(chunk: Buffer): void {
    let packets: AdminPacket[];
    try {
      packets = this.decoder.feed(chunk);
    } catch (error) {
      this.closeWithError(error instanceof Error ? error : new Error("Packet decode failed"));
      return;
    }
    for (const packet of packets) this.routePacket(packet);
  }

  private routePacket(packet: AdminPacket): void {
    try {
      switch (packet.type) {
        case PacketAdminType.ServerProtocol:
          this.protocolInfo = this.readProtocol(packet.payload);
          this.emit("protocol", this.protocolInfo);
          break;
        case PacketAdminType.ServerWelcome:
          this.emit("welcome", this.readWelcome(packet.payload));
          this.subscribeGameScript();
          this.markActive();
          break;
        case PacketAdminType.ServerPong:
          this.handlePong(packet.payload);
          break;
        case PacketAdminType.ServerGameScript:
          this.handleGameScript(packet.payload);
          break;
        case PacketAdminType.ServerRemoteConsoleCommand:
          this.handleRconLine(packet.payload);
          break;
        case PacketAdminType.ServerRemoteConsoleCommandEnd:
          this.handleRconEnd(packet.payload);
          break;
        case PacketAdminType.ServerError:
        case PacketAdminType.ServerFull:
        case PacketAdminType.ServerBanned:
        case PacketAdminType.ServerAuthenticationRequest:
        case PacketAdminType.ServerEnableEncryption:
          this.closeWithError(new AdminClientError("server_rejected", `Server sent unsupported or fatal packet ${packet.type}`));
          break;
        default:
          this.emit("packet", packet);
          break;
      }
    } catch (error) {
      this.closeWithError(error instanceof Error ? error : new Error("Packet route failed"));
    }
  }

  private readProtocol(payload: Buffer): ServerProtocolInfo {
    const reader = new PacketReader(payload);
    const protocolVersion = reader.uint8();
    const updateFrequencies = new Map<number, number>();
    for (let guard = 0; reader.remaining() > 0 && guard < 64; guard += 1) {
      if (!reader.bool()) break;
      updateFrequencies.set(reader.uint16(), reader.uint16());
    }
    return { protocolVersion, updateFrequencies };
  }

  private readWelcome(payload: Buffer): ServerWelcomeInfo {
    const reader = new PacketReader(payload);
    return {
      serverName: reader.string(),
      openttdVersion: reader.string(),
      dedicated: reader.bool(),
      mapName: reader.string(),
      mapSeed: reader.uint32(),
      landscape: reader.uint8(),
      startDate: reader.uint32(),
      mapWidth: reader.uint16(),
      mapHeight: reader.uint16(),
    };
  }

  private handlePong(payload: Buffer): void {
    const id = new PacketReader(payload).uint32();
    const pending = this.pendingPings.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingPings.delete(id);
    pending.resolve(id);
  }

  private handleGameScript(payload: Buffer): void {
    const message = new PacketReader(payload).json();
    if (!isRecord(message)) throw new ProtocolError("gamescript_shape", "GameScript payload must be a JSON object");
    const requestId = readStringField(message, "request_id") ?? readStringField(message, "id") ?? readStringField(message, "correlation_id");
    if (!requestId) throw new ProtocolError("gamescript_missing_id", "GameScript response lacks a request_id/correlation_id");
    const pending = this.pendingGameScript.get(requestId);
    if (!pending) return;

    const chunkIndex = readNumberField(message, "chunk_index") ?? 0;
    const chunkCount = readNumberField(message, "chunk_count") ?? readNumberField(message, "total_chunks") ?? 1;
    if (!Number.isInteger(chunkIndex) || !Number.isInteger(chunkCount) || chunkIndex < 0 || chunkCount < 1 || chunkIndex >= chunkCount) {
      throw new ProtocolError("gamescript_chunk_index", "Invalid GameScript chunk metadata");
    }
    if (chunkCount > this.options.maxResponseChunks) {
      throw new ProtocolError("gamescript_too_many_chunks", `GameScript response exceeds ${this.options.maxResponseChunks} chunks`);
    }
    if (pending.expectedChunks !== undefined && pending.expectedChunks !== chunkCount) {
      throw new ProtocolError("gamescript_chunk_count_changed", "GameScript response changed its declared chunk count");
    }
    if (pending.chunks.has(chunkIndex)) {
      throw new ProtocolError("gamescript_duplicate_chunk", `GameScript response repeated chunk ${chunkIndex}`);
    }
    const chunkPayload = readStringField(message, "chunk") ?? JSON.stringify(message.payload ?? null);
    const bytes = Buffer.byteLength(chunkPayload, "utf8");
    pending.bytes += bytes;
    if (pending.bytes > this.options.maxResponseBytes) {
      throw new ProtocolError("gamescript_response_too_large", `GameScript response exceeds ${this.options.maxResponseBytes} bytes`);
    }
    pending.expectedChunks = chunkCount;
    pending.chunks.set(chunkIndex, chunkPayload);
    if (pending.chunks.size !== chunkCount) return;

    const parts: string[] = [];
    for (let index = 0; index < chunkCount; index += 1) {
      const part = pending.chunks.get(index);
      if (part === undefined) return;
      parts.push(part);
    }
    clearTimeout(pending.timeout);
    this.pendingGameScript.delete(requestId);
    const combined = parts.join("");
    const parsed = parseJsonOrText(combined);
    pending.resolve({ correlation_id: requestId, payload: parsed, chunks: chunkCount, bytes: pending.bytes });
  }

  private handleRconLine(payload: Buffer): void {
    const reader = new PacketReader(payload);
    reader.uint16();
    const text = reader.string();
    if (!this.pendingRcon) return;
    this.pendingRcon.bytes += Buffer.byteLength(text, "utf8");
    if (this.pendingRcon.bytes > this.options.maxResponseBytes || this.pendingRcon.lines.length >= this.options.maxResponseChunks) {
      throw new ProtocolError("rcon_response_too_large", "RCON response exceeded configured line or byte bounds");
    }
    this.pendingRcon.lines.push(text);
  }

  private handleRconEnd(payload: Buffer): void {
    const command = new PacketReader(payload).string();
    const pending = this.pendingRcon;
    if (!pending || pending.command !== command) return;
    clearTimeout(pending.timeout);
    this.pendingRcon = undefined;
    pending.resolve({ command, lines: [...pending.lines], correlated: true });
  }

  private markActive(): void {
    if (this.stateValue === "active") return;
    this.stateValue = "active";
    this.reconnectAttempts = 0;
    this.clearReconnect();
    this.clearConnectTimer();
    this.activeResolve?.();
    this.activeResolve = undefined;
    this.activeReject = undefined;
    this.startPingTimer();
  }

  private async ensureActive(): Promise<void> {
    if (this.stateValue !== "active") await this.connect();
    if (this.stateValue !== "active") throw new AdminClientError("not_active", "Admin client is not active");
  }

  private write(buffer: Buffer): void {
    if (!this.socket || this.socket.destroyed) throw new AdminClientError("socket_closed", "Admin socket is closed");
    this.socket.write(buffer);
  }

  private handleSocketError(error: Error): void {
    this.emitClientError(error);
  }

  private handleSocketClose(): void {
    this.clearConnectTimer();
    this.clearPingTimer();
    const wasClosing = this.stateValue === "closing" || this.stateValue === "closed";
    if (!wasClosing) {
      const error = new AdminClientError("disconnected", "Admin socket disconnected");
      if (this.stateValue !== "active") this.failConnect(error);
      this.cleanupPending(error);
    }
    this.connectPromise = undefined;
    this.socket = undefined;
    this.protocolInfo = undefined;
    this.decoder.reset();
    this.stateValue = "closed";
    if (!wasClosing && this.options.reconnect.enabled) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.options.reconnect.maxAttempts) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(
      this.options.reconnect.initialDelayMs * 2 ** (this.reconnectAttempts - 1),
      this.options.reconnect.maxDelayMs,
    );
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error: unknown) => {
        this.emitClientError(error instanceof Error ? error : new Error("Reconnect failed"));
      });
    }, delay);
  }

  private startPingTimer(): void {
    this.clearPingTimer();
    if (this.options.pingIntervalMs <= 0) return;
    this.pingTimer = setInterval(() => {
      this.ping().catch((error: unknown) => this.emitClientError(error instanceof Error ? error : new Error("Ping failed")));
    }, this.options.pingIntervalMs);
  }

  private clearPingTimer(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private failConnect(error: Error): void {
    this.clearConnectTimer();
    this.activeReject?.(error);
    this.activeResolve = undefined;
    this.activeReject = undefined;
    this.connectPromise = undefined;
  }

  private closeWithError(error: Error): void {
    this.failConnect(error);
    this.cleanupPending(error);
    this.socket?.destroy();
  }

  private cleanupPending(error: Error): void {
    for (const pending of this.pendingGameScript.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingGameScript.clear();
    for (const pending of this.pendingPings.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingPings.clear();
    if (this.pendingRcon) {
      clearTimeout(this.pendingRcon.timeout);
      this.pendingRcon.reject(error);
      this.pendingRcon = undefined;
    }
  }

  private subscribeGameScript(): void {
    const supported = this.protocolInfo?.updateFrequencies.get(AdminUpdateType.Gamescript);
    const automaticBit = 1 << AdminUpdateFrequency.Automatic;
    if (supported === undefined || (supported & automaticBit) === 0) {
      throw new AdminClientError("gamescript_updates_unsupported", "Server does not advertise automatic GameScript updates");
    }
    this.write(
      new PacketWriter(PacketAdminType.AdminUpdateFrequency)
        .uint16(AdminUpdateType.Gamescript)
        .uint16(automaticBit)
        .build(),
    );
  }

  private emitClientError(error: Error): void {
    if (this.listenerCount("error") > 0) this.emit("error", error);
    else this.emit("clientError", error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readNumberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function parseJsonOrText(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
