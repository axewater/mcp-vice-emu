/**
 * VICE Binary Monitor Protocol Implementation
 * Protocol version: 0x01 (VICE 3.5+)
 */

import { Socket } from 'net';

// Protocol constants
const STX = 0x02;
const API_VERSION = 0x02;  // VICE 3.7+ uses API v2

// Command IDs
export const CMD = {
  MEMORY_GET: 0x01,
  MEMORY_SET: 0x02,
  CHECKPOINT_GET: 0x11,
  CHECKPOINT_SET: 0x12,
  CHECKPOINT_DELETE: 0x13,
  CHECKPOINT_LIST: 0x14,
  CHECKPOINT_TOGGLE: 0x15,
  REGISTERS_GET: 0x31,
  REGISTERS_SET: 0x32,
  ADVANCE_INSTRUCTIONS: 0x71,
  EXECUTE_UNTIL_RETURN: 0x73,
  PING: 0x81,
  BANKS_AVAILABLE: 0x82,
  SCREEN_GET: 0x84,
  CPU_HISTORY: 0x86,
  RESUME: 0xaa,
  RESET: 0xcc,
  AUTOSTART: 0xdd,
} as const;

// Memory spaces
export const MEMSPACE = {
  MAIN_MEMORY: 0x00,
  DRIVE_8: 0x01,
  DRIVE_9: 0x02,
} as const;

// Register IDs
export const REG = {
  A: 0x00,
  X: 0x01,
  Y: 0x02,
  PC: 0x03,
  SP: 0x04,
  FLAGS: 0x05,
} as const;

// Checkpoint operation types
export const CHECKPOINT_OP = {
  LOAD: 0x01,
  STORE: 0x02,
  EXEC: 0x04,
} as const;

export interface ViceRegisters {
  A: number;
  X: number;
  Y: number;
  PC: number;
  SP: number;
  FLAGS: number;
}

export interface ViceCheckpoint {
  id: number;
  startAddr: number;
  endAddr: number;
  enabled: boolean;
  operation: number;
}

export interface ViceCpuHistoryEntry {
  PC: number;
  A: number;
  X: number;
  Y: number;
  SP: number;
  FLAGS: number;
  opcode: number;
  disassembly?: string;
}

/**
 * Low-level VICE binary protocol implementation
 */
export class ViceProtocol {
  private socket: Socket;
  private responseQueue: Array<{
    resolve: (data: Buffer) => void;
    reject: (error: Error) => void;
  }> = [];
  private receiveBuffer = Buffer.alloc(0);
  private requestId = 0;

  constructor(socket: Socket) {
    this.socket = socket;
    this.socket.on('data', (data) => this.handleData(data));
  }

