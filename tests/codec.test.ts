import assert from "node:assert/strict";
import test from "node:test";
import { PacketAdminType } from "../src/protocol/admin.js";
import { PacketDecoder, PacketReader, PacketWriter } from "../src/protocol/codec.js";
import { ProtocolError } from "../src/protocol/errors.js";

test("packet codec supports little-endian primitives and NUL strings", () => {
  const buffer = new PacketWriter(PacketAdminType.AdminPing).uint8(7).uint16(0x1234).uint32(0x12345678).string("hello").build();
  assert.equal(buffer.readUInt16LE(0), buffer.length);
  assert.equal(buffer[2], PacketAdminType.AdminPing);
  assert.deepEqual([...buffer.subarray(4, 6)], [0x34, 0x12]);
  assert.deepEqual([...buffer.subarray(6, 10)], [0x78, 0x56, 0x34, 0x12]);

  const decoder = new PacketDecoder();
  const packets = decoder.feed(buffer);
  assert.equal(packets.length, 1);
  const packet = packets[0];
  assert.ok(packet);
  const reader = new PacketReader(packet.payload);
  assert.equal(reader.uint8(), 7);
  assert.equal(reader.uint16(), 0x1234);
  assert.equal(reader.uint32(), 0x12345678);
  assert.equal(reader.string(), "hello");
});

test("decoder handles fragmentation and coalesced packets", () => {
  const first = new PacketWriter(PacketAdminType.AdminPing).uint32(1).build();
  const second = new PacketWriter(PacketAdminType.AdminQuit).build();
  const decoder = new PacketDecoder();
  assert.deepEqual(decoder.feed(first.subarray(0, 2)), []);
  const decoded = decoder.feed(Buffer.concat([first.subarray(2), second]));
  assert.equal(decoded.length, 2);
  assert.equal(decoded[0]?.type, PacketAdminType.AdminPing);
  assert.equal(decoded[1]?.type, PacketAdminType.AdminQuit);
});

test("decoder rejects oversized packets", () => {
  const decoder = new PacketDecoder({ maxPacketBytes: 8, maxBufferedBytes: 64, maxStringBytes: 8 });
  const packet = Buffer.alloc(9);
  packet.writeUInt16LE(9, 0);
  packet.writeUInt8(PacketAdminType.AdminPing, 2);
  assert.throws(() => decoder.feed(packet), ProtocolError);
});

test("reader rejects unterminated strings", () => {
  assert.throws(() => new PacketReader(Buffer.from("missing")).string(), ProtocolError);
});
