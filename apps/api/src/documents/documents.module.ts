import { Module } from "@nestjs/common";
import { DocumentsController } from "./documents.controller.js";
import { DocumentsService } from "./documents.service.js";
import {
  DOCUMENT_SCANNER,
  NotScanningScanner,
} from "./scanning/document-scanner.js";
import { DOCUMENT_STORAGE } from "./storage/document-storage.js";
import { LocalDiskStorage } from "./storage/local-disk-storage.js";
import { storageConfig } from "./storage/storage.config.js";
import { UnavailableStorage } from "./storage/unavailable-storage.js";

@Module({
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
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
})
export class DocumentsModule {}
