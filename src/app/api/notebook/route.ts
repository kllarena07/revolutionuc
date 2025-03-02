import { NextRequest, NextResponse } from "next/server";
import { NotebookRunner } from "@/lib/sagemaker/notebook-runner";
import { SageMakerConfig } from "@/lib/sagemaker/types";

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

    // Get file name
    const fileName = uploadedFile.name;

    // Get file content as ArrayBuffer and convert to Buffer
    const fileArrayBuffer = await uploadedFile.arrayBuffer();
    const fileBuffer = Buffer.from(fileArrayBuffer);

    // Initialize notebook runner
    const runner = new NotebookRunner(sageMakerConfig);

    // Run the notebook
    const result = await runner.runNotebook(fileBuffer, fileName);

    return NextResponse.json({
      success: true,
      message: "Notebook is running on SageMaker",
      data: result,
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
