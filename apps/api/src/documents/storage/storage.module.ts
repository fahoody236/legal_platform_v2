import {
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import {
  DOCUMENT_SCANNER,
  NotScanningScanner,
} from "../scanning/document-scanner.js";
import { DOCUMENT_STORAGE, type DocumentStorage } from "./document-storage.js";
import { LocalDiskStorage } from "./local-disk-storage.js";
import { storageConfig } from "./storage.config.js";
import { UnavailableStorage } from "./unavailable-storage.js";

/**
 * The storage and scanner providers, in a module of their own so that both
 * DocumentsModule and the multer registration that needs the storage for its
 * engine can import the same instance.
 *
 * At boot, staged uploads left by a previous process are swept. Nothing can
 * be in flight before the application starts listening, so at that moment
 * every staging file is an orphan.
 */
@Module({
  providers: [
    {
      provide: DOCUMENT_STORAGE,
      useFactory: () =>
        storageConfig.backend === "local"
          ? new LocalDiskStorage(storageConfig.directory)
          : new UnavailableStorage(),
    },
    // Phase 4 replaces this provider; nothing else changes.
    { provide: DOCUMENT_SCANNER, useValue: new NotScanningScanner() },
  ],
  exports: [DOCUMENT_STORAGE, DOCUMENT_SCANNER],
})
export class DocumentStorageModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(DocumentStorageModule.name);

  constructor(@Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage) {}

  async onApplicationBootstrap(): Promise<void> {
    const removed = await this.storage.sweepStaged();

    if (removed > 0) {
      this.logger.warn(`Removed ${removed} orphaned staged upload(s) at startup`);
    }
  }
}
