export interface SageMakerConfig {
  region: string;
  notebookName: string;
  instanceType: string;
  roleArn: string;
  s3BucketName: string;
}

export interface NotebookRunResult {
  notebookUrl: string;
  instanceName: string;
  s3Path: string;
}

