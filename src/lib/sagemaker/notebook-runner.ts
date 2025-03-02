import { S3Service } from "./s3-service";
import { SageMakerService } from "./sagemaker-service";
import {
  SageMakerConfig,
  NotebookRunResult,
  NotebookExecutionResult,
  NotebookExecutionStatus,
} from "./types";
import { createNotebookLifecycleConfig } from "./lifecycle-config";

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
    fileName: string,
    autoExecute: boolean = false
  ): Promise<NotebookRunResult> {
    try {
      // Generate a unique notebook instance name and execution ID
      const timestamp = new Date().getTime();
      const executionId = `exec-${timestamp}`;
      const instanceName = `${this.config.notebookName}-${timestamp}`;

      // 1. Upload the notebook to S3
      const s3Key = await this.s3Service.uploadNotebook(
        notebookContent,
        fileName,
        `notebooks/${executionId}/`
      );

      // Get the full S3 path
      const s3Path = `s3://${this.config.s3BucketName}/${s3Key}`;

      // Setup for notebook execution
      if (autoExecute) {
        // 2. Create lifecycle configuration for auto-execution
        const outputBucket =
          this.config.outputBucketName || this.config.s3BucketName;
        const lifecycleConfig = await createNotebookLifecycleConfig(
          s3Path,
          outputBucket,
          executionId
        );

        // 3. Create the lifecycle configuration in SageMaker
        const lifecycleConfigName =
          await this.sageMakerService.createLifecycleConfig(lifecycleConfig);

        // 4. Create and start the notebook instance with the lifecycle configuration
        await this.sageMakerService.createNotebookInstance(
          instanceName,
          lifecycleConfigName
        );

        // 5. Return initial execution info
        return {
          notebookUrl: "", // No URL returned when auto-executing
          instanceName,
          s3Path,
          executionId,
          status: NotebookExecutionStatus.PENDING,
        };
      } else {
        // Standard notebook instance creation without auto-execution
        await this.sageMakerService.createNotebookInstance(instanceName);

        // Get the notebook URL
        const notebookUrl = await this.sageMakerService.getNotebookUrl(
          instanceName
        );

        // Return the notebook run result
        return {
          notebookUrl,
          instanceName,
          s3Path,
        };
      }
    } catch (error) {
      console.error("Error running notebook:", error);
      throw error;
    }
  }

  /**
   * Check the execution status of a notebook
   * @param executionId The execution ID to check
   * @returns The current execution status and results
   */
  async checkExecutionStatus(
    executionId: string
  ): Promise<NotebookExecutionResult> {
    try {
      const status = await this.sageMakerService.getNotebookExecutionStatus(
        executionId
      );

      if (!status) {
        // If no status found, assume it's still pending
        return {
          executionId,
          status: NotebookExecutionStatus.PENDING,
          outputs: [],
          startTime: new Date(),
          notebookPath: "", // Add missing property with empty string as default
          outputPath: "", // Add missing property with empty string as default
        };
      }

      return status;
    } catch (error) {
      console.error("Error checking notebook execution status:", error);
      throw error;
    }
  }

  /**
   * Check if a notebook execution has completed (either successfully or with failure)
   * @param executionId The execution ID to check
   * @returns True if the execution has completed
   */
  async isExecutionComplete(executionId: string): Promise<boolean> {
    const status = await this.checkExecutionStatus(executionId);
    return (
      status.status === NotebookExecutionStatus.COMPLETED ||
      status.status === NotebookExecutionStatus.FAILED
    );
  }

  /**
   * Wait for a notebook execution to complete, with a timeout
   * @param executionId The execution ID to wait for
   * @param timeoutMs Maximum time to wait in milliseconds (default: 20 minutes)
   * @param pollIntervalMs Interval between status checks in milliseconds (default: 10 seconds)
   * @returns The final execution result
   */
  async waitForExecution(
    executionId: string,
    timeoutMs = 20 * 60 * 1000,
    pollIntervalMs = 10000
  ): Promise<NotebookExecutionResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.checkExecutionStatus(executionId);

      if (
        status.status === NotebookExecutionStatus.COMPLETED ||
        status.status === NotebookExecutionStatus.FAILED
      ) {
        return status;
      }

      // Wait for the next poll interval
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Notebook execution timed out after ${timeoutMs}ms`);
  }

  /**
   * Clean up resources associated with a notebook run
   * @param instanceName The name of the notebook instance to delete
   * @param lifecycleConfigName Optional name of the lifecycle configuration to delete
   */
  async cleanupResources(
    instanceName: string,
    lifecycleConfigName?: string
  ): Promise<void> {
    // Delete the notebook instance
    await this.sageMakerService.deleteNotebookInstance(instanceName);

    // Delete the lifecycle configuration if provided
    if (lifecycleConfigName) {
      await this.sageMakerService.deleteLifecycleConfig(lifecycleConfigName);
    }
  }
}
