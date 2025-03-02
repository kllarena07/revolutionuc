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
    const { instanceName } = data;
    
    if (!instanceName) {
      return NextResponse.json(
        { error: 'Missing required field: instanceName' },
        { status: 400 }
      );
    }
    
    // Initialize notebook runner
    const runner = new NotebookRunner(sageMakerConfig);
    
    // Clean up resources
    await runner.cleanupResources(instanceName);
    
    return NextResponse.json({
      success: true,
      message: `SageMaker instance ${instanceName} deletion has been initiated`
    });
  } catch (error) {
    console.error('Error cleaning up resources:', error);
    return NextResponse.json(
      { error: 'Failed to clean up resources', details: (error as Error).message },
      { status: 500 }
    );
  }
}

