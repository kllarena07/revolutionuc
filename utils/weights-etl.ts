import {
  SageMakerClient,
  StopTrainingJobCommand,
  DescribeTrainingJobCommand,
} from "@aws-sdk/client-sagemaker";
import {
  S3Client,
  CopyObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

// Environment variables to be set in Lambda configuration
const {
  TRAINING_JOB_NAME,
  SOURCE_BUCKET,
  DESTINATION_BUCKET,
  DESTINATION_PREFIX,
  REGION,
} = process.env;

// Create clients
const sagemakerClient = new SageMakerClient({ region: REGION });
const s3Client = new S3Client({ region: REGION });
const lambdaClient = new LambdaClient({ region: REGION });

/**
 * Main handler function for AWS Lambda
 */
export const handler = async (event: any): Promise<any> => {
  try {
    console.log(
      "Starting checkpoint extraction process for job:",
      TRAINING_JOB_NAME
    );

    // Step 1: Stop the training job to create the final checkpoint
    await pauseTrainingJob(TRAINING_JOB_NAME as string);

    // Step 2: Wait for the training job to fully stop
    await waitForJobToStop(TRAINING_JOB_NAME as string);

    // Step 3: Get checkpoint location from the training job
    const checkpointPath = await getCheckpointPath(TRAINING_JOB_NAME as string);

    // Step 4: Copy checkpoint files to destination with FSx for Lustre
    await copyCheckpointFiles(checkpointPath);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Successfully paused training job and copied checkpoints",
        jobName: TRAINING_JOB_NAME,
        checkpointPath: checkpointPath,
        destinationBucket: DESTINATION_BUCKET,
        destinationPrefix: DESTINATION_PREFIX,
      }),
    };
  } catch (error) {
    console.error("Error in checkpoint extraction process:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error processing checkpoint extraction",
        error: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};

/**
 * Pause a SageMaker training job
 * @param jobName The name of the training job to pause
 */
const pauseTrainingJob = async (jobName: string): Promise<void> => {
  try {
    const command = new StopTrainingJobCommand({
      TrainingJobName: jobName,
    });

    await sagemakerClient.send(command);
    console.log(`Successfully requested to stop training job: ${jobName}`);
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "ValidationException" &&
      error.message.includes("Job is not in a stopped state")
    ) {
      console.log(`Job ${jobName} is already stopped.`);
      return;
    }
    throw error;
  }
};

/**
 * Wait for a SageMaker training job to fully stop
 * @param jobName The name of the training job
 */
const waitForJobToStop = async (jobName: string): Promise<void> => {
  console.log(`Waiting for job ${jobName} to stop completely...`);

  let jobStopped = false;
  const maxAttempts = 30; // Timeout after 30 attempts (5 minutes)
  let attempts = 0;

  while (!jobStopped && attempts < maxAttempts) {
    const command = new DescribeTrainingJobCommand({
      TrainingJobName: jobName,
    });

    const response = await sagemakerClient.send(command);
    const status = response.TrainingJobStatus;

    if (status === "Stopped" || status === "Failed" || status === "Completed") {
      jobStopped = true;
      console.log(`Job ${jobName} is now in ${status} state.`);
    } else {
      console.log(`Job ${jobName} is in ${status} state. Waiting...`);
      attempts++;
      // Wait 10 seconds before checking again
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }

  if (!jobStopped) {
    throw new Error(`Timeout waiting for job ${jobName} to stop.`);
  }
};

/**
 * Extract the checkpoint path from a training job
 * @param jobName The name of the training job
 * @returns The S3 path of the checkpoint
 */
const getCheckpointPath = async (jobName: string): Promise<string> => {
  const command = new DescribeTrainingJobCommand({
    TrainingJobName: jobName,
  });

  const response = await sagemakerClient.send(command);

  // Get the model output path
  const outputPath = response.OutputDataConfig?.S3OutputPath;
  if (!outputPath) {
    throw new Error(`No output path found for job ${jobName}`);
  }

  // Extract bucket and prefix from S3 URI
  const s3Uri = new URL(outputPath);
  const bucket = s3Uri.hostname;
  // Remove leading slash
  let prefix = s3Uri.pathname.substring(1);
  if (!prefix.endsWith("/")) {
    prefix += "/";
  }

  // Validate the checkpoint directory exists
  const checkpointPrefix = `${prefix}${jobName}/output/model/`;
  const listCommand = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: checkpointPrefix,
    MaxKeys: 1,
  });

  const listResponse = await s3Client.send(listCommand);
  if (!listResponse.Contents || listResponse.Contents.length === 0) {
    throw new Error(
      `No checkpoint files found at s3://${bucket}/${checkpointPrefix}`
    );
  }

  console.log(`Found checkpoint files at s3://${bucket}/${checkpointPrefix}`);
  return `s3://${bucket}/${checkpointPrefix}`;
};

