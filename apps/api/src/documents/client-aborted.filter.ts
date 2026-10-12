import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  Logger,
} from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";

/**
 * A client that drops the connection mid-upload surfaces in Node as
 * `Error: Request aborted` (`code: "ECONNABORTED"`) thrown out of the body
 * parser. Nest's default handler logs that as an error with a stack trace,
 * which on an iPad over office wifi would be a stack trace per dropped
 * upload, all day, saying nothing anyone needs to act on. The slot is
 * released and the staging file discarded on the response's close event
 * regardless; this filter only decides what gets logged. There is no
 * response to send — the client is gone.
 *
 * Everything else is handed to the default filter unchanged.
 */
@Catch()
export class ClientAbortedFilter
  extends BaseExceptionFilter
  implements ExceptionFilter
{
  private readonly logger = new Logger(ClientAbortedFilter.name);

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (isClientAbort(exception)) {
      const request = host.switchToHttp().getRequest<{ url?: string }>();
      this.logger.warn(`Client dropped the connection during ${request.url ?? "an upload"}`);
      return;
    }

    super.catch(exception, host);
  }
}

function isClientAbort(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === "ECONNABORTED" || message === "Request aborted";
}
