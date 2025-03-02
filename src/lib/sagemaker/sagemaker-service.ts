import {
  SageMakerClient,
  CreateNotebookInstanceCommand,
  CreatePresignedNotebookInstanceUrlCommand,
  DescribeNotebookInstanceCommand,
  DeleteNotebookInstanceCommand,
  CreateNotebookInstanceInput,
  CreateNotebookInstanceLifecycleConfigCommand,
  DescribeNotebookInstanceLifecycleConfigCommand,
  DeleteNotebookInstanceLifecycleConfigCommand,
} from "@aws-sdk/client-sagemaker";
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import {
  SageMakerConfig,
  NotebookExecutionStatus,
  NotebookExecutionResult,
  LifecycleConfigOptions,
} from "./types";

export class SageMakerService {
  private client: SageMakerClient;
  private s3Client: S3Client;
  private config: SageMakerConfig;

  constructor(config: SageMakerConfig) {
    const credentials = {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    };

    this.client = new SageMakerClient({
      region: config.region,
      credentials,
    });

    this.s3Client = new S3Client({
      region: config.region,
      credentials,
    });

    this.config = config;
  }

  /**
   * Create a lifecycle configuration for the notebook instance
   */
  async createLifecycleConfig(
    options: LifecycleConfigOptions
  ): Promise<string> {
    try {
      // Create the lifecycle configuration
      await this.client.send(
        new CreateNotebookInstanceLifecycleConfigCommand({
          NotebookInstanceLifecycleConfigName: options.configName,
          OnStart: [
            {
              Content: Buffer.from(options.onStartScript).toString("base64"),
            },
          ],
        })
      );

      // Wait for the lifecycle config to be created
      let status = "";
      do {
        try {
          const response = await this.client.send(
            new DescribeNotebookInstanceLifecycleConfigCommand({
              NotebookInstanceLifecycleConfigName: options.configName,
            })
          );

          status = "Created";
          console.log(
            `Lifecycle config ${options.configName} created successfully`
          );
        } catch (error) {
          // Config still being created
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } while (status !== "Created");

      return options.configName;
    } catch (error) {
      console.error("Error creating lifecycle config:", error);
      throw error;
    }
  }

  /**
   * Create a notebook instance with optional lifecycle configuration
   */
  async createNotebookInstance(
    notebookName: string,
    lifecycleConfigName?: string
  ): Promise<void> {
    const params: any = {
      NotebookInstanceName: notebookName,
      InstanceType: this.config
        .instanceType as CreateNotebookInstanceInput["InstanceType"],
      RoleArn: this.config.roleArn,
      DirectInternetAccess: "Enabled",
    };

    // Add lifecycle configuration if provided
    if (lifecycleConfigName) {
      params.LifecycleConfigName = lifecycleConfigName;
    }

    await this.client.send(new CreateNotebookInstanceCommand(params));

    // Wait for the notebook instance to be in 'InService' state
    let status = "";
    do {
      const response = await this.client.send(
        new DescribeNotebookInstanceCommand({
          NotebookInstanceName: notebookName,
        })
      );

      status = response.NotebookInstanceStatus || "";

      if (status === "Failed") {
        throw new Error("Notebook instance creation failed");
      }

      if (status !== "InService") {
        // Wait 15 seconds before checking again
        await new Promise((resolve) => setTimeout(resolve, 15000));
      }
    } while (status !== "InService");

    // Start the notebook instance
    // await this.client.send(
    //   new StartNotebookInstanceCommand({
    //     NotebookInstanceName: notebookName,
    //   })
    // );
  }

  /**
   * Get the status of a notebook execution by checking the status file in S3
   */
  async getNotebookExecutionStatus(
    executionId: string
  ): Promise<NotebookExecutionResult | null> {
    try {
      const outputBucket =
        this.config.outputBucketName || this.config.s3BucketName;
      const statusKey = `executions/${executionId}/status.json`;
      const shutdownKey = `executions/${executionId}/shutdown_marker.json`;

      // Check if the status file exists
      try {
        await this.s3Client.send(
          new HeadObjectCommand({
            Bucket: outputBucket,
            Key: statusKey,
          })
        );
      } catch (error) {
        // Status file doesn't exist yet
        return {
          executionId,
          status: NotebookExecutionStatus.PENDING,
          outputs: [],
          startTime: new Date(),
          notebookPath: "",
          outputPath: "",
        };
      }

      // Get the status file
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: outputBucket,
          Key: statusKey,
        })
      );

