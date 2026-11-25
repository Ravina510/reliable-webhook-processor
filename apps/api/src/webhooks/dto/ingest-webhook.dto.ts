import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class IngestWebhookDto {
  @IsString()
  @IsNotEmpty()
  eventId!: string;

  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsObject()
  @IsOptional()
  data?: Record<string, unknown>;
}
