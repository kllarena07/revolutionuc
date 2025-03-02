import { NextRequest, NextResponse } from 'next/server';
import { NotebookRunner } from '@/lib/sagemaker/notebook-runner';
import { SageMakerConfig } from '@/lib/sagemaker/types';

// Load configuration from environment variables
const sageMakerConfig: SageMakerConfig = {
  region: process.env.AWS_REGION || 'us-west-2',
  notebookName: process.env.SAGEMAKER_NOTEBOOK_PREFIX || 'notebook-runner',
  instanceType: process.env.SAGEMAKER_INSTANCE_TYPE || 'ml.t2.medium',
  roleArn: process.env.SAGEMAKER_ROLE_ARN || '',
  s3BucketName: process.env.S3_BUCKET_NAME || ''
};

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    
    // Extract the notebook file from the request
    // Expecting: { fileName: "notebook.ipynb", content: "base64EncodedContent" }
    const { fileName, content } = data;
    
    if (!fileName || !content) {
      return NextResponse.json(
        { error: 'Missing required fields: fileName and content' },
        { status: 400 }
      );
    }
    
    // Decode base64 content
    const decodedContent = Buffer.from(content, 'base64');
    
    // Initialize notebook runner
    const runner = new NotebookRunner(sageMakerConfig);
    
    // Run the notebook
    const result = await runner.runNotebook(decodedContent, fileName);
    
    return NextResponse.json({
      success: true,
      message: 'Notebook is running on SageMaker',
      data: result
    });
  } catch (error) {
    console.error('Error processing notebook:', error);
    return NextResponse.json(
      { error: 'Failed to process notebook', details: (error as Error).message },
      { status: 500 }
    );
  }
}

