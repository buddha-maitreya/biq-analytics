export interface DataConnector {
  type: string;
  displayName: string;
  validate(config: ConnectorConfig): Promise<{ valid: boolean; error?: string }>;
  sync(config: ConnectorConfig, options?: SyncOptions): Promise<SyncResult>;
}

export interface ConnectorConfig {
  type: string;
  settings: Record<string, unknown>;
  fieldMapping?: Record<string, string>;
  lastSyncAt?: Date;
}

export interface SyncOptions {
  dryRun?: boolean;
  batchSize?: number;
  mode?: "create" | "update" | "upsert";
  onProgress?: (processed: number, total: number) => void;
}

export interface SyncResult {
  success: boolean;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  errors: Array<{ row: number; field?: string; error: string }>;
  syncedAt: Date;
}
