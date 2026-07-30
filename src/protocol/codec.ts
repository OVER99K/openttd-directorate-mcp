import { MIN_PACKET_BYTES, PACKET_SIZE_BYTES, PACKET_TYPE_BYTES, type AdminPacket } from "./admin.js";
import { ProtocolError } from "./errors.js";

export interface PacketCodecOptions {
  readonly maxPacketBytes: number;
  readonly maxBufferedBytes: number;
  readonly maxStringBytes: number;
}

export const DEFAULT_CODEC_OPTIONS: PacketCodecOptions = {
  maxPacketBytes: 1460,
  maxBufferedBytes: 64 * 1024,
  maxStringBytes: 4096,
};

export class PacketWriter {
  private readonly parts: Buffer[] = [];
  private byteLength = MIN_PACKET_BYTES;

  public constructor(
    private readonly type: number,
    private readonly maxPacketBytes = DEFAULT_CODEC_OPTIONS.maxPacketBytes,
  ) {}

  public uint8(value: number): this {
    this.pushByte(Buffer.from([checkedInteger(value, 0xff, "uint8")]));
    return this;
  }

  public bool(value: boolean): this {
    return this.uint8(value ? 1 : 0);
  }

  public uint16(value: number): this {
    const buffer = Buffer.allocUnsafe(2);
    buffer.writeUInt16LE(checkedInteger(value, 0xffff, "uint16"), 0);
    this.pushByte(buffer);
    return this;
  }

  public uint32(value: number): this {
    const buffer = Buffer.allocUnsafe(4);
    buffer.writeUInt32LE(checkedInteger(value, 0xffffffff, "uint32"), 0);
    this.pushByte(buffer);
    return this;
  }

  public uint64(value: bigint): this {
    if (value < 0n || value > 0xffffffffffffffffn) {
      throw new ProtocolError("uint64_range", "uint64 is outside the valid range");
    }
    const buffer = Buffer.allocUnsafe(8);
    buffer.writeBigUInt64LE(value, 0);
    this.pushByte(buffer);
    return this;
  }

  public string(value: string): this {
    if (value.includes("\0")) {
      throw new ProtocolError("string_nul", "Admin strings cannot contain embedded NUL bytes");
    }
    this.pushByte(Buffer.from(value, "utf8"));
    this.pushByte(Buffer.from([0]));
    return this;
  }

  public json(value: unknown): this {
    return this.string(JSON.stringify(value));
  }

  public build(): Buffer {
    if (this.byteLength > 0xffff) {
      throw new ProtocolError("packet_uint16_size", "Packet size exceeds the uint16 wire limit");
    }
    const header = Buffer.allocUnsafe(MIN_PACKET_BYTES);
    header.writeUInt16LE(this.byteLength, 0);
    header.writeUInt8(checkedInteger(this.type, 0xff, "packet type"), PACKET_SIZE_BYTES);
    return Buffer.concat([header, ...this.parts], this.byteLength);
  }

  private pushByte(buffer: Buffer): void {
    const nextLength = this.byteLength + buffer.length;
    if (nextLength > this.maxPacketBytes) {
      throw new ProtocolError("packet_too_large", `Packet would exceed ${this.maxPacketBytes} bytes`);
    }
    this.parts.push(buffer);
    this.byteLength = nextLength;
  }
}

export class PacketReader {
  private offset = 0;

  public constructor(
    private readonly payload: Buffer,
    private readonly maxStringBytes = DEFAULT_CODEC_OPTIONS.maxStringBytes,
  ) {}

  public remaining(): number {
    return this.payload.length - this.offset;
  }

  public uint8(): number {
    this.require(1);
    const value = this.payload.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  public bool(): boolean {
    return this.uint8() !== 0;
  }

  public uint16(): number {
    this.require(2);
    const value = this.payload.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  public uint32(): number {
    this.require(4);
    const value = this.payload.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  public uint64(): bigint {
    this.require(8);
    const value = this.payload.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  public string(maxBytes = this.maxStringBytes): string {
    const limit = Math.min(this.payload.length, this.offset + maxBytes + 1);
    const nulAt = this.payload.indexOf(0, this.offset);
    if (nulAt < 0 || nulAt >= limit) {
      throw new ProtocolError("unterminated_string", "Admin string is not NUL terminated within the configured bound");
    }
    const value = this.payload.toString("utf8", this.offset, nulAt);
    this.offset = nulAt + 1;
    return value;
  }

  public json(): unknown {
    const raw = this.string();
    try {
      return JSON.parse(raw) as unknown;
    } catch (error) {
      throw new ProtocolError("invalid_json", error instanceof Error ? error.message : "Invalid JSON payload");
    }
  }

  public skipRemaining(): void {
    this.offset = this.payload.length;
  }

  private require(byteCount: number): void {
    if (this.offset + byteCount > this.payload.length) {
      throw new ProtocolError("truncated_packet", "Packet payload ended before the requested field");
    }
  }
}

export class PacketDecoder {
  private buffer = Buffer.alloc(0);

  public constructor(private readonly options: PacketCodecOptions = DEFAULT_CODEC_OPTIONS) {}

  public feed(chunk: Buffer): AdminPacket[] {
    const nextLength = this.buffer.length + chunk.length;
    if (nextLength > this.options.maxBufferedBytes) {
      throw new ProtocolError("buffer_too_large", `Buffered TCP input would exceed ${this.options.maxBufferedBytes} bytes`);
    }
    this.buffer = Buffer.concat([this.buffer, chunk], nextLength);
    const packets: AdminPacket[] = [];

    while (this.buffer.length >= PACKET_SIZE_BYTES) {
      const packetLength = this.buffer.readUInt16LE(0);
      if (packetLength < MIN_PACKET_BYTES) {
        throw new ProtocolError("invalid_packet_size", `Packet length ${packetLength} is below ${MIN_PACKET_BYTES}`);
      }
      if (packetLength > this.options.maxPacketBytes) {
        throw new ProtocolError("packet_too_large", `Packet length ${packetLength} exceeds ${this.options.maxPacketBytes}`);
      }
      if (this.buffer.length < packetLength) break;

      const type = this.buffer.readUInt8(PACKET_SIZE_BYTES);
      const payload = this.buffer.subarray(MIN_PACKET_BYTES, packetLength);
      packets.push({ type, payload });
      this.buffer = this.buffer.subarray(packetLength);
    }

    return packets;
  }

  public bufferedBytes(): number {
    return this.buffer.length;
  }

  public reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

function checkedInteger(value: number, max: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new ProtocolError("integer_range", `${field} is outside the valid range`);
  }
  return value;
}
