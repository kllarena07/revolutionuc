export interface SageMakerConfig {
  region: string;
  notebookName: string;
  instanceType: string;
  roleArn: string;
  s3BucketName: string;
  outputBucketName?: string; // Optional bucket for execution results
}

export interface NotebookRunResult {
  notebookUrl: string;
  instanceName: string;
  s3Path: string;
  executionId?: string; // Added to track execution
  status?: NotebookExecutionStatus;
}

// Execution status tracking
export enum NotebookExecutionStatus {
  PENDING = "PENDING",
  RUNNING = "RUNNING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

// Execution results
export interface NotebookExecutionResult {
  executionId: string;
  status: NotebookExecutionStatus;
  outputs: NotebookCellOutput[];
  errorMessage?: string;
  errorDetail?: {
    cellIndex: number;
    cellSource: string;
    errorType: string;
    errorMessage: string;
  }; // More detailed error information
  stackTrace?: string; // Full stack trace for errors
  cellErrorOutput?: Array<{
    ename: string;
    evalue: string;
    traceback: string[];
  }>; // Captured output from the failing cell
  systemInfo?: { // System information at the time of failure
    pythonVersion?: string;
    osVersion?: string;
    memoryUsage?: string;
    diskSpace?: string;
    [key: string]: any; // Allow for other system info properties
  };
  startTime: Date;
  endTime?: Date;
  notebookPath: string; // S3 path to the input notebook
  outputPath: string; // S3 path to the executed notebook output
  cellsTotal?: number; // Total number of cells in the notebook
  cellsCompleted?: number; // Number of cells that have been executed
  progress?: number; // Percentage of completion (0-100)
  currentCell?: {
    index: number;
    source: string;
  }; // Information about the currently executing cell
  isInstanceShutdown?: boolean; // Indicates if the instance was automatically shut down
  shutdownReason?: string; // Reason for instance shutdown (e.g., 'cell_failure', 'execution_error', 'user_requested')
  shutdownTime?: Date; // Timestamp when the instance was shut down
}

// Cell output structure
export interface NotebookCellOutput {
  cellIndex: number;
  outputType: string; // 'text', 'image', 'error', etc.
  data: any; // Could be string, base64 image data, etc.
}

// Lifecycle configuration options
export interface LifecycleConfigOptions {
  configName: string;
  onStartScript: string;
}
