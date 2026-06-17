/**
 * VICE connection management and launcher
 */

import { spawn, ChildProcess } from 'child_process';
import { Socket } from 'net';
import { ViceProtocol } from './vice-protocol.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

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
  private logFilePath: string | null = null;

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

    const exeSuffix = process.platform === 'win32' ? '.exe' : '';
    const emulatorPath = path.join(this.config.vicePath, `${this.config.emulator}${exeSuffix}`);
    const monitorAddress = `127.0.0.1:${this.config.monitorPort}`;

    // Create log file for VICE output
    const logDir = path.join(os.tmpdir(), 'vice-mcp');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.logFilePath = path.join(logDir, `vice-${Date.now()}.log`);

    // Open log file with file descriptor for stdio redirection
    const logFd = fs.openSync(this.logFilePath, 'w');

    console.error(`[VICE] Launching ${emulatorPath}`);
    console.error(`[VICE] Binary monitor on ${monitorAddress}`);
    console.error(`[VICE] Log file: ${this.logFilePath}`);

    // Launch VICE with binary monitor enabled
    // Redirect stdout and stderr to log file to prevent console flooding
    // Note: VICE emulator window will still be visible for interaction
    this.process = spawn(emulatorPath, [
      '-binarymonitor',
      '-binarymonitoraddress', monitorAddress,
      '-sounddev', 'dummy', // Disable sound for headless debugging
    ], {
      stdio: ['ignore', logFd, logFd], // Redirect stdout and stderr to log file
      detached: false,
      // windowsHide removed - we want the VICE window visible for user interaction
    });

    this.process.on('error', (err) => {
      console.error('[VICE] Process error:', err);
      fs.closeSync(logFd);
    });

    this.process.on('exit', (code) => {
      console.error(`[VICE] Process exited with code ${code}`);
      fs.closeSync(logFd);
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
    if (this.logFilePath) {
      console.error(`[VICE] Log file saved: ${this.logFilePath}`);
    }
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
