import type { CostSource } from '../domain/money.js';
import type { TransactionDraft } from '../db/records.js';

export interface SourceRecord {
  draft: TransactionDraft;
}

export interface ManualSourceRecord extends SourceRecord {
  invoice: string | null;
  explicitReference: string | null;
}

export interface ImportCounts {
  read: number;
  accepted: number;
  duplicate: number;
  review: number;
}

export interface ImportReport extends ImportCounts {
  source: CostSource;
  status: 'succeeded' | 'partial' | 'failed';
  error?: string;
}
