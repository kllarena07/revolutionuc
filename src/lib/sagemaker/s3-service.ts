import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

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
    fileName: string,
    directory?: string
  ): Promise<string> {
    const timestamp = new Date().getTime();
    
    // Construct the S3 key with optional directory
    let s3Key: string;
    if (directory) {
      // Make sure directory doesn't start or end with a slash
      const cleanDirectory = directory.replace(/^\/+|\/+$/g, '');
      s3Key = `${cleanDirectory}/${timestamp}-${fileName}`;
    } else {
      s3Key = `${timestamp}-${fileName}`;
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        Body: notebookContent,
      })
    );

    return s3Key;
  }

  async downloadFile(s3Key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
    });

    try {
      const response = await this.client.send(command);
      
      // Convert the stream to a buffer
      if (!response.Body) {
        throw new Error("No file content received from S3");
      }
      
      const chunks: Uint8Array[] = [];
      // @ts-ignore - The Body is a ReadableStream
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      
      return Buffer.concat(chunks);
    } catch (error) {
      console.error("Error downloading file from S3:", error);
      throw new Error(`Failed to download file: ${s3Key}`);
    }
  }
}
