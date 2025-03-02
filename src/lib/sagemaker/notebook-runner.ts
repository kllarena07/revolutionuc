import { S3Service } from "./s3-service";
import { SageMakerService } from "./sagemaker-service";
import { SageMakerConfig, NotebookRunResult } from "./types";

export class NotebookRunner {
  private s3Service: S3Service;
  private sageMakerService: SageMakerService;
  private config: SageMakerConfig;

  constructor(config: SageMakerConfig) {
    this.config = config;
    this.s3Service = new S3Service(config.region, config.s3BucketName);
    this.sageMakerService = new SageMakerService(config);
  }

  async runNotebook(
    notebookContent: Buffer,
    fileName: string
  ): Promise<NotebookRunResult> {
    try {
      // Generate a unique notebook instance name
      const timestamp = new Date().getTime();
      const instanceName = `${this.config.notebookName}-${timestamp}`;

      // 1. Upload the notebook to S3
      const s3Key = await this.s3Service.uploadNotebook(
        notebookContent,
        fileName
      );

      // 2. Create and start the notebook instance
      await this.sageMakerService.createNotebookInstance(instanceName);

      // 3. Get the presigned URL to access the notebook
      const notebookUrl = await this.sageMakerService.getNotebookUrl(
        instanceName
      );

      return {
        notebookUrl,
        instanceName,
        s3Path: `s3://${this.config.s3BucketName}/${s3Key}`,
      };
    } catch (error) {
      console.error("Error running notebook:", error);
      throw error;
    }
  }

  async cleanupResources(instanceName: string): Promise<void> {
    await this.sageMakerService.deleteNotebookInstance(instanceName);
  }
}
