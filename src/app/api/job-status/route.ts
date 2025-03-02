// app/api/job-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { 
  SageMakerClient, 
  DescribeProcessingJobCommand
} from '@aws-sdk/client-sagemaker';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';

// Configure AWS clients with credentials
const sagemakerClient = new SageMakerClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || ''
  }
});

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || ''
  }
});

// S3 bucket for storing notebooks and results
const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'your-notebook-bucket';

export async function GET(request: NextRequest) {
  // Get jobName from query parameter
  const { searchParams } = new URL(request.url);
  const jobName = searchParams.get('jobName');
  
  if (!jobName) {
    return NextResponse.json({ error: 'Job name is required' }, { status: 400 });
  }
  
  try {
    // Get job status
    const describeResponse = await sagemakerClient.send(new DescribeProcessingJobCommand({
      ProcessingJobName: jobName
    }));
    
    const status = describeResponse.ProcessingJobStatus;
    
    // If job is complete or failed, get the output
    let outputs: Array<{key: string | undefined, size: number | undefined, lastModified: Date | undefined}> = [];
    let failureReason = describeResponse.FailureReason || null;
    let logInfo = null;
    
    // Get CloudWatch logs URL for this job if available
    if (describeResponse.ProcessingJobArn) {
      const jobArn = describeResponse.ProcessingJobArn;
      const region = process.env.AWS_REGION || 'us-east-1';
      const accountId = jobArn.split(':')[4];
      const jobName = jobArn.split('/').pop();
      
      logInfo = {
        logGroupName: `/aws/sagemaker/ProcessingJobs`,
        logStreamPrefix: jobName,
        url: `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/$252Faws$252Fsagemaker$252FProcessingJobs/log-events/${jobName}`
      };
    }
    
    if (status === 'Completed' || status === 'Failed') {
      const outputLocation = describeResponse.ProcessingOutputConfig?.Outputs?.[0]?.S3Output?.S3Uri;
      
      if (outputLocation) {
        // Extract the prefix from S3 URI (s3://bucket/prefix)
        const prefix = outputLocation.replace(`s3://${BUCKET_NAME}/`, '');
        
        // List objects in the output location
        const listResponse = await s3Client.send(new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
          Prefix: prefix
        }));
        
        // Map objects to simple format
        outputs = (listResponse.Contents || []).map(item => ({
          key: item.Key,
          size: item.Size,
          lastModified: item.LastModified
        }));
      }
    }
    
    return NextResponse.json({
      jobName,
      status,
      startTime: describeResponse.ProcessingStartTime,
      endTime: describeResponse.ProcessingEndTime,
      outputs,
      outputConfig: describeResponse.ProcessingOutputConfig,
      metrics: {
        instanceType: describeResponse.ProcessingResources?.ClusterConfig?.InstanceType,
        instanceCount: describeResponse.ProcessingResources?.ClusterConfig?.InstanceCount
      }
    });
    
  } catch (error) {
    console.error('Error checking job status:', error);
    
    let errorMessage = 'Failed to check job status';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    
    return NextResponse.json(
      { error: errorMessage }, 
      { status: 500 }
    );
  }
}