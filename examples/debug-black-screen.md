# Debugging a Black Screen Issue

This guide shows how to use the VICE MCP server to diagnose why a C64 program shows a black screen.

## Scenario

You've compiled or written a C64 program that should display graphics, but when you run it in VICE, you only see a black screen.

## Debugging Steps with Claude Code

### 1. Connect and Load the Program

```
> Connect to VICE and load failing-program.prg
```

Claude Code will:
- Launch VICE with binary monitor
- Load your program
- Wait for it to start

### 2. Check Current State

```
> Check the CPU registers and see what the program is doing
```

This will call:
- `vice_registers_get()` - See where PC is pointing
- `vice_cpu_history()` - See last 50 executed instructions

**Common issues revealed:**
- PC stuck in ROM ($E000+) - Program crashed and jumped to Kernal
- PC in infinite loop at specific address
- PC never reached your program's start address

### 3. Inspect VIC-II Registers

```
> Check the VIC-II registers to see if the screen is disabled
```

This calls `vice_vic_registers()` which reads $D000-$D02E.

**What to look for:**
- `$D011` bit 4 = 0 → Screen is disabled!
- `$D020` and `$D021` both = 0 → Black border and background
- `$D018` → Wrong screen or charset memory location

### 4. Look at Memory

```
> Dump the memory where the program code should be
```

This uses `vice_memory_dump()` to see the actual bytes in memory.

**Common issues:**
- Program code not where expected (load address wrong)
- Code overwritten by something else
- Code jumping to uninitialized memory

### 5. Capture Screenshot

```
> Take a screenshot so I can see what's actually on screen
```

Uses `vice_screenshot()` to capture the display.

**What this reveals:**
- Is it truly black or just very dark?
- Are there any sprites or border effects visible?
- Is there any text in the border area?

## Example Conversation

**You:** "My C64 program shows a black screen. Can you debug it?"

**Claude Code:**
1. Connects to VICE
2. Loads your program
3. Checks registers:
   ```
   PC: $0820
   A: $00  X: $00  Y: $00
   ```
4. Gets CPU history - sees infinite loop between $0820-$0825
5. Checks VIC-II:
   ```
   $D011 = $00  → Screen disabled!
   ```
6. Dumps memory at $0820:
   ```
   $0820  A9 00 8D 11 D0 4C 20 08  ......L .
   ```
   Disassembles to:
   ```
   $0820  LDA #$00      ; Load 0
   $0822  STA $D011     ; Store to VIC control register
   $0825  JMP $0820     ; Jump back (infinite loop!)
   ```

**Claude's diagnosis:**
"Your program writes $00 to $D011 which disables the VIC-II screen, then enters an infinite loop. The screen is off, not crashed. You need to write $1B to $D011 to enable 25-row text mode."

## Common Black Screen Causes

### 1. Screen Disabled ($D011 = $00)
**Fix:** Write $1B to $D011 for standard text mode

### 2. Black Colors ($D020 = $D021 = 0)
**Fix:** Set different colors, e.g., $D020 = 14 (light blue), $D021 = 6 (blue)

### 3. Wrong Screen Memory
**Fix:** Check $D018. Screen should be at $0400 (default) or another valid location

### 4. Program Crashed Before Displaying
**Fix:** Use `vice_cpu_history()` to see where it crashed, set breakpoints to catch it

### 5. Charset Not Loaded
**Fix:** Ensure charset is at correct location pointed to by $D018 bits 1-3

## Advanced Debugging

### Set Breakpoint at Problem Area

```
> Set a breakpoint at $0820 and reset the machine
```

This lets you catch execution before the screen turns off.

### Watch Memory Writes

```
> Set a watchpoint on $D011 to see what's writing to it
```

This breaks whenever anything modifies the VIC control register.

### Step Through Code

```
> Step through the next 10 instructions
```

Executes one instruction at a time so you can see exactly what happens.

## Tips

- Always check $D011 first - it's the most common cause of black screens
- Use `vice_cpu_history()` to see where the program has been
- Check if PC is in your program's address range or in ROM
- Look at the stack pointer - if SP < $F0, you may have stack overflow
- Border color ($D020) changes even when screen is off - use it for debugging
