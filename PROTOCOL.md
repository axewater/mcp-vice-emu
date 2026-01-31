# VICE Binary Monitor Protocol

Documentation for VICE's binary monitor protocol (VICE 3.5+).

## Overview

The binary monitor is a TCP-based protocol that allows external tools to control and inspect VICE emulation. It runs on a configurable port (default: 6502).

## Starting VICE with Binary Monitor

```bash
x64sc -binarymonitor -binarymonitoraddress 127.0.0.1:6502
```

Or via configuration file:
```
BinaryMonitorServer=1
BinaryMonitorServerAddress=127.0.0.1:6502
```

## Protocol Structure

All commands and responses use a binary format with this structure:

### Request Format
```
[STX] [API_VERSION] [BODY_LENGTH_LE] [COMMAND_ID] [PAYLOAD] [CHECKSUM]
```

- **STX**: `0x02` (Start of Text)
- **API_VERSION**: `0x01` (current version)
- **BODY_LENGTH**: 4 bytes, little-endian (length of COMMAND_ID + PAYLOAD)
- **COMMAND_ID**: 1-2 bytes identifying the command
- **PAYLOAD**: Variable length, command-specific
- **CHECKSUM**: XOR of all bytes from API_VERSION to end of PAYLOAD

### Response Format
```
[STX] [API_VERSION] [BODY_LENGTH_LE] [ERROR_CODE_LE] [RESPONSE_PAYLOAD]
```

- **ERROR_CODE**: 4 bytes, little-endian (0x00 = success)
- **RESPONSE_PAYLOAD**: Variable length, command-specific

## Memory Commands

### 0x01 - Memory Get
Read a contiguous range of memory.

**Request:**
```
[0x01] [START_ADDR_LE_16] [END_ADDR_LE_16] [MEMSPACE] [BANK_ID_LE_16]
```

**Response:**
```
[ERROR_CODE] [MEMORY_DATA...]
```

### 0x02 - Memory Set
Write bytes to memory.

**Request:**
```
[0x02] [START_ADDR_LE_16] [END_ADDR_LE_16] [MEMSPACE] [BANK_ID_LE_16] [DATA...]
```

## Checkpoint Commands (Breakpoints)

### 0x11 - Checkpoint Set
Set a checkpoint (breakpoint, watchpoint, or tracepoint).

**Request:**
```
[0x11] [START_ADDR_LE_32] [END_ADDR_LE_32] [STOP_WHEN_HIT] [ENABLED]
       [CPU_TYPE] [OPERATION_TYPE] [TEMP_UNTIL_HIT]
```

**Operation Types:**
- `0x01` - LOAD (read)
- `0x02` - STORE (write)
- `0x04` - EXEC (execute)

**CPU Types:**
- `0x00` - Main CPU
- `0x01` - Drive 8 CPU
- etc.

**Response:**
```
[ERROR_CODE] [CHECKPOINT_ID_LE_32]
```

### 0x12 - Checkpoint Delete
Remove a checkpoint.

**Request:**
```
[0x12] [CHECKPOINT_ID_LE_32]
```

### 0x13 - Checkpoint List
Get all active checkpoints.

**Response:**
```
[ERROR_CODE] [COUNT_LE_32] [CHECKPOINT_DATA...]
```

### 0x14 - Checkpoint Toggle
Enable/disable a checkpoint without deleting it.

**Request:**
```
[0x14] [CHECKPOINT_ID_LE_32] [ENABLED]
```

## Register Commands

### 0x31 - Registers Get
Read CPU registers.

**Request:**
```
[0x31] [MEMSPACE]
```

**Response:**
```
[ERROR_CODE] [REGISTER_COUNT] [REGISTER_DATA...]
```

Each register:
```
[SIZE] [ID] [VALUE...]
```

**Common Register IDs:**
- `0x00` - A (accumulator)
- `0x01` - X
- `0x02` - Y
- `0x03` - PC (program counter, 16-bit)
- `0x04` - SP (stack pointer)
- `0x05` - FLAGS (status register)

### 0x32 - Registers Set
Write to CPU registers.

**Request:**
```
[0x32] [MEMSPACE] [REGISTER_COUNT] [REGISTER_DATA...]
```

## Execution Control Commands

### 0x71 - Advance Instructions
Execute N instructions and return.

