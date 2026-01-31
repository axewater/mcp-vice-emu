/**
 * Test different bank values to find valid ones for memory access
 */

import { ViceConnection } from './dist/vice-connection.js';

const config = {
  vicePath: 'C:\\bin\\vice\\bin',
  emulator: 'x64sc',
  monitorPort: 6502
};

console.log('Testing VICE memory banks...\n');

const conn = new ViceConnection(config);

try {
  await conn.connect();
  const protocol = conn.getProtocol();

  // Test different bank values for memspace 0 (main memory)
  const testBanks = [
    { bank: 0, desc: 'Bank 0 (default)' },
    { bank: 1, desc: 'Bank 1' },
    { bank: 2, desc: 'Bank 2' },
    { bank: 0x100, desc: 'Bank 0x100' },
    { bank: 0x101, desc: 'Bank 0x101' },
  ];

  console.log('Testing different bank values for memspace 0 (main memory):\n');

  for (const test of testBanks) {
    try {
      console.log(`Trying ${test.desc} (${test.bank})...`);
      const mem = await protocol.memoryGet(0x0400, 0x0403, 0, test.bank);
      console.log(`  ✓ SUCCESS! Got ${mem.length} bytes: ${Array.from(mem).map(b => `$${b.toString(16).padStart(2, '0')}`).join(' ')}\n`);
      break; // Found a working bank!
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}\n`);
    }
  }

  // Also test with memspace 0 and try to figure out what memspace means
  console.log('\nTesting different memspace values with bank 0:\n');

  const testMemspaces = [
    { memspace: 0, desc: 'Memspace 0 (computer)' },
    { memspace: 1, desc: 'Memspace 1 (disk 8)' },
  ];

  for (const test of testMemspaces) {
    try {
      console.log(`Trying ${test.desc}...`);
      const mem = await protocol.memoryGet(0x0400, 0x0403, test.memspace, 0);
      console.log(`  ✓ SUCCESS! Got ${mem.length} bytes\n`);
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}\n`);
    }
  }

  await conn.disconnect();
  process.exit(0);
} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  process.exit(1);
}
