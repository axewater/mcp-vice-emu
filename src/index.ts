#!/usr/bin/env node

/**
 * MCP VICE Emulator Server
 * Provides debugging tools for VICE emulator through MCP protocol
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { ViceConnection, ViceConfig } from './vice-connection.js';
import { CHECKPOINT_OP, MEMSPACE } from './vice-protocol.js';
import { PNG } from 'pngjs';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

// Configuration from environment
const config: ViceConfig = {
  vicePath: process.env.VICE_PATH || 'C:\\bin\\vice\\bin',
  emulator: process.env.VICE_EMULATOR || 'x64sc',
  monitorPort: parseInt(process.env.VICE_MONITOR_PORT || '6502', 10),
};

// Global connection instance
let connection: ViceConnection | null = null;

// Tool definitions
const tools: Tool[] = [
  // Connection tools
  {
    name: 'vice_connect',
    description: 'Start VICE emulator and connect to binary monitor. Must be called before any other VICE commands.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'vice_disconnect',
    description: 'Stop VICE emulator and close connection',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'vice_status',
    description: 'Check if VICE is running and connected',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // Program loading
  {
    name: 'vice_load',
    description: 'Load and optionally run a program (.prg, .d64, .t64, .crt). Use absolute paths or paths relative to current directory.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Path to program file (supports .prg, .d64, .t64, .crt)',
        },
        run: {
          type: 'boolean',
          description: 'Whether to run the program after loading (default: true)',
          default: true,
        },
        fileIndex: {
          type: 'number',
          description: 'For disk images with multiple files, which file to load (default: 0)',
          default: 0,
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'vice_reset',
    description: 'Reset the C64. Use soft reset (like pressing RESET button) or hard reset (like power cycling)',
    inputSchema: {
      type: 'object',
      properties: {
        hard: {
          type: 'boolean',
          description: 'True for hard reset (power cycle), false for soft reset (default: false)',
          default: false,
        },
      },
    },
  },

  // Memory tools
  {
    name: 'vice_memory_read',
    description: 'Read a range of memory bytes. Returns hex string. Useful for inspecting VIC-II ($D000-$D02E), SID ($D400-$D41C), CIA ($DC00-$DCFF), etc.',
    inputSchema: {
      type: 'object',
      properties: {
        start: {
          type: 'number',
          description: 'Start address (decimal or use $ prefix for hex like $D011)',
        },
        length: {
          type: 'number',
          description: 'Number of bytes to read',
        },
        memspace: {
          type: 'number',
          description: 'Memory space: 0=main, 1=drive8 (default: 0)',
          default: 0,
        },
        bank: {
          type: 'number',
          description: 'Bank ID: 0=RAM, 1=ROM, 2=I/O (default: 0)',
          default: 0,
        },
      },
      required: ['start', 'length'],
    },
  },
  {
    name: 'vice_memory_write',
    description: 'Write bytes to memory. Provide data as hex string (e.g., "A9 00 8D 20 D0" or "A900-8D20D0")',
    inputSchema: {
      type: 'object',
      properties: {
        start: {
          type: 'number',
          description: 'Start address',
        },
        data: {
          type: 'string',
          description: 'Hex data to write (e.g., "A9 00 8D 20 D0")',
        },
        memspace: {
          type: 'number',
          description: 'Memory space: 0=main, 1=drive8 (default: 0)',
          default: 0,
        },
        bank: {
          type: 'number',
          description: 'Bank ID (default: 0)',
          default: 0,
        },
      },
      required: ['start', 'data'],
    },
  },
  {
    name: 'vice_memory_dump',
    description: 'Dump memory as formatted hex + ASCII (like a hex editor). Great for viewing memory contents in readable format.',
    inputSchema: {
      type: 'object',
      properties: {
        start: {
          type: 'number',
          description: 'Start address',
        },
        length: {
          type: 'number',
          description: 'Number of bytes to dump',
        },
        bytesPerLine: {
          type: 'number',
          description: 'Bytes per line (default: 16)',
          default: 16,
        },
      },
      required: ['start', 'length'],
    },
  },

  // Register tools
  {
    name: 'vice_registers_get',
    description: 'Get CPU register values (A, X, Y, PC, SP, FLAGS)',
    inputSchema: {
      type: 'object',
      properties: {
        memspace: {
          type: 'number',
          description: 'Memory space (default: 0 for main CPU)',
          default: 0,
        },
      },
    },
  },
  {
    name: 'vice_registers_set',
    description: 'Set CPU register values. Provide any subset of A, X, Y, PC, SP, FLAGS',
    inputSchema: {
      type: 'object',
      properties: {
        A: { type: 'number', description: 'Accumulator (0-255)' },
        X: { type: 'number', description: 'X register (0-255)' },
        Y: { type: 'number', description: 'Y register (0-255)' },
        PC: { type: 'number', description: 'Program counter (0-65535)' },
        SP: { type: 'number', description: 'Stack pointer (0-255)' },
        FLAGS: { type: 'number', description: 'Status flags (0-255)' },
      },
    },
  },

  // Breakpoints
  {
    name: 'vice_breakpoint_set',
    description: 'Set a breakpoint at an address. Execution will stop when PC reaches this address.',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'number',
          description: 'Address to break at',
        },
        enabled: {
          type: 'boolean',
          description: 'Enable the breakpoint (default: true)',
          default: true,
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'vice_breakpoint_clear',
    description: 'Remove a breakpoint by its ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'number',
          description: 'Breakpoint ID (returned from vice_breakpoint_set)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'vice_watchpoint_set',
    description: 'Set a watchpoint to break on memory read/write/execute. Great for finding where memory is modified.',
    inputSchema: {
      type: 'object',
      properties: {
        startAddr: {
          type: 'number',
          description: 'Start address of watched range',
        },
        endAddr: {
          type: 'number',
          description: 'End address of watched range (optional, defaults to startAddr)',
        },
        operation: {
          type: 'string',
          enum: ['read', 'write', 'exec'],
          description: 'Operation to watch for',
        },
      },
      required: ['startAddr', 'operation'],
    },
  },
  {
    name: 'vice_watchpoint_clear',
    description: 'Remove a watchpoint by its ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'number',
          description: 'Watchpoint ID',
        },
      },
      required: ['id'],
    },
  },

  // Execution control
  {
    name: 'vice_step',
    description: 'Execute N instructions and stop. Use stepOver=true to step over JSR calls.',
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'Number of instructions to execute (default: 1)',
          default: 1,
        },
        stepOver: {
          type: 'boolean',
          description: 'Step over JSR calls (default: false)',
          default: false,
        },
      },
    },
  },
  {
    name: 'vice_continue',
    description: 'Resume execution until next breakpoint or watchpoint is hit',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'vice_execute_until_return',
    description: 'Run until RTS or RTI instruction (step out of subroutine)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // Inspection tools
  {
    name: 'vice_cpu_history',
    description: 'Get CPU execution history (last N executed instructions). Shows PC, registers, and opcode for each instruction. Requires VICE compiled with --enable-cpuhistory.',
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'Number of history entries to retrieve (default: 50)',
          default: 50,
        },
      },
    },
  },
  {
    name: 'vice_screenshot',
    description: 'Capture current screen buffer and save as PNG file.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Output filename (default: vice-screen-{timestamp}.png)',
        },
      },
    },
  },
  {
    name: 'vice_vic_registers',
    description: 'Read VIC-II chip registers ($D000-$D02E). Shows screen control, sprites, colors, etc.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'vice_sid_registers',
    description: 'Read SID chip registers ($D400-$D41C). Shows sound settings.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// Helper functions
function parseHexOrDecimal(value: string | number): number {
  if (typeof value === 'number') return value;
  if (value.startsWith('$')) {
    return parseInt(value.slice(1), 16);
  }
  return parseInt(value, 10);
}

function hexDump(data: Buffer, startAddr: number, bytesPerLine: number = 16): string {
  let result = '';
  for (let i = 0; i < data.length; i += bytesPerLine) {
    const addr = startAddr + i;
    const line = data.subarray(i, Math.min(i + bytesPerLine, data.length));

    // Address
    result += `$${addr.toString(16).padStart(4, '0').toUpperCase()}  `;

    // Hex bytes
    const hexPart = Array.from(line)
      .map(b => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
    result += hexPart.padEnd(bytesPerLine * 3, ' ');

    // ASCII
    result += ' |';
    for (const byte of line) {
      result += (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.';
    }
    result += '|\n';
  }
  return result;
}

function formatRegisters(regs: any): string {
  const flags = regs.FLAGS;
  const flagsStr = [
    (flags & 0x80) ? 'N' : 'n',
    (flags & 0x40) ? 'V' : 'v',
    '-',
    (flags & 0x10) ? 'B' : 'b',
    (flags & 0x08) ? 'D' : 'd',
    (flags & 0x04) ? 'I' : 'i',
    (flags & 0x02) ? 'Z' : 'z',
    (flags & 0x01) ? 'C' : 'c',
  ].join('');

  return `A=$${regs.A.toString(16).padStart(2, '0')} X=$${regs.X.toString(16).padStart(2, '0')} Y=$${regs.Y.toString(16).padStart(2, '0')} SP=$${regs.SP.toString(16).padStart(2, '0')} PC=$${regs.PC.toString(16).padStart(4, '0')}\nFlags: ${flagsStr}`;
}

function formatVicRegisters(data: Buffer): string {
  const lines: string[] = [];
  lines.push('VIC-II Registers ($D000-$D02E):');
  lines.push('');

  // Screen control
  const d011 = data[0x11];
  const d016 = data[0x16];
  lines.push(`$D011 (Control 1): $${d011.toString(16).padStart(2, '0')} - Screen ${d011 & 0x10 ? 'ON' : 'OFF'}, ${d011 & 0x08 ? '25' : '24'} rows, ${d011 & 0x20 ? 'Bitmap' : 'Text'} mode`);
  lines.push(`$D016 (Control 2): $${d016.toString(16).padStart(2, '0')} - ${d016 & 0x10 ? 'Multicolor' : 'Hires'}, ${d016 & 0x08 ? '40' : '38'} cols`);
  lines.push(`$D018 (Memory):     $${data[0x18].toString(16).padStart(2, '0')} - Screen at $${((data[0x18] >> 4) * 0x400).toString(16).padStart(4, '0')}, Charset at $${((data[0x18] & 0x0E) >> 1).toString(16)}xxx`);
  lines.push('');

  // Colors
  lines.push(`Border: $${data[0x20].toString(16).padStart(2, '0')}  Background: $${data[0x21].toString(16).padStart(2, '0')}  BG1: $${data[0x22].toString(16).padStart(2, '0')}  BG2: $${data[0x23].toString(16).padStart(2, '0')}  BG3: $${data[0x24].toString(16).padStart(2, '0')}`);

  return lines.join('\n');
}

// Tool implementations
async function handleToolCall(name: string, args: any): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }> {
  try {
    switch (name) {
      case 'vice_connect': {
        if (connection?.connected) {
          return { content: [{ type: 'text', text: 'Already connected to VICE' }] };
        }
        connection = new ViceConnection(config);
        await connection.connect();
        return { content: [{ type: 'text', text: `Connected to VICE ${config.emulator} on port ${config.monitorPort}` }] };
      }

      case 'vice_disconnect': {
        if (!connection?.connected) {
          return { content: [{ type: 'text', text: 'Not connected to VICE' }] };
        }
        await connection.disconnect();
        connection = null;
        return { content: [{ type: 'text', text: 'Disconnected from VICE' }] };
      }

      case 'vice_status': {
        if (!connection?.connected) {
          return { content: [{ type: 'text', text: 'Not connected' }] };
        }
        const healthy = await connection.healthCheck();
        return { content: [{ type: 'text', text: healthy ? 'Connected and responsive' : 'Connected but not responding' }] };
      }

      case 'vice_load': {
        if (!connection?.connected) throw new Error('Not connected to VICE');
        const { file, run = true, fileIndex = 0 } = args;
        const protocol = connection.getProtocol();
        await protocol.autostart(file, run ? 0 : 1, fileIndex);
        return { content: [{ type: 'text', text: `${run ? 'Loaded and running' : 'Loaded'}: ${file}` }] };
      }

      case 'vice_reset': {
        if (!connection?.connected) throw new Error('Not connected to VICE');
        const { hard = false } = args;
        const protocol = connection.getProtocol();
        await protocol.reset(hard);
        return { content: [{ type: 'text', text: `${hard ? 'Hard' : 'Soft'} reset completed` }] };
      }

      case 'vice_memory_read': {
        if (!connection?.connected) throw new Error('Not connected to VICE');
        const { start, length, memspace = 0, bank = 0 } = args;
        const startAddr = parseHexOrDecimal(start);
        const endAddr = startAddr + length - 1;
        const protocol = connection.getProtocol();
        const data = await protocol.memoryGet(startAddr, endAddr, memspace, bank);
        const hexStr = Array.from(data).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        return { content: [{ type: 'text', text: `Memory $${startAddr.toString(16).padStart(4, '0')}-$${endAddr.toString(16).padStart(4, '0')}:\n${hexStr}` }] };
      }

      case 'vice_memory_write': {
        if (!connection?.connected) throw new Error('Not connected to VICE');
        const { start, data: hexData, memspace = 0, bank = 0 } = args;
        const startAddr = parseHexOrDecimal(start);
        const bytes = Buffer.from(hexData.replace(/[^0-9A-Fa-f]/g, ''), 'hex');
        const protocol = connection.getProtocol();
        await protocol.memorySet(startAddr, bytes, memspace, bank);
        return { content: [{ type: 'text', text: `Wrote ${bytes.length} bytes to $${startAddr.toString(16).padStart(4, '0')}` }] };
      }

      case 'vice_memory_dump': {
        if (!connection?.connected) throw new Error('Not connected to VICE');
        const { start, length, bytesPerLine = 16 } = args;
        const startAddr = parseHexOrDecimal(start);
        const endAddr = startAddr + length - 1;
        const protocol = connection.getProtocol();
        const data = await protocol.memoryGet(startAddr, endAddr);
        const dump = hexDump(data, startAddr, bytesPerLine);
        return { content: [{ type: 'text', text: dump }] };
      }

      case 'vice_registers_get': {
        if (!connection?.connected) throw new Error('Not connected to VICE');
        const { memspace = 0 } = args;
        const protocol = connection.getProtocol();
        const regs = await protocol.registersGet(memspace);
        return { content: [{ type: 'text', text: formatRegisters(regs) }] };
      }

      case 'vice_registers_set': {
        if (!connection?.connected) throw new Error('Not connected to VICE');
        const protocol = connection.getProtocol();
        await protocol.registersSet(args);
        return { content: [{ type: 'text', text: 'Registers updated' }] };
      }

      case 'vice_breakpoint_set': {
        if (!connection?.connected) throw new Error('Not connected to VICE');
        const { address, enabled = true } = args;
        const addr = parseHexOrDecimal(address);
        const protocol = connection.getProtocol();
        const id = await protocol.checkpointSet(addr, addr, CHECKPOINT_OP.EXEC, true, enabled);
        return { content: [{ type: 'text', text: `Breakpoint ${id} set at $${addr.toString(16).padStart(4, '0')}` }] };
      }

      case 'vice_breakpoint_clear': {
        if (!connection?.connected) throw new Error('Not connected to VICE');
        const { id } = args;
        const protocol = connection.getProtocol();
        await protocol.checkpointDelete(id);
        return { content: [{ type: 'text', text: `Breakpoint ${id} cleared` }] };
      }

      case 'vice_watchpoint_set': {
        if (!connection?.connected) throw new Error('Not connected to VICE');
        const { startAddr, endAddr, operation } = args;
        const start = parseHexOrDecimal(startAddr);
        const end = endAddr ? parseHexOrDecimal(endAddr) : start;
        const opMap = { read: CHECKPOINT_OP.LOAD, write: CHECKPOINT_OP.STORE, exec: CHECKPOINT_OP.EXEC };
        const protocol = connection.getProtocol();
        const id = await protocol.checkpointSet(start, end, opMap[operation as keyof typeof opMap]);
        return { content: [{ type: 'text', text: `Watchpoint ${id} set on ${operation} at $${start.toString(16).padStart(4, '0')}-$${end.toString(16).padStart(4, '0')}` }] };
      }

      case 'vice_watchpoint_clear': {
        if (!connection?.connected) throw new Error('Not connected to VICE');
        const { id } = args;
        const protocol = connection.getProtocol();
        await protocol.checkpointDelete(id);
        return { content: [{ type: 'text', text: `Watchpoint ${id} cleared` }] };
      }

      case 'vice_step': {
        if (!connection?.connected) throw new Error('Not connected to VICE');
        const { count = 1, stepOver = false } = args;
        const protocol = connection.getProtocol();
        await protocol.advanceInstructions(count, stepOver);
        const regs = await protocol.registersGet();
        return { content: [{ type: 'text', text: `Stepped ${count} instruction(s)\n${formatRegisters(regs)}` }] };
      }

      case 'vice_continue': {
        if (!connection?.connected) throw new Error('Not connected to VICE');
        const protocol = connection.getProtocol();
        await protocol.resume();
        return { content: [{ type: 'text', text: 'Execution resumed (will stop at next breakpoint)' }] };
      }

      case 'vice_execute_until_return': {
        if (!connection?.connected) throw new Error('Not connected to VICE');
        const protocol = connection.getProtocol();
        await protocol.executeUntilReturn();
        const regs = await protocol.registersGet();
        return { content: [{ type: 'text', text: `Executed until RTS/RTI\n${formatRegisters(regs)}` }] };
      }

      case 'vice_cpu_history': {
        if (!connection?.connected) throw new Error('Not connected to VICE');
        const { count = 50 } = args;
        const protocol = connection.getProtocol();
        const history = await protocol.cpuHistory(count);

        if (history.length === 0) {
          return { content: [{ type: 'text', text: 'No CPU history available. VICE may not be compiled with --enable-cpuhistory' }] };
        }

        const lines = history.map(entry =>
          `$${entry.PC.toString(16).padStart(4, '0')}  A:${entry.A.toString(16).padStart(2, '0')} X:${entry.X.toString(16).padStart(2, '0')} Y:${entry.Y.toString(16).padStart(2, '0')} SP:${entry.SP.toString(16).padStart(2, '0')} [${entry.opcode.toString(16).padStart(2, '0')}]`
        );
        return { content: [{ type: 'text', text: `Last ${history.length} instructions:\n${lines.join('\n')}` }] };
      }

      case 'vice_screenshot': {
        if (!connection?.connected) throw new Error('Not connected to VICE');
        console.error(`[SCREENSHOT] ===== STARTING SCREENSHOT PROCESSING =====`);

        const protocol = connection.getProtocol();
        const screenData = await protocol.getScreen(true, 0); // Always use Indexed8 format

        console.error(`[SCREENSHOT] ===== RECEIVED SCREEN DATA =====`);
        console.error(`[SCREENSHOT] Width: ${screenData.width}, Height: ${screenData.height}, BPP: ${screenData.bpp}`);
        console.error(`[SCREENSHOT] Data buffer length: ${screenData.data.length} bytes`);
        console.error(`[SCREENSHOT] First 32 bytes of data:`, screenData.data.subarray(0, Math.min(32, screenData.data.length)).toString('hex'));

        // Save screen data to file for analysis
        const screenDataFilename = `vice-screendata-${Date.now()}.bin`;
        writeFileSync(screenDataFilename, screenData.data);
        console.error(`[SCREENSHOT] Screen data saved to ${screenDataFilename}`);

        // Generate filename with .png extension
        const baseFilename = args.filename || `vice-screen-${Date.now()}`;
        const filename = baseFilename.endsWith('.png') ? baseFilename : `${baseFilename}.png`;
        const fullPath = resolve(filename);

        console.error(`[SCREENSHOT] ===== CREATING PNG =====`);
        console.error(`[SCREENSHOT] Output file: ${fullPath}`);

        // Create PNG
        const png = new PNG({
          width: screenData.width,
          height: screenData.height,
          colorType: 6, // RGBA
          inputColorType: 6
        });

        console.error(`[SCREENSHOT] PNG buffer allocated: ${png.data.length} bytes`);

        // Convert Indexed8 pixel data to RGBA format for PNG using C64 palette
        const pixelCount = screenData.width * screenData.height;
        console.error(`[SCREENSHOT] Total pixels to convert: ${pixelCount}`);
        console.error(`[SCREENSHOT] Converting Indexed8 palette data to RGBA...`);

        const c64Palette = [
          [0x00, 0x00, 0x00], [0xFF, 0xFF, 0xFF], [0x88, 0x00, 0x00], [0xAA, 0xFF, 0xEE],
          [0xCC, 0x44, 0xCC], [0x00, 0xCC, 0x55], [0x00, 0x00, 0xAA], [0xEE, 0xEE, 0x77],
          [0xDD, 0x88, 0x55], [0x66, 0x44, 0x00], [0xFF, 0x77, 0x77], [0x33, 0x33, 0x33],
          [0x77, 0x77, 0x77], [0xAA, 0xFF, 0x66], [0x00, 0x88, 0xFF], [0xBB, 0xBB, 0xBB]
        ];

        let pixelsConverted = 0;
        for (let i = 0; i < pixelCount; i++) {
          if (i >= screenData.data.length) {
            console.error(`[SCREENSHOT] WARNING: Ran out of source data at pixel ${i}/${pixelCount}`);
            break;
          }
          const paletteIndex = screenData.data[i] & 0x0F;
          const color = c64Palette[paletteIndex];
          const pngOffset = i * 4;
          png.data[pngOffset] = color[0];     // R
          png.data[pngOffset + 1] = color[1]; // G
          png.data[pngOffset + 2] = color[2]; // B
          png.data[pngOffset + 3] = 255;      // A
          pixelsConverted++;
        }
        console.error(`[SCREENSHOT] Converted ${pixelsConverted} pixels from palette data`);

        console.error(`[SCREENSHOT] ===== ENCODING PNG =====`);
        console.error(`[SCREENSHOT] First 32 bytes of PNG data:`, png.data.subarray(0, 32).toString('hex'));

        // Save PNG file
        const pngBuffer = PNG.sync.write(png);
        console.error(`[SCREENSHOT] PNG encoded, buffer size: ${pngBuffer.length} bytes`);

        writeFileSync(fullPath, pngBuffer);
        console.error(`[SCREENSHOT] PNG file written to ${fullPath}`);
        console.error(`[SCREENSHOT] ===== SCREENSHOT COMPLETE =====`);

        return {
          content: [
            {
              type: 'text',
              text: `Screenshot saved to: ${fullPath}\n` +
                    `Dimensions: ${screenData.width}x${screenData.height}\n` +
                    `Source format: Indexed8\n` +
                    `Source data size: ${screenData.data.length} bytes\n` +
                    `PNG file size: ${pngBuffer.length} bytes`
            }
          ]
        };
      }

      case 'vice_vic_registers': {
        if (!connection?.connected) throw new Error('Not connected to VICE');
        const protocol = connection.getProtocol();
        const data = await protocol.memoryGet(0xD000, 0xD02E);
        return { content: [{ type: 'text', text: formatVicRegisters(data) }] };
      }

      case 'vice_sid_registers': {
        if (!connection?.connected) throw new Error('Not connected to VICE');
        const protocol = connection.getProtocol();
        const data = await protocol.memoryGet(0xD400, 0xD41C);
        const hexStr = Array.from(data).map((b, i) => `$D4${i.toString(16).padStart(2, '0').toUpperCase()}: $${b.toString(16).padStart(2, '0')}`).join('\n');
        return { content: [{ type: 'text', text: `SID Registers ($D400-$D41C):\n${hexStr}` }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { content: [{ type: 'text', text: `Error: ${errorMessage}` }] };
  }
}

// Start MCP server
const server = new Server(
  {
    name: 'vice-emu',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleToolCall(name, args || {});
});

// Handle shutdown
process.on('SIGINT', async () => {
  if (connection?.connected) {
    await connection.disconnect();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (connection?.connected) {
    await connection.disconnect();
  }
  process.exit(0);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP VICE] Server running');
  console.error(`[MCP VICE] VICE path: ${config.vicePath}`);
  console.error(`[MCP VICE] Emulator: ${config.emulator}`);
  console.error(`[MCP VICE] Monitor port: ${config.monitorPort}`);
}

main().catch((error) => {
  console.error('[MCP VICE] Fatal error:', error);
  process.exit(1);
});
