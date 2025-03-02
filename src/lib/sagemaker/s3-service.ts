import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export class S3Service {
  private client: S3Client;
  private bucketName: string;

  constructor(region: string, bucketName: string) {
    this.client = new S3Client({
      region: region,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
    });
    this.bucketName = bucketName;
  }

  async uploadNotebook(
    notebookContent: Buffer,
    fileName: string
  ): Promise<string> {
    const timestamp = new Date().getTime();
    const s3Key = `${timestamp}-${fileName}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        Body: notebookContent,
      })
    );

    return s3Key;
  }
}
