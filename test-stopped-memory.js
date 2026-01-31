/**
 * Test if memory commands require CPU to be stopped
 */

import { ViceConnection } from './dist/vice-connection.js';

const config = {
  vicePath: 'C:\\bin\\vice\\bin',
  emulator: 'x64sc',
  monitorPort: 6502
};

console.log('Testing memory access with CPU stopped...\n');

const conn = new ViceConnection(config);

try {
  console.log('1. Connecting to VICE...');
  await conn.connect();
  const protocol = conn.getProtocol();
  console.log('✓ Connected!\n');

  console.log('2. Stopping CPU with ADVANCE_INSTRUCTIONS(0)...');
  try {
    await protocol.advanceInstructions(0, false);
    console.log('✓ CPU stopped\n');
  } catch (err) {
    console.log(`Note: ${err.message}\n`);
  }

  console.log('3. Trying memory read with CPU stopped...');
  try {
    const mem = await protocol.memoryGet(0x0400, 0x0403, 0, 0);
    console.log(`✓ SUCCESS! Read ${mem.length} bytes: ${Array.from(mem).map(b => `$${b.toString(16).padStart(2, '0')}`).join(' ')}`);
    console.log('\n🎉 Solution: CPU must be stopped before memory access!\n');
  } catch (err) {
    console.log(`✗ Still failed: ${err.message}\n`);
  }

  console.log('4. Resuming CPU...');
  try {
    await protocol.resume();
    console.log('✓ CPU resumed\n');
  } catch (err) {
    console.log(`Note: ${err.message}\n`);
  }

  await conn.disconnect();
  process.exit(0);
} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