/**
 * Copy checkpoint files to the destination bucket with FSx for Lustre integration
 * @param checkpointPath The S3 path to the checkpoint files
 */
const copyCheckpointFiles = async (checkpointPath: string): Promise<void> => {
  // Extract source bucket and prefix from checkpoint path
  const sourcePath = new URL(checkpointPath);
  const sourceBucket = sourcePath.hostname;
  // Remove leading slash
  const sourcePrefix = sourcePath.pathname.substring(1);

  // List all objects in the checkpoint directory
  const listCommand = new ListObjectsV2Command({
    Bucket: sourceBucket,
    Prefix: sourcePrefix,
  });

  let continuationToken = undefined;
  let filesProcessed = 0;

  do {
    const listResponse = await s3Client.send(listCommand);

    if (listResponse.Contents && listResponse.Contents.length > 0) {
      // Process in batches of 25 files (to avoid Lambda timeouts on large models)
      const files = listResponse.Contents;

      if (files.length > 25) {
        // For large checkpoints, we'll trigger another Lambda to continue processing
        console.log(
          `Found ${files.length} files, processing first 25 and chaining Lambda...`
        );
        await processFileBatch(files.slice(0, 25), sourceBucket);
        filesProcessed += 25;

        // Create a continuation event with a token for the next batch
        const continuationEvent = {
          sourceBucket,
          sourcePrefix,
          continuationToken: listResponse.NextContinuationToken,
          processedCount: filesProcessed,
        };

        // Invoke this same Lambda again with the continuation event
        const invokeCommand = new InvokeCommand({
          FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
          InvocationType: "Event", // Asynchronous invocation
          Payload: Buffer.from(JSON.stringify(continuationEvent)),
        });

        await lambdaClient.send(invokeCommand);
        console.log(`Triggered continuation Lambda for remaining files.`);
        break;
      } else {
        // Process all files in this batch
        await processFileBatch(files, sourceBucket);
        filesProcessed += files.length;
      }
    }

    continuationToken = listResponse.NextContinuationToken;
  } while (continuationToken);

  console.log(`Successfully copied ${filesProcessed} checkpoint files.`);
};

/**
 * Process a batch of files for copying
 * @param files Array of S3 objects to copy
 * @param sourceBucket Source bucket name
 */
const processFileBatch = async (
  files: any[],
  sourceBucket: string
): Promise<void> => {
  const copyPromises = files.map((file) => {
    // Extract relative path from the source prefix
    const sourceKey = file.Key;
    const relativeKey = sourceKey.substring(sourceKey.lastIndexOf("/") + 1);
    const destinationKey = `${DESTINATION_PREFIX}/${relativeKey}`;

    const copyCommand = new CopyObjectCommand({
      CopySource: `${sourceBucket}/${sourceKey}`,
      Bucket: DESTINATION_BUCKET as string,
      Key: destinationKey,
    });

    return s3Client
      .send(copyCommand)
      .then(() =>
        console.log(
          `Copied ${sourceKey} to ${DESTINATION_BUCKET}/${destinationKey}`
        )
      )
      .catch((err: any) =>
        console.error(`Failed to copy ${sourceKey}: ${err}`)
      );
  });

  await Promise.all(copyPromises);
};
