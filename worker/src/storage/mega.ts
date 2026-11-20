import { NO_CAPABILITIES, StorageError, type StorageProvider } from "./types";

const REASON =
  "MEGA is not supported: MEGA has no documented server-side REST API with token auth usable from Workers. Its SDK requires the account password and client-side crypto, which this app will not handle.";

function unsupported(): never {
  throw new StorageError("unsupported", REASON);
}

/** Explicitly unsupported placeholder. Every operation fails; it never reports connectivity. */
export class MegaProvider implements StorageProvider {
  readonly kind = "mega" as const;
  readonly capabilities = NO_CAPABILITIES;
  constructor(readonly id: string) {}
  static readonly reason = REASON;
  listFiles(): never { return unsupported(); }
  uploadFile(): never { return unsupported(); }
  createUploadUrl(): never { return unsupported(); }
  downloadFile(): never { return unsupported(); }
  createDownloadUrl(): never { return unsupported(); }
  deleteFile(): never { return unsupported(); }
  renameFile(): never { return unsupported(); }
  createFolder(): never { return unsupported(); }
  getFileMetadata(): never { return unsupported(); }
  getStorageUsage(): never { return unsupported(); }
  async testConnection() { return { ok: false, message: REASON }; }
}
