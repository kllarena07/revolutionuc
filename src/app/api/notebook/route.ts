// app/api/run-notebook/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { 
  SageMakerClient, 
  CreateNotebookInstanceCommand,
  StartNotebookInstanceCommand,
  CreatePresignedNotebookInstanceUrlCommand,
  DescribeNotebookInstanceCommand
} from '@aws-sdk/client-sagemaker';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

// Configure AWS clients
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || ''
  }
});

const sagemakerClient = new SageMakerClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || ''
  }
});

// S3 bucket for storing notebooks
const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'current-sagemaker-notebooks';

export async function POST(request: NextRequest) {
  try {
    // Parse form data
    const formData = await request.formData();
    const notebookFile = formData.get('notebook') as File;
    
    if (!notebookFile || !notebookFile.name.endsWith('.ipynb')) {
      return NextResponse.json({ error: 'Invalid notebook file' }, { status: 400 });
    }

    // Generate a unique ID for this notebook execution
    const executionId = randomUUID();
    const notebookKey = `notebooks/${executionId}/${notebookFile.name}`;
    
    // Read the file content as an ArrayBuffer
    const fileBuffer = await notebookFile.arrayBuffer();
    
    // Upload notebook to S3
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: notebookKey,
      Body: Buffer.from(fileBuffer),
      ContentType: 'application/x-ipynb+json'
    }));
    
    // Create a SageMaker notebook instance
    const notebookInstanceName = `notebook-execution-${executionId}`;
    
    await sagemakerClient.send(new CreateNotebookInstanceCommand({
      NotebookInstanceName: notebookInstanceName,
      InstanceType: 'ml.t2.medium', // Adjust according to your needs
      RoleArn: process.env.SAGEMAKER_ROLE_ARN,
      DefaultCodeRepository: `s3://${BUCKET_NAME}/notebooks/${executionId}`,
      DirectInternetAccess: 'Enabled',
      RootAccess: 'Enabled'
    }));
    
    // Wait for the notebook instance to be in 'InService' state
    let status = 'Creating';
    while (status !== 'InService') {
      await new Promise(resolve => setTimeout(resolve, 10000)); // Poll every 10s
      
      const describeResponse = await sagemakerClient.send(new DescribeNotebookInstanceCommand({
        NotebookInstanceName: notebookInstanceName
      }));
      
      status = describeResponse.NotebookInstanceStatus || 'Unknown';
      
      if (status === 'Failed') {
        return NextResponse.json(
          { error: 'Failed to create notebook instance' }, 
          { status: 500 }
        );
      }
    }
    
    // Start the notebook instance
    await sagemakerClient.send(new StartNotebookInstanceCommand({
      NotebookInstanceName: notebookInstanceName
    }));
    
    // Get a pre-signed URL to access the notebook
    const urlResponse = await sagemakerClient.send(new CreatePresignedNotebookInstanceUrlCommand({
      NotebookInstanceName: notebookInstanceName
    }));
    
    // Return the notebook execution details
    return NextResponse.json({
      executionId,
      notebookUrl: urlResponse.AuthorizedUrl,
      status: 'running',
      message: 'Notebook uploaded and running on SageMaker'
    });
    
  } catch (error) {
    console.error('Error processing notebook:', error);
    return NextResponse.json(
      { error: 'Failed to process notebook' }, 
      { status: 500 }
    );
  }
}