// OS Kernel Ring Buffer (dmesg) Simulator and Event Dispatcher

class KernelLogEmitter {
  constructor() {
    this.logs = [
      {
        id: 1,
        timestamp: '0.000000',
        subsystem: 'boot',
        level: 'INFO',
        message: 'Linux kernel v6.8.0-pbl-vfs (x86_64) #1 SMP PREEMPT_DYNAMIC initialized.',
      },
      {
        id: 2,
        timestamp: '0.001240',
        subsystem: 'vfs',
        level: 'INFO',
        message: 'VFS: Mounted root filesystem ext4 on /dev/nvme0n1p2 (rw, barrier=1, data=ordered).',
      },
      {
        id: 3,
        timestamp: '0.002810',
        subsystem: 'mm',
        level: 'INFO',
        message: 'mm: Initialized Page Cache pool: dirty_ratio=20%, dirty_background_ratio=10%.',
      },
      {
        id: 4,
        timestamp: '0.004120',
        subsystem: 'jbd2',
        level: 'INFO',
        message: 'jbd2: Write-Ahead Log (WAL) journal transaction worker started for crash consistency.',
      },
    ];
    this.listeners = new Set();
    this.startTime = Date.now();
  }

  getKernelUptime() {
    const elapsedSec = (Date.now() - this.startTime) / 1000;
    return (124 + elapsedSec).toFixed(6);
  }

  log(subsystem, message, level = 'INFO') {
    const entry = {
      id: Date.now() + Math.random(),
      timestamp: this.getKernelUptime(),
      subsystem,
      level,
      message,
    };
    this.logs.push(entry);
    if (this.logs.length > 80) {
      this.logs.shift();
    }
    this.notify();
    return entry;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener([...this.logs]);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) {
      listener([...this.logs]);
    }
  }

  clear() {
    this.logs = [];
    this.notify();
  }
}

export const kernelLogger = new KernelLogEmitter();
