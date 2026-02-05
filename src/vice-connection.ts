/**
 * VICE connection management and launcher
 */

import { spawn, ChildProcess } from 'child_process';
import { Socket } from 'net';
import { ViceProtocol } from './vice-protocol.js';
import * as path from 'path';

export interface ViceConfig {
  vicePath: string;
  emulator: string;
  monitorPort: number;
}

export class ViceConnection {
  private config: ViceConfig;
  private process: ChildProcess | null = null;
  private socket: Socket | null = null;
  private protocol: ViceProtocol | null = null;
  private isConnected = false;

  constructor(config: ViceConfig) {
    this.config = config;
  }

  /**
   * Launch VICE with binary monitor enabled
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      throw new Error('Already connected to VICE');
    }

    const emulatorPath = path.join(this.config.vicePath, `${this.config.emulator}.exe`);
    const monitorAddress = `127.0.0.1:${this.config.monitorPort}`;

    console.error(`[VICE] Launching ${emulatorPath}`);
    console.error(`[VICE] Binary monitor on ${monitorAddress}`);

    // Launch VICE with binary monitor enabled
    this.process = spawn(emulatorPath, [
      '-binarymonitor',
      '-binarymonitoraddress', monitorAddress,
      '-sounddev', 'dummy', // Disable sound for headless debugging
    ], {
      stdio: ['ignore', 'ignore', 'ignore'], // Use array syntax to avoid Windows 'nul' file creation
      detached: false,
    });

    this.process.on('error', (err) => {
      console.error('[VICE] Process error:', err);
    });

    this.process.on('exit', (code) => {
      console.error(`[VICE] Process exited with code ${code}`);
      this.cleanup();
    });

    // Wait for VICE to start and open monitor port
    await this.waitForMonitor();
  }

  /**
   * Wait for VICE monitor to become available
   */
  private async waitForMonitor(): Promise<void> {
    const maxAttempts = 20;
    const delayMs = 500;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        this.socket = new Socket();

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Connection timeout'));
          }, 3000);

          this.socket!.connect(this.config.monitorPort, '127.0.0.1', () => {
            clearTimeout(timeout);
            resolve();
          });

          this.socket!.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        // Connected successfully
        this.protocol = new ViceProtocol(this.socket);

        // Test connection with ping
        await this.protocol.ping();

        // Resume execution (VICE starts paused when binary monitor connects)
        await this.protocol.resume();

        this.isConnected = true;
        console.error('[VICE] Connected to binary monitor');
        return;

      } catch (err) {
        if (this.socket) {
          this.socket.destroy();
          this.socket = null;
        }

        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    throw new Error('Failed to connect to VICE monitor after multiple attempts');
  }

  /**
   * Disconnect and close VICE
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    this.cleanup();
    console.error('[VICE] Disconnected');
  }

  private cleanup(): void {
    this.isConnected = false;

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    this.protocol = null;
  }

  /**
   * Get the protocol handler
   */
  getProtocol(): ViceProtocol {
    if (!this.protocol || !this.isConnected) {
      throw new Error('Not connected to VICE');
    }
    return this.protocol;
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Check connection health
   */
  async healthCheck(): Promise<boolean> {
    if (!this.isConnected || !this.protocol) {
      return false;
    }

    try {
      await this.protocol.ping();
      return true;
    } catch {
      return false;
    }
  }
}
