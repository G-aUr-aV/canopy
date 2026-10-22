export type Tab = 'overview' | 'resources' | 'processes' | 'services' | 'files';
export interface Route { tab: Tab; root?: string; path?: string; file?: string }
export interface Point { timestamp: number; cpu: number | null; memory: number; rx: number | null; tx: number | null; disk_read: number | null; disk_write: number | null }
export interface ProcessInfo { pid: number; name: string; user: string; status: string; cpu: number | null; memory: number; memory_percent: number }
export interface Disk { mount: string; device: string; filesystem: string; total: number; used: number; available: number; percent: number; inodes_total: number; inodes_used: number; inodes_percent: number | null }
export interface Metrics {
  timestamp: number; hostname: string; os: string; kernel: string; architecture: string; region: string; uptime: number;
  cpu: number | null; cores: number[]; logical_cpus: number; physical_cpus: number; load: number[];
  memory: { total: number; used: number; available: number; percent: number; cached: number; buffers: number };
  swap: { total: number; used: number; percent: number }; disks: Disk[];
  interfaces: { name: string; received: number; sent: number; rx: number | null; tx: number | null; errors: number; drops: number }[];
  network: { rx: number | null; tx: number | null }; disk_io: { read: number | null; write: number | null };
  processes: ProcessInfo[]; process_count: number; processes_limited: boolean; history: Point[]; collection_error: string | null; history_seconds: number;
}
export interface Service { name: string; description: string; active: string; state: string; loaded: string; uptime?: number | null }
export interface Services { services: Service[]; timestamp: number | null; stale: boolean; error?: string }
export interface Location { id: string; name: string; path: string; description: string }
export interface Entry { name: string; path: string; kind: 'directory' | 'file' | 'link'; size: number; modified: number; permissions: string; protected: boolean }
export interface Directory { root: string; path: string; entries: Entry[]; truncated: boolean; limit: number }
export interface FileData { root: string; path: string; name: string; content: string; size: number; modified: number; permissions: string; truncated: boolean; preview_bytes: number; encoding: string }
