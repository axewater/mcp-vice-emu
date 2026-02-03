# MCP VICE Emulator Server

An MCP (Model Context Protocol) server that enables Claude Code to debug Commodore 64/128/VIC-20 programs running in the VICE emulator.

## What This Does

This server connects Claude Code to VICE's binary monitor protocol, allowing you to:

- **Debug black screen crashes** - Inspect registers, memory, and CPU history to understand what went wrong
- **Read/write memory** - Examine or modify any memory location, including VIC-II/SID/CIA registers
- **Set breakpoints** - Stop execution at specific addresses or memory access patterns
- **Step through code** - Single-step through 6502/6510 assembly instructions
- **Capture screenshots** - See what's actually on the screen during debugging
- **Auto-start programs** - Load .prg, .d64, or .crt files directly


### Environment Variables

- `VICE_PATH` - Path to VICE bin directory (default: `C:\bin\vice\bin`)
- `VICE_EMULATOR` - Which emulator to use: `x64sc`, `x128`, `xvic`, etc. (default: `x64sc`)
- `VICE_MONITOR_PORT` - Binary monitor port (default: `6502`)

## Quick Start

Once configured, you can ask Claude Code to debug your C64 programs:

```
> Load and debug myprog.prg - it shows a black screen and I don't know why
```

Claude Code will:
1. Launch VICE with monitoring enabled
2. Load your program
3. Inspect registers, memory, and CPU history
4. Diagnose the issue and suggest fixes

## Available MCP Tools

### Connection
- `vice_connect` - Start VICE and connect to binary monitor
- `vice_disconnect` - Stop VICE and close connection
- `vice_status` - Check if VICE is running and connected

### Program Loading
- `vice_load` - Autostart a .prg, .d64, .t64, or .crt file
- `vice_reset` - Reset the machine (hard or soft reset)

### Memory
- `vice_memory_read` - Read memory range (with bank selection)
- `vice_memory_write` - Write bytes to memory
- `vice_memory_dump` - Dump memory as hex + ASCII (like a hex editor)

### Registers
- `vice_registers_get` - Get A, X, Y, SP, PC, and status flags
- `vice_registers_set` - Modify register values

### Breakpoints & Watchpoints
- `vice_breakpoint_set` - Break when PC reaches an address
- `vice_breakpoint_clear` - Remove a breakpoint
- `vice_watchpoint_set` - Break on memory read/write/execute
- `vice_watchpoint_clear` - Remove a watchpoint

### Execution Control
- `vice_step` - Execute N instructions
- `vice_continue` - Resume execution until breakpoint
- `vice_execute_until_return` - Run until RTS/RTI

### Inspection
- `vice_cpu_history` - Get last N executed instructions
- `vice_screenshot` - Capture current screen as PNG
- `vice_vic_registers` - Read VIC-II registers ($D000-$D02E)
- `vice_sid_registers` - Read SID registers ($D400-$D41C)

## Example Debugging Session

**User:** "My program shows a black screen. Can you figure out why?"

**Claude Code will:**

```typescript
// 1. Connect and load program
vice_connect()
vice_load({ file: "myprog.prg" })

// 2. Check what happened
vice_registers_get()
// → PC: $EA31 (Kernal IRQ handler - stuck in ROM!)

vice_cpu_history({ count: 50 })
// → Last 50 instructions show infinite loop at $0810

// 3. Inspect VIC-II
vice_vic_registers()
// → $D011 = $00 (screen disabled!)
// → $D020 = $00, $D021 = $00 (black border and background)

// 4. Check the problem area
vice_memory_dump({ start: 0x0810, length: 16 })
// → Shows the code that disabled the screen

// 5. Capture proof
vice_screenshot()
// → Saves screenshot showing black screen
```

**Claude's diagnosis:** "Your program disables the VIC-II screen bit ($D011) but never re-enables it. The code at $0810 writes $00 to $D011 instead of $1B."

## Protocol Documentation

See [PROTOCOL.md](./PROTOCOL.md) for details on VICE's binary monitor protocol.

## Troubleshooting

### "Connection refused"
- Make sure no other instance of VICE is running
- Check that `VICE_PATH` points to the correct directory
- Verify VICE version is 3.5 or newer

### "Program doesn't load"
- Ensure the file path is absolute or relative to current directory
- Check file format (.prg, .d64, etc.) is valid
- Try `vice_reset()` before loading

### "Breakpoint not hit"
- Use `vice_cpu_history()` to see if execution reached that area
- Check if PC is in the expected memory range
- Verify breakpoint address is correct (use decimal or hex with $ prefix)

## Development

```bash
# Watch mode for development
npm run watch

# Build for production
npm run build
```

## License

Free like beer
