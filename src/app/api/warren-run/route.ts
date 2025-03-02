// app/api/warren-run/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { 
  SageMakerClient, 
  CreateProcessingJobCommand
} from '@aws-sdk/client-sagemaker';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

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

// S3 bucket for storing notebooks and results
const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'current-sagemaker-notebooks';
const SAGEMAKER_ROLE_ARN = process.env.SAGEMAKER_ROLE_ARN || '';

export async function POST(request: NextRequest) {
  try {
    // Parse form data
    const formData = await request.formData();
    const notebookFile = formData.get('notebook') as File;
    
    if (!notebookFile || !notebookFile.name.endsWith('.ipynb')) {
      return NextResponse.json({ error: 'Invalid notebook file' }, { status: 400 });
    }

    // Generate a unique ID for this job
    const jobId = randomUUID().substring(0, 8);
    const notebookKey = `notebooks/${jobId}/${notebookFile.name}`;
    const outputKey = `output/${jobId}/`;
    const scriptKey = `scripts/${jobId}/run_notebook.py`;
    
    // Read the file content
    const fileBuffer = await notebookFile.arrayBuffer();
    
    // Upload notebook to S3
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: notebookKey,
      Body: Buffer.from(fileBuffer),
      ContentType: 'application/x-ipynb+json'
    }));
    
    // Upload the execution script to S3
    const scriptPath = path.join(process.cwd(), 'src/app/api/warren-run/script.txt');
    const scriptContent = fs.readFileSync(scriptPath, 'utf8');
    
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: scriptKey,
      Body: scriptContent,
      ContentType: 'text/plain'
    }));
    
    console.log(`Uploaded notebook to s3://${BUCKET_NAME}/${notebookKey}`);
    console.log(`Uploaded script to s3://${BUCKET_NAME}/${scriptKey}`);
    
    // Create a processing job
    const processingJobName = `notebook-job-${jobId}`;
    
    await sagemakerClient.send(new CreateProcessingJobCommand({
      ProcessingJobName: processingJobName,
      RoleArn: SAGEMAKER_ROLE_ARN,
      ProcessingInputs: [
        {
          InputName: 'notebook',
          S3Input: {
            S3Uri: `s3://${BUCKET_NAME}/${notebookKey}`,
            LocalPath: '/opt/ml/processing/input/notebook',
            S3DataType: 'S3Prefix',
            S3InputMode: 'File'
          }
        }
      ],
      ProcessingOutputConfig: {
        Outputs: [
          {
            OutputName: 'output',
            S3Output: {
              S3Uri: `s3://${BUCKET_NAME}/${outputKey}`,
              LocalPath: '/opt/ml/processing/output',
              S3UploadMode: 'EndOfJob'
            }
          }
        ]
      },
      ProcessingResources: {
        ClusterConfig: {
          InstanceCount: 1,
          InstanceType: process.env.SAGEMAKER_INSTANCE_TYPE as any || 'ml.t3.medium',
          VolumeSizeInGB: 5
        }
      },
      StoppingCondition: {
        MaxRuntimeInSeconds: 900 // 15 minutes
      },
      AppSpecification: {
        ImageUri: `763104351884.dkr.ecr.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/tensorflow-training:2.11.0-cpu-py39-ubuntu20.04-sagemaker`,
        ContainerEntrypoint: [
          "bash", "-c",
          "pip install nbconvert ipykernel matplotlib scikit-learn && aws s3 cp s3://" + BUCKET_NAME + "/" + scriptKey + " /tmp/run_notebook.py && python /tmp/run_notebook.py"
        ]
      },
      NetworkConfig: {
        EnableNetworkIsolation: false
      },
      Environment: {
        'BUCKET_NAME': BUCKET_NAME,
        'notebookKey': notebookKey
      }
    }));
    
    // Return the job info
    return NextResponse.json({
      jobId,
      jobName: processingJobName,
      status: 'processing',
      outputLocation: `s3://${BUCKET_NAME}/${outputKey}`,
      message: 'Notebook job submitted to SageMaker'
    });
    
  } catch (error) {
    console.error('Error processing notebook:', error);
    let errorMessage = 'Failed to process notebook';
    
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    
    return NextResponse.json(
      { 
        error: errorMessage,
        suggestion: 'Check your AWS credentials and roles'
      }, 
      { status: 500 }
    );
  }
}