import { NextRequest, NextResponse } from 'next/server';
import { S3Service } from '@/lib/sagemaker/s3-service';
import { SageMakerService } from '@/lib/sagemaker/sagemaker-service';
import { NotebookExecutionStatus } from '@/lib/sagemaker/types';

export async function GET(request: NextRequest) {
  // Parse the URL to get the executionId
  const searchParams = request.nextUrl.searchParams;
  const executionId = searchParams.get('executionId');

  if (!executionId) {
    return NextResponse.json(
      { error: 'Missing executionId parameter' },
      { status: 400 }
    );
  }

  try {
    // Initialize services
    const region = process.env.AWS_REGION || 'us-west-2';
    const s3BucketName = process.env.S3_BUCKET_NAME!;
    
    const sagemakerService = new SageMakerService({
      region,
      s3BucketName,
      outputBucketName: process.env.S3_OUTPUT_BUCKET_NAME || s3BucketName,
      roleArn: process.env.SAGEMAKER_ROLE_ARN!,
      instanceType: process.env.SAGEMAKER_INSTANCE_TYPE || 'ml.t3.medium',
    });
    
    const s3Service = new S3Service(region, s3BucketName);

    // Get execution status
    const executionResult = await sagemakerService.getNotebookExecutionStatus(executionId);

    if (!executionResult) {
      return NextResponse.json(
        { error: 'Execution not found' },
        { status: 404 }
      );
    }

    // Check if execution is completed
    if (executionResult.status !== NotebookExecutionStatus.COMPLETED) {
      return NextResponse.json(
        { 
          error: 'Notebook execution is not completed yet',
          status: executionResult.status 
        },
        { status: 400 }
      );
    }

    // Check if outputPath exists in the result
    if (!executionResult.outputPath) {
      return NextResponse.json(
        { error: 'Output path not found in execution result' },
        { status: 404 }
      );
    }

    // Extract the S3 key from the outputPath
    // The outputPath is expected to be something like:
    // executions/{executionId}/output-notebook.ipynb or a full S3 URI
    let s3Key = executionResult.outputPath;

    // If it's a full S3 URI, extract just the key part
    if (s3Key.startsWith('s3://')) {
      const parts = s3Key.replace('s3://', '').split('/');
      // Remove the bucket name from the path
      parts.shift();
      s3Key = parts.join('/');
    }

    // Download the file from S3
    const fileContent = await s3Service.downloadFile(s3Key);

    // Return the file as a downloadable response
    const filename = `notebook-${executionId}.ipynb`;
    return new NextResponse(fileContent, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error downloading notebook:', error);
    return NextResponse.json(
      { error: 'Failed to download notebook' },
      { status: 500 }
    );
  }
}

