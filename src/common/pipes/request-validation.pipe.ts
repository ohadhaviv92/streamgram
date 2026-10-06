import {
  ArgumentMetadata,
  Injectable,
  PipeTransform,
  ValidationPipe,
} from "@nestjs/common";

/** Reject unknown management fields without rejecting Stremio's route/query extras. */
@Injectable()
export class RequestValidationPipe implements PipeTransform {
  private readonly body = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });
  private readonly route = new ValidationPipe({
    whitelist: true,
    transform: true,
  });
  transform(value: unknown, metadata: ArgumentMetadata) {
    return (metadata.type === "body" ? this.body : this.route).transform(
      value,
      metadata,
    );
  }
}