  private handleData(data: Buffer): void {
    this.receiveBuffer = Buffer.concat([this.receiveBuffer, data]);

    while (this.receiveBuffer.length >= 12) {  // Minimum response header size for API v2
      // Check for STX
      if (this.receiveBuffer[0] !== STX) {
        // Skip invalid byte silently (might be async events from VICE)
        this.receiveBuffer = this.receiveBuffer.subarray(1);
        continue;
      }

      // Check API version
      const responseApiVersion = this.receiveBuffer[1];
      if (responseApiVersion !== API_VERSION) {
        console.error('Unsupported API version:', responseApiVersion, 'expected:', API_VERSION);
        this.receiveBuffer = this.receiveBuffer.subarray(1);
        continue;
      }

      // Read body length (bytes 2-5, little-endian)
      const bodyLength = this.receiveBuffer.readUInt32LE(2);

      // Sanity check on body length (prevent huge allocations)
      if (bodyLength > 10 * 1024 * 1024) {
        console.error('Body length too large:', bodyLength);
        this.receiveBuffer = this.receiveBuffer.subarray(1);
        continue;
      }

      // Response: STX(1) + API(1) + LEN(4) + TYPE(1) + ERR(1) + REQ_ID(4) + BODY
      // Total header size: 12 bytes
      const totalLength = 12 + bodyLength;

      if (this.receiveBuffer.length < totalLength) {
        // Wait for more data
        break;
      }

      // Extract complete message
      const message = this.receiveBuffer.subarray(0, totalLength);
      this.receiveBuffer = this.receiveBuffer.subarray(totalLength);

      // Parse response header (API v2 format)
      const responseType = message[6];      // 1 byte at offset 6
      const errorCode = message[7];         // 1 byte at offset 7
      const requestId = message.readUInt32LE(8);  // 4 bytes at offset 8-11

      // Debug logging
      console.error(`[RECV] type=0x${responseType.toString(16).padStart(2, '0')} err=0x${errorCode.toString(16).padStart(2, '0')} reqId=0x${requestId.toString(16).padStart(8, '0')} bodyLen=${bodyLength} queue=${this.responseQueue.length}`);

      // Skip async events (reqId = 0xFFFFFFFF)
      if (requestId === 0xFFFFFFFF) {
        console.error(`[RECV] Skipping async event`);
        continue;
      }

      // Simple FIFO - get next waiting handler
      const handler = this.responseQueue.shift();
      if (handler) {
        console.error(`[RECV] Matched to handler (queue now ${this.responseQueue.length})`);
        // Check for errors
        if (errorCode !== 0) {
          handler.reject(new Error(`VICE error code: 0x${errorCode.toString(16).padStart(2, '0')}`));
        } else {
          // Extract payload (skip 12-byte header)
          const payload = message.subarray(12);
          handler.resolve(payload);
        }
      } else {
        console.error(`[RECV] WARNING: No handler waiting for response!`);
      }
    }
  }

  private calculateChecksum(data: Buffer): number {
    let checksum = 0;
    // XOR all bytes from API_VERSION to end of payload
    for (let i = 1; i < data.length; i++) {
      checksum ^= data[i];
    }
    return checksum;
  }

  private verifyChecksum(message: Buffer): boolean {
    const calculated = this.calculateChecksum(message.subarray(0, message.length - 1));
    const received = message[message.length - 1];
    return calculated === received;
  }

  private async sendCommand(commandId: number, payload: Buffer = Buffer.alloc(0)): Promise<Buffer> {
    // Increment request ID
    this.requestId++;

    // Request for API v2: STX(1) + API(1) + LEN(4) + REQ_ID(4) + CMD(1) + PAYLOAD + CHECKSUM(1)
    // IMPORTANT: Body length = CMD(1) + payload ONLY (does NOT include REQ_ID!)
    const bodyLength = 1 + payload.length;
    const packet = Buffer.alloc(6 + 4 + 1 + payload.length + 1); // STX+API+LEN+REQ_ID+CMD+PAYLOAD+CHECKSUM

    let offset = 0;
    packet[offset++] = STX;
    packet[offset++] = API_VERSION;
    packet.writeUInt32LE(bodyLength, offset);
    offset += 4;
    packet.writeUInt32LE(this.requestId, offset);
    offset += 4;
    packet[offset++] = commandId;
    payload.copy(packet, offset);

    // Calculate and append checksum (XOR of all bytes from API_VERSION onwards, excluding checksum byte)
    const checksum = this.calculateChecksum(packet.subarray(0, packet.length - 1));
    packet[packet.length - 1] = checksum;

    // Debug logging
    console.error(`[SEND] CMD=0x${commandId.toString(16).padStart(2, '0')} reqId=0x${this.requestId.toString(16).padStart(8, '0')} bodyLen=${bodyLength} packet=${packet.length}b`);
    console.error(`[SEND]`, Array.from(packet).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));

