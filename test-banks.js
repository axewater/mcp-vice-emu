/**
 * Test script to query available banks and fix memory access
 */

import { ViceConnection } from './dist/vice-connection.js';

const config = {
  vicePath: 'C:\\bin\\vice\\bin',
  emulator: 'x64sc',
  monitorPort: 6502
};

console.log('Testing VICE Banks Available command...\n');

const conn = new ViceConnection(config);

try {
  console.log('1. Connecting to VICE...');
  await conn.connect();
  console.log('✓ Connected!\n');

  const protocol = conn.getProtocol();

  console.log('2. Querying available banks for memspace 0 (main memory)...');
  const banks = await protocol.banksAvailable(0);

  console.log(`✓ Found ${banks.length} banks:\n`);
  banks.forEach(bank => {
    console.log(`  Bank ID ${bank.id.toString().padStart(3)} (0x${bank.id.toString(16).padStart(4, '0')}): ${bank.name}`);
  });

  if (banks.length === 0) {
    console.log('\n⚠️  No banks available - memory commands may not work');
    await conn.disconnect();
    process.exit(0);
  }

  // Try reading memory with each bank until one works
  console.log('\n3. Testing memory read with each bank...\n');

  for (const bank of banks) {
    try {
      console.log(`Trying bank ${bank.id} (${bank.name})...`);
      const mem = await protocol.memoryGet(0x0400, 0x0403, 0, bank.id);
      console.log(`  ✓ SUCCESS! Read ${mem.length} bytes: ${Array.from(mem).map(b => `$${b.toString(16).padStart(2, '0')}`).join(' ')}`);
      console.log(`\n🎉 Solution found! Use bank ID ${bank.id} (${bank.name}) for memory access\n`);
      break;
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
    }
  }

  await conn.disconnect();
  process.exit(0);
} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
