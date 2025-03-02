import { 
  SageMakerClient, 
  CreateNotebookInstanceCommand,
  StartNotebookInstanceCommand,
  CreatePresignedNotebookInstanceUrlCommand,
  DescribeNotebookInstanceCommand,
  DeleteNotebookInstanceCommand
} from '@aws-sdk/client-sagemaker';
import { SageMakerConfig } from './types';

export class SageMakerService {
  private client: SageMakerClient;
  private config: SageMakerConfig;

  constructor(config: SageMakerConfig) {
    this.client = new SageMakerClient({ region: config.region });
    this.config = config;
  }

  async createNotebookInstance(notebookName: string): Promise<void> {
    await this.client.send(
      new CreateNotebookInstanceCommand({
        NotebookInstanceName: notebookName,
        InstanceType: this.config.instanceType,
        RoleArn: this.config.roleArn,
        DefaultCodeRepository: `s3://${this.config.s3BucketName}`,
        DirectInternetAccess: 'Enabled'
      })
    );
    
    // Wait for the notebook instance to be in 'InService' state
    let status = '';
    do {
      const response = await this.client.send(
        new DescribeNotebookInstanceCommand({
          NotebookInstanceName: notebookName
        })
      );
      
      status = response.NotebookInstanceStatus || '';
      
      if (status === 'Failed') {
        throw new Error('Notebook instance creation failed');
      }
      
      if (status !== 'InService') {
        // Wait 15 seconds before checking again
        await new Promise(resolve => setTimeout(resolve, 15000));
      }
    } while (status !== 'InService');
    
    // Start the notebook instance
    await this.client.send(
      new StartNotebookInstanceCommand({
        NotebookInstanceName: notebookName
      })
    );
  }

  async getNotebookUrl(notebookName: string): Promise<string> {
    const response = await this.client.send(
      new CreatePresignedNotebookInstanceUrlCommand({
        NotebookInstanceName: notebookName
      })
    );
    
    return response.AuthorizedUrl || '';
  }

  async deleteNotebookInstance(notebookName: string): Promise<void> {
    await this.client.send(
      new DeleteNotebookInstanceCommand({
        NotebookInstanceName: notebookName
      })
    );
  }
}