      // Parse the status file
      const statusData = await response.Body?.transformToString();
      if (!statusData) {
        throw new Error("Failed to read execution status data");
      }

      const statusJson = JSON.parse(statusData);

      // Convert string dates to Date objects
      if (statusJson.startTime) {
        statusJson.startTime = new Date(statusJson.startTime);
      }
      if (statusJson.endTime) {
        statusJson.endTime = new Date(statusJson.endTime);
      }

      // Check for shutdown marker file
      let shutdownInfo: {
        isInstanceShutdown: boolean;
        shutdownReason: string | undefined;
        shutdownTime: Date | undefined;
      } = {
        isInstanceShutdown: false,
        shutdownReason: undefined,
        shutdownTime: undefined,
      };

      try {
        // Try to get the shutdown marker file
        const shutdownResponse = await this.s3Client.send(
          new GetObjectCommand({
            Bucket: outputBucket,
            Key: shutdownKey,
          })
        );

        // Parse the shutdown data
        const shutdownData = await shutdownResponse.Body?.transformToString();
        if (shutdownData) {
          const shutdownJson = JSON.parse(shutdownData);
          shutdownInfo = {
            isInstanceShutdown: true,
            shutdownReason: shutdownJson.reason || shutdownJson.shutdownReason,
            shutdownTime:
              shutdownJson.timestamp || shutdownJson.shutdownTime
                ? new Date(shutdownJson.timestamp || shutdownJson.shutdownTime)
                : undefined,
          };
        }
      } catch (error) {
        // Shutdown file doesn't exist or couldn't be read, continue without it
        console.log(
          `No shutdown marker file found for execution ${executionId}`
        );
      }

      return {
        executionId: statusJson.executionId,
        status: statusJson.status,
        outputs: statusJson.outputs || [],
        errorMessage: statusJson.errorMessage,
        startTime: statusJson.startTime,
        endTime: statusJson.endTime,
        notebookPath: statusJson.notebookPath || "",
        outputPath: statusJson.outputPath || "",
        cellsTotal: statusJson.cellsTotal,
        cellsCompleted: statusJson.cellsCompleted,
        progress: statusJson.progress,
        currentCell: statusJson.currentCell,
        errorDetail: statusJson.errorDetail,
        stackTrace: statusJson.stackTrace,
        cellErrorOutput: statusJson.cellErrorOutput,
        systemInfo: statusJson.systemInfo,
        ...shutdownInfo,
      };
    } catch (error) {
      console.error("Error getting notebook execution status:", error);
      throw error;
    }
  }

  /**
   * Delete a lifecycle configuration
   */
  async deleteLifecycleConfig(configName: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteNotebookInstanceLifecycleConfigCommand({
          NotebookInstanceLifecycleConfigName: configName,
        })
      );
    } catch (error) {
      console.error("Error deleting lifecycle config:", error);
      // Don't throw the error, just log it
    }
  }

  async getNotebookUrl(notebookName: string): Promise<string> {
    const response = await this.client.send(
      new CreatePresignedNotebookInstanceUrlCommand({
        NotebookInstanceName: notebookName,
      })
    );

    return response.AuthorizedUrl || "";
  }

  async deleteNotebookInstance(notebookName: string): Promise<void> {
    await this.client.send(
      new DeleteNotebookInstanceCommand({
        NotebookInstanceName: notebookName,
      })
    );
  }
}
