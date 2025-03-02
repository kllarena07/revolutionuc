// app/api/warren-run/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  SageMakerClient,
  CreateProcessingJobCommand,
  DescribeProcessingJobCommand,
} from "@aws-sdk/client-sagemaker";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { Readable } from "stream";

// Configure AWS clients
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
});

const sagemakerClient = new SageMakerClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
});

// S3 bucket for storing notebooks and results
const BUCKET_NAME = process.env.S3_BUCKET_NAME || "current-sagemaker-notebooks";
const SAGEMAKER_ROLE_ARN = process.env.SAGEMAKER_ROLE_ARN || "";

export async function POST(request: NextRequest) {
  try {
    // Parse form data
    const formData = await request.formData();
    const notebookFile = formData.get("notebook") as File;

    if (!notebookFile || !notebookFile.name.endsWith(".ipynb")) {
      return NextResponse.json(
        { error: "Invalid notebook file" },
        { status: 400 }
      );
    }

    // Generate a unique ID for this job
    const jobId = randomUUID().substring(0, 8);
    const notebookKey = `notebooks/${jobId}/${notebookFile.name}`;
    const outputKey = `output/${jobId}/`;
    const scriptKey = `scripts/${jobId}/notebook-runner.sh`;
    const logsKey = `logs/${jobId}/`;
    // Read the file content
    const fileBuffer = await notebookFile.arrayBuffer();

    // Upload notebook to S3
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: notebookKey,
        Body: Buffer.from(fileBuffer),
        ContentType: "application/x-ipynb+json",
      })
    );

    console.log(`Uploaded notebook to s3://${BUCKET_NAME}/${notebookKey}`);

    // Read the bash script that will be used to run the notebook
    const scriptPath = path.join(
      process.cwd(),
      "src/app/api/warren-run/script.txt"
    );
    const scriptContent = fs.readFileSync(scriptPath, "utf8");
    
    // Clean up the script - remove any duplicate content and ensure it's a valid bash script
    // Get the first script that ends with exit 0
    const scriptLines = scriptContent.split('\n');
    let cleanScript = "";
    let firstScriptFound = false;
    
    for (let i = 0; i < scriptLines.length; i++) {
      const line = scriptLines[i];
      
      if (line.startsWith("#!/bin/bash") && !firstScriptFound) {
        firstScriptFound = true;
        cleanScript = "#!/bin/bash\nset -e\n\n";
      } else if (line.startsWith("#!/bin/bash") && firstScriptFound) {
        break; // Stop at the beginning of a new script
      } else if (firstScriptFound) {
        // Skip the "set -e" line as we already added it
        if (!line.trim().startsWith("set -e")) {
          cleanScript += line + "\n";
        }
      }
    }
    
    // Add the proper bash script for notebook execution with streaming logs
    const fullScript = `#!/bin/bash
set -e

# Install required packages
pip install nbconvert ipykernel matplotlib scikit-learn boto3 awscli

# Set up environment variables from the SageMaker job
JOB_ID=$(echo $AWS_PROCESSING_JOB_NAME | cut -d'-' -f3-)
S3_BUCKET="${BUCKET_NAME}"
S3_LOG_PREFIX="logs/${jobId}"
LOCAL_LOG_FILE="/tmp/notebook_output.log"

# Set up output directory
OUTPUT_DIR=/opt/ml/processing/output
mkdir -p $OUTPUT_DIR

# Find the notebook file in the input directory
NOTEBOOK_DIR=/opt/ml/processing/input/notebook
NOTEBOOK_FILE=$(find $NOTEBOOK_DIR -name "*.ipynb" | head -1)

if [ -z "$NOTEBOOK_FILE" ]; then
  echo "Error: No notebook file found in $NOTEBOOK_DIR" | tee -a $LOCAL_LOG_FILE
  aws s3 cp $LOCAL_LOG_FILE s3://$S3_BUCKET/$S3_LOG_PREFIX/execution.log
  exit 1
fi

echo "Using notebook file: $NOTEBOOK_FILE" | tee -a $LOCAL_LOG_FILE

# Function to upload logs to S3 in real-time
upload_logs() {
  # Use a fixed path structure to avoid nesting issues
  aws s3 cp $LOCAL_LOG_FILE s3://$S3_BUCKET/$S3_LOG_PREFIX/execution.log
}

# Upload initial log
upload_logs

# Set up a background process to upload logs every 3 seconds
(
  while true; do
    upload_logs
    sleep 3
  done
) &
UPLOAD_PID=$!

# Trap to ensure the background process is killed when the script exits
trap "kill $UPLOAD_PID 2>/dev/null; upload_logs" EXIT TERM INT

# Convert notebook to Python script
echo "Converting notebook to Python script..." | tee -a $LOCAL_LOG_FILE
jupyter nbconvert --to script "$NOTEBOOK_FILE" --output /tmp/converted_notebook 2>&1 | tee -a $LOCAL_LOG_FILE
upload_logs

# Execute the converted script with output capturing
echo "Executing notebook..." | tee -a $LOCAL_LOG_FILE
python /tmp/converted_notebook.py 2>&1 | tee -a $LOCAL_LOG_FILE

# Final upload of logs
upload_logs

# Copy output files to the output directory
cp $LOCAL_LOG_FILE $OUTPUT_DIR/execution.log

# Copy any generated figures or data files to the output directory
find /tmp -type f -name "*.png" -o -name "*.csv" -o -name "*.json" | while read file; do
  cp "$file" $OUTPUT_DIR/
done

# FIXED: Use a flat structure for outputs - don't nest under /outputs/
# Instead put directly in the jobId folder to prevent nesting
aws s3 sync $OUTPUT_DIR s3://$S3_BUCKET/$S3_LOG_PREFIX/

echo "Notebook execution completed. Logs available at s3://$S3_BUCKET/$S3_LOG_PREFIX/execution.log" | tee -a $LOCAL_LOG_FILE
upload_logs

exit 0
`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: scriptKey,
        Body: fullScript,
        ContentType: "text/plain",
      })
    );

    console.log(`Uploaded script to s3://${BUCKET_NAME}/${scriptKey}`);

    // Create a processing job
    const processingJobName = `notebook-job-${jobId}`;

    await sagemakerClient.send(
      new CreateProcessingJobCommand({
        ProcessingJobName: processingJobName,
        RoleArn: SAGEMAKER_ROLE_ARN,
        ProcessingInputs: [
          {
            InputName: "notebook",
            S3Input: {
              S3Uri: `s3://${BUCKET_NAME}/${notebookKey}`,
              LocalPath: "/opt/ml/processing/input/notebook",
              S3DataType: "S3Prefix",
              S3InputMode: "File",
            },
          },
        ],
        ProcessingOutputConfig: {
          Outputs: [
            {
              OutputName: "output",
              S3Output: {
                S3Uri: `s3://${BUCKET_NAME}/${outputKey}`,
                LocalPath: "/opt/ml/processing/output",
                S3UploadMode: "EndOfJob",
              },
            },
          ],
        },
        ProcessingResources: {
          ClusterConfig: {
            InstanceCount: 1,
            InstanceType:
              (process.env.SAGEMAKER_INSTANCE_TYPE as any) || "ml.t3.medium",
            VolumeSizeInGB: 5,
          },
        },
        StoppingCondition: {
          MaxRuntimeInSeconds: 900, // 15 minutes
        },
        AppSpecification: {
          ImageUri: `763104351884.dkr.ecr.${
            process.env.AWS_REGION || "us-east-1"
          }.amazonaws.com/tensorflow-training:2.11.0-cpu-py39-ubuntu20.04-sagemaker`,
          ContainerEntrypoint: [
            "bash",
            "-c",
            `aws s3 cp s3://${BUCKET_NAME}/${scriptKey} /tmp/notebook-runner.sh && chmod +x /tmp/notebook-runner.sh && /tmp/notebook-runner.sh`
          ],
        },
        NetworkConfig: {
          EnableNetworkIsolation: false,
        },
        Environment: {
          BUCKET_NAME: BUCKET_NAME,
          NOTEBOOK_PATH: notebookKey,
          SCRIPT_KEY: scriptKey,
        },
      })
    );

    // Return the job info
    return NextResponse.json({
      jobId,
      jobName: processingJobName,
      status: "processing",
      outputLocation: `s3://${BUCKET_NAME}/${outputKey}`,
      logsLocation: `s3://${BUCKET_NAME}/logs/${jobId}/execution.log`,
      message: "Notebook job submitted to SageMaker",
      streaming: true,
    });
  } catch (error) {
    console.error("Error processing notebook:", error);
    let errorMessage = "Failed to process notebook";

    if (error instanceof Error) {
      errorMessage = error.message;
    }

    return NextResponse.json(
      {
        error: errorMessage,
        suggestion: "Check your AWS credentials and roles",
      },
      { status: 500 }
    );
  }
}
