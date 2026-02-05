# Debug Mode

## Enabling Debug Logging

To enable verbose protocol-level debugging, set the `VICE_DEBUG` environment variable:

```bash
# Windows (PowerShell)
$env:VICE_DEBUG="1"

# Windows (CMD)
set VICE_DEBUG=1

# Linux/Mac
export VICE_DEBUG=1
```

When enabled, you'll see detailed protocol information:
- `[VICE-DEBUG] [SEND]` - Every command sent with full packet hex dump
- `[VICE-DEBUG] [RECV]` - Every response received with headers and queue state
- `[VICE-DEBUG]` - Protocol errors and async events

## Normal Logging (Without Debug Mode)

Without `VICE_DEBUG=1`, you'll only see:
- `[VICE]` - Connection lifecycle events (launching, connected, disconnected)
- `[MCP VICE]` - Server startup and configuration
- `[VICE] WARNING` - Important warnings (e.g., unhandled responses)

## Example Debug Output

With `VICE_DEBUG=1`:
```
[VICE-DEBUG] [SEND] CMD=0x01 reqId=0x00000001 bodyLen=8 packet=18b
[VICE-DEBUG] [SEND] 0x02 0x02 0x08 0x00 0x00 0x00 0x01 0x00 0x00 0x00 0x01 0x00 0x2e 0xd0 0x00 0x00 0x00 0x2a
[VICE-DEBUG] [RECV] type=0x01 err=0x00 reqId=0x00000001 bodyLen=47 queue=1
[VICE-DEBUG] [RECV] Matched to handler (queue now 0)
```

Without debug mode: (silence - only results shown to user)