    return new Promise((resolve, reject) => {
      this.responseQueue.push({ resolve, reject });
      this.socket.write(packet, (err) => {
        if (err) {
          this.responseQueue.pop();
          reject(err);
        }
      });

      // Timeout after 10 seconds (autostart needs more time)
      setTimeout(() => {
        const idx = this.responseQueue.findIndex(h => h.resolve === resolve);
        if (idx >= 0) {
          this.responseQueue.splice(idx, 1);
          reject(new Error('Command timeout'));
        }
      }, 10000);
    });
  }

  private checkError(response: Buffer): void {
    // Error checking now done in handleData, this is just for backward compat
    if (response.length < 0) {
      throw new Error('Response too short');
    }
  }

  /**
   * Ping the monitor to check if it's alive
   */
  async ping(): Promise<void> {
    const response = await this.sendCommand(CMD.PING);
    this.checkError(response);
  }

  /**
   * Read memory range
   */
  async memoryGet(
    startAddr: number,
    endAddr: number,
    memspace: number = MEMSPACE.MAIN_MEMORY,
    bankId: number = 0,
    sidefx: boolean = false
  ): Promise<Buffer> {
    const payload = Buffer.alloc(8);  // sidefx(1) + start(2) + end(2) + memspace(1) + bank(2)
    payload.writeUInt8(sidefx ? 1 : 0, 0);  // Side effects control
    payload.writeUInt16LE(startAddr, 1);
    payload.writeUInt16LE(endAddr, 3);
    payload.writeUInt8(memspace, 5);
    payload.writeUInt16LE(bankId, 6);  // Bank is 2 bytes (16-bit LE)

    const response = await this.sendCommand(CMD.MEMORY_GET, payload);

    // Response format: [LENGTH_LE_16] [DATA...]
    // Skip the 2-byte length header and return just the memory data
    return response.subarray(2);
  }

  /**
   * Write memory
   */
  async memorySet(
    startAddr: number,
    data: Buffer,
    memspace: number = MEMSPACE.MAIN_MEMORY,
    bankId: number = 0,
    sidefx: boolean = false
  ): Promise<void> {
    const endAddr = startAddr + data.length - 1;
    const payload = Buffer.alloc(8 + data.length);  // sidefx(1) + start(2) + end(2) + memspace(1) + bank(2) + data
    payload.writeUInt8(sidefx ? 1 : 0, 0);  // Side effects control
    payload.writeUInt16LE(startAddr, 1);
    payload.writeUInt16LE(endAddr, 3);
    payload.writeUInt8(memspace, 5);
    payload.writeUInt16LE(bankId, 6);  // Bank is 2 bytes (16-bit LE)
    data.copy(payload, 8);

    await this.sendCommand(CMD.MEMORY_SET, payload);
  }

  /**
   * Get CPU registers
   */
  async registersGet(memspace: number = MEMSPACE.MAIN_MEMORY): Promise<ViceRegisters> {
    const payload = Buffer.alloc(1);
    payload.writeUInt8(memspace, 0);

    const response = await this.sendCommand(CMD.REGISTERS_GET, payload);

    const registers: Partial<ViceRegisters> = {};
    const count = response.readUInt16LE(0);  // Count is 2 bytes (little-endian)
    let offset = 2;

    for (let i = 0; i < count && offset < response.length; i++) {
      const itemSize = response.readUInt8(offset);  // Total size of this item (ID + value)
      const id = response.readUInt8(offset + 1);
      const valueSize = itemSize - 1;  // Size minus ID byte

      let value = 0;
      if (valueSize === 1) {
        value = response.readUInt8(offset + 2);
      } else if (valueSize === 2) {
        value = response.readUInt16LE(offset + 2);
      } else if (valueSize === 4) {
        value = response.readUInt32LE(offset + 2);
      }

      offset += 1 + itemSize;  // Skip item_size byte + item content

      switch (id) {
        case REG.A: registers.A = value; break;
        case REG.X: registers.X = value; break;
        case REG.Y: registers.Y = value; break;
        case REG.PC: registers.PC = value; break;
        case REG.SP: registers.SP = value; break;
        case REG.FLAGS: registers.FLAGS = value; break;
      }
    }

    return registers as ViceRegisters;
  }

  /**
   * Set CPU registers
   * Payload format: MS(1) + RC(2) + [IS(1) + RI(1) + RV(2)] * RC
   * IS is ALWAYS 3 (size of RI + RV, excluding IS byte itself)
   * RV is ALWAYS 2 bytes (little-endian)
   */
  async registersSet(registers: Partial<ViceRegisters>, memspace: number = MEMSPACE.MAIN_MEMORY): Promise<void> {
    const entries: Array<{ id: number; value: number }> = [];

    if (registers.A !== undefined) entries.push({ id: REG.A, value: registers.A });
    if (registers.X !== undefined) entries.push({ id: REG.X, value: registers.X });
    if (registers.Y !== undefined) entries.push({ id: REG.Y, value: registers.Y });
    if (registers.PC !== undefined) entries.push({ id: REG.PC, value: registers.PC });
    if (registers.SP !== undefined) entries.push({ id: REG.SP, value: registers.SP });
    if (registers.FLAGS !== undefined) entries.push({ id: REG.FLAGS, value: registers.FLAGS });

    const payloadSize = 3 + entries.length * 4; // MS(1) + RC(2) + 4 bytes per register
    const payload = Buffer.alloc(payloadSize);
    payload.writeUInt8(memspace, 0);
    payload.writeUInt16LE(entries.length, 1);  // RC is 2 bytes!

    let offset = 3;  // Start after MS(1) + RC(2)
    for (const entry of entries) {
      payload.writeUInt8(3, offset);               // IS: always 3 (size of RI + RV)
      payload.writeUInt8(entry.id, offset + 1);    // RI: register ID
      payload.writeUInt16LE(entry.value, offset + 2);  // RV: always 2 bytes (little-endian)
      offset += 4;  // Always 4 bytes per item: IS(1) + RI(1) + RV(2)
    }

    await this.sendCommand(CMD.REGISTERS_SET, payload);
  }

  /**
   * Set a checkpoint (breakpoint/watchpoint)
   */
  async checkpointSet(
    startAddr: number,
    endAddr: number,
    operation: number = CHECKPOINT_OP.EXEC,
    stopWhenHit: boolean = true,
    enabled: boolean = true,
    cpuType: number = 0,
    tempUntilHit: boolean = false
  ): Promise<number> {
    const payload = Buffer.alloc(15);
    payload.writeUInt32LE(startAddr, 0);
    payload.writeUInt32LE(endAddr, 4);
    payload.writeUInt8(stopWhenHit ? 1 : 0, 8);
    payload.writeUInt8(enabled ? 1 : 0, 9);
    payload.writeUInt8(cpuType, 10);
    payload.writeUInt8(operation, 11);
    payload.writeUInt8(tempUntilHit ? 1 : 0, 14);

    const response = await this.sendCommand(CMD.CHECKPOINT_SET, payload);
    return response.readUInt32LE(0); // Checkpoint ID
  }

  /**
   * Delete a checkpoint
   */
  async checkpointDelete(checkpointId: number): Promise<void> {
    const payload = Buffer.alloc(4);
    payload.writeUInt32LE(checkpointId, 0);

    await this.sendCommand(CMD.CHECKPOINT_DELETE, payload);
  }

  /**
   * Step N instructions
   */
  async advanceInstructions(count: number = 1, stepOver: boolean = false): Promise<void> {
    const payload = Buffer.alloc(3);
    payload.writeUInt8(stepOver ? 1 : 0, 0);
    payload.writeUInt16LE(count, 1);

    await this.sendCommand(CMD.ADVANCE_INSTRUCTIONS, payload);
  }

  /**
   * Resume execution (continue)
   */
  async resume(): Promise<void> {
    await this.sendCommand(CMD.RESUME);
  }

  /**
   * Execute until RTS or RTI
   */
  async executeUntilReturn(): Promise<void> {
    await this.sendCommand(CMD.EXECUTE_UNTIL_RETURN);
  }

  /**
   * Reset the machine
   */
  async reset(hardReset: boolean = false): Promise<void> {
    const payload = Buffer.alloc(1);
    payload.writeUInt8(hardReset ? 1 : 0, 0);

    await this.sendCommand(CMD.RESET, payload);
  }

  /**
   * Autostart a program
   * Payload format: RL(1) + FI(2) + FL(1) + FN(FL bytes)
   */
  async autostart(filename: string, runMode: number = 0, fileIndex: number = 0): Promise<void> {
    const filenameBuffer = Buffer.from(filename, 'utf8');
    const payload = Buffer.alloc(4 + filenameBuffer.length);
    payload.writeUInt8(runMode, 0);              // RL: Run after loading
    payload.writeUInt16LE(fileIndex, 1);         // FI: File index (2 bytes)
    payload.writeUInt8(filenameBuffer.length, 3); // FL: Filename length
    filenameBuffer.copy(payload, 4);             // FN: Filename

    await this.sendCommand(CMD.AUTOSTART, payload);
  }

  /**
   * Get CPU execution history
   */
  async cpuHistory(count: number = 50, format: number = 0): Promise<ViceCpuHistoryEntry[]> {
    const payload = Buffer.alloc(3);
    payload.writeUInt16LE(count, 0);
    payload.writeUInt8(format, 2);

    const response = await this.sendCommand(CMD.CPU_HISTORY, payload);

    const actualCount = response.readUInt16LE(0);
    const entries: ViceCpuHistoryEntry[] = [];
    let offset = 2;

    for (let i = 0; i < actualCount && offset + 7 <= response.length; i++) {
      entries.push({
        PC: response.readUInt16LE(offset),
        A: response.readUInt8(offset + 2),
        X: response.readUInt8(offset + 3),
        Y: response.readUInt8(offset + 4),
        SP: response.readUInt8(offset + 5),
        FLAGS: response.readUInt8(offset + 6),
        opcode: response.readUInt8(offset + 7),
      });
      offset += 8; // Minimal entry size
    }

    return entries;
  }

  /**
   * Get available memory banks
   */
  async banksAvailable(memspace: number = MEMSPACE.MAIN_MEMORY): Promise<Array<{id: number, name: string}>> {
    const payload = Buffer.alloc(1);
    payload.writeUInt8(memspace, 0);

    const response = await this.sendCommand(CMD.BANKS_AVAILABLE, payload);

    const banks: Array<{id: number, name: string}> = [];
    const count = response.readUInt16LE(0);
    let offset = 2;

    for (let i = 0; i < count && offset < response.length; i++) {
      const itemSize = response.readUInt8(offset);
      const bankId = response.readUInt16LE(offset + 1);
      const nameLength = response.readUInt8(offset + 3);
      const bankName = response.toString('utf8', offset + 4, offset + 4 + nameLength);

      banks.push({ id: bankId, name: bankName });
      offset += 1 + itemSize; // Skip item_size byte + item content
    }

    return banks;
  }

  /**
   * Get current screen buffer
   * Payload format: VC(1) + FM(1)
   * Format: 0x00=Indexed8 (palette-based)
   * Returns raw pixel buffer
   */
  async getScreen(useVic: boolean = true, format: number = 0x00): Promise<{
    width: number;
    height: number;
    bpp: number;
    data: Buffer;
  }> {
    const payload = Buffer.alloc(2);
    payload.writeUInt8(useVic ? 1 : 0, 0);  // VC: Use VIC-II
    payload.writeUInt8(format, 1);           // FM: Format (0 = Indexed8)

    const response = await this.sendCommand(CMD.SCREEN_GET, payload);

    if (response.length < 17) {
      throw new Error(`Response too short: ${response.length} bytes`);
    }

    // Response format:
    // [0-1]   Header length
    // [4-5]   Full frame width (504, includes borders)
    // [6-7]   Full frame height (312, includes borders)
    // [12-13] Visible screen width (320)
    // [14-15] Visible screen height (200)
    // [16]    Bits per pixel (8 for indexed)
    // [17+]   Image data
    const width = response.readUInt16LE(4);
    const height = response.readUInt16LE(6);
    const bpp = response.readUInt8(16);
    const imageData = response.subarray(17);

    return {
      width,
      height,
      bpp,
      data: imageData
    };
  }
}
