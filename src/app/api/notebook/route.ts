import { NextRequest, NextResponse } from "next/server";
import { NotebookRunner } from "@/lib/sagemaker/notebook-runner";
import { SageMakerConfig, NotebookExecutionStatus } from "@/lib/sagemaker/types";
import { S3Service } from "@/lib/sagemaker/s3-service";

// Load configuration from environment variables
const sageMakerConfig: SageMakerConfig = {
  region: "us-east-1",
  notebookName: process.env.SAGEMAKER_NOTEBOOK_PREFIX || "notebook-runner",
  instanceType: process.env.SAGEMAKER_INSTANCE_TYPE || "ml.t2.medium",
  roleArn: process.env.SAGEMAKER_ROLE_ARN!,
  s3BucketName: process.env.S3_BUCKET_NAME!,
};

export async function POST(request: NextRequest) {
  try {
    // Get the form data from the request
    const formData = await request.formData();

    // Extract the uploaded file from the form data
    const uploadedFile = formData.get("uploadedFile") as File;

    if (!uploadedFile) {
      return NextResponse.json(
        { error: "Missing required file: uploadedFile" },
        { status: 400 }
      );
    }
    
    // Extract the autoExecute parameter, defaulting to false if not provided
    const autoExecute = formData.get("autoExecute") === "true";

    // Get file name
    const fileName = uploadedFile.name;

    // Get file content as ArrayBuffer and convert to Buffer
    const fileArrayBuffer = await uploadedFile.arrayBuffer();
    const fileBuffer = Buffer.from(fileArrayBuffer);

    // Initialize notebook runner
    const runner = new NotebookRunner(sageMakerConfig);

    // Run the notebook with autoExecute parameter
    const result = await runner.runNotebook(fileBuffer, fileName, autoExecute);

    // Different response message based on autoExecute
    const message = autoExecute 
      ? "Notebook is being auto-executed on SageMaker" 
      : "Notebook is running on SageMaker";

    return NextResponse.json({
      success: true,
      message,
      data: result,
      autoExecuted: autoExecute,
    });
  } catch (error) {
    console.error("Error processing notebook:", error);
    return NextResponse.json(
      {
        error: "Failed to process notebook",
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to check the status of a notebook execution
 */
export async function GET(request: NextRequest) {
  try {
    // Get the execution ID from the query parameters
    const { searchParams } = new URL(request.url);
    const executionId = searchParams.get("executionId");
    
    if (!executionId) {
      return NextResponse.json(
        { error: "Missing required parameter: executionId" },
        { status: 400 }
      );
    }
    
    // Initialize notebook runner
    const runner = new NotebookRunner(sageMakerConfig);
    
    // Check the execution status
    const result = await runner.checkExecutionStatus(executionId);
    
    // Determine if execution is complete
    const isComplete = 
      result.status === NotebookExecutionStatus.COMPLETED || 
      result.status === NotebookExecutionStatus.FAILED;
    
    return NextResponse.json({
      success: true,
      executionId,
      status: result.status,
      isComplete,
      result,
    });
  } catch (error) {
    console.error("Error checking notebook status:", error);
    return NextResponse.json(
      {
        error: "Failed to check notebook status",
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