**Request:**
```
[0x71] [STEP_OVER] [STEP_COUNT_LE_16]
```

- **STEP_OVER**: `0x01` = step over JSR, `0x00` = step into

### 0x73 - Execute Until Return
Run until RTS or RTI.

**Request:**
```
[0x73]
```

### 0x82 - Exit Monitor
Resume normal execution (continue until breakpoint).

**Request:**
```
[0x82]
```

### 0xaa - Resume
Continue execution (alias for 0x82 in some contexts).

**Request:**
```
[0xaa]
```

## Display Commands

### 0x84 - Get Current Screen
Retrieve the current screen contents.

**Request:**
```
[0x84] [USE_VIC] [FORMAT]
```

- **USE_VIC**: `0x01` = capture from VIC-II, `0x00` = from text mode
- **FORMAT**:
  - `0x00` - Raw pixel data
  - `0x01` - PNG image
  - `0x02` - BMP image

**Response:**
```
[ERROR_CODE] [WIDTH_LE_16] [HEIGHT_LE_16] [BPP] [IMAGE_DATA...]
```

## History Commands

### 0x86 - CPU History
Get execution history (requires VICE compiled with --enable-cpuhistory).

**Request:**
```
[0x86] [ENTRY_COUNT_LE_16] [FORMAT]
```

**Response:**
```
[ERROR_CODE] [ACTUAL_COUNT_LE_16] [HISTORY_ENTRIES...]
```

Each entry:
```
[PC_LE_16] [A] [X] [Y] [SP] [FLAGS] [OPCODE] [CYCLE_COUNT...]
```

## System Commands

### 0xcc - Reset
Reset the machine.

**Request:**
```
[0xcc] [RESET_TYPE]
```

- **RESET_TYPE**:
  - `0x00` - Soft reset (like pressing RESET button)
  - `0x01` - Hard reset (like power cycle)
  - `0x08` - Reset drive 8

### 0xdd - Autostart
Load and run a program.

**Request:**
```
[0xdd] [RUN_MODE] [FILENAME_LENGTH] [FILENAME_UTF8] [FILE_INDEX_LE_16]
```

- **RUN_MODE**:
  - `0x00` - Load and run
  - `0x01` - Load only
- **FILE_INDEX**: For .d64/.t64 files with multiple programs

## Ping/Keepalive

### 0x81 - Ping
Check if monitor is alive.

**Request:**
```
[0x81]
```

**Response:**
```
[ERROR_CODE]
```

## Memory Spaces

Common memory space IDs:

- `0x00` - Main memory
- `0x01` - Drive 8 memory
- `0x02` - Drive 9 memory

For bank IDs on C64:
- `0x00` - RAM
- `0x01` - ROM
- `0x02` - I/O area

## Error Codes

- `0x00000000` - OK
- `0x00000001` - Object not found
- `0x00000002` - Invalid operation
- `0x80000000` - General error
- `0x8000000X` - Command-specific errors

## Example: Read Memory at $0400

```
Request bytes:
02 01 0A 00 00 00 01 00 04 03 04 00 00 00 00 [XOR checksum]
│  │  └─────────┘ │  └────┘ └────┘ │  └────┘
│  │      │       │     │      │    │     └─ Bank ID (0)
│  │      │       │     │      │    └─────── Memspace (0)
│  │      │       │     │      └────────────  End addr (0x0403)
│  │      │       │     └─────────────────── Start addr (0x0400)
│  │      │       └──────────────────────────  Command (0x01)
│  │      └──────────────────────────────────  Body length (10 bytes)
│  └────────────────────────────────────────── API version (1)
└───────────────────────────────────────────── STX (0x02)

Response bytes:
02 01 08 00 00 00 00 00 00 00 [4 bytes of data] [XOR checksum]
│  │  └─────────┘ └─────────┘ └──────────────
│  │      │            │              └────── Memory data (4 bytes)
│  │      │            └────────────────────── Error code (0 = OK)
│  │      └──────────────────────────────────  Body length (8 bytes)
│  └────────────────────────────────────────── API version (1)
└───────────────────────────────────────────── STX (0x02)
```

## References

- VICE source: `src/monitor/mon_binary.c`
- VICE docs: `doc/monitor.txt`
- Protocol constants: `src/monitor/monitor_binary.h`
