import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { DocumentsController } from "./documents.controller.js";
import { DocumentsService } from "./documents.service.js";
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
} from "./storage/document-storage.js";
import { DocumentStorageModule } from "./storage/storage.module.js";
import { StreamingUploadEngine } from "./upload-engine.js";

@Module({
  imports: [
    DocumentStorageModule,
    // The engine needs the storage instance, which is a provider, so it is
    // built here rather than in the decorator. FileInterceptor merges these
    // module options under its own, so the controller keeps its limits.
    MulterModule.registerAsync({
      imports: [DocumentStorageModule],
      inject: [DOCUMENT_STORAGE],
      useFactory: (storage: DocumentStorage) => ({
        storage: new StreamingUploadEngine(storage),
      }),
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
