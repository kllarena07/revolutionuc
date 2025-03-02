import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { LifecycleConfigOptions } from "./types";

// Extract the Python script content to be uploaded separately
export const notebookExecutionScript = `import sys
import os
import json
import time
import datetime
import traceback
import platform
import subprocess
import boto3
import nbformat
from papermill.execute import papermill
from papermill.engines import NBClientEngine
from nbclient import NotebookClient
from nbclient.exceptions import CellExecutionError

def iso_time():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

def get_system_info():
    """Collect system information for debugging purposes"""
    return {
        "platform": platform.platform(),
        "python_version": platform.python_version(),
        "processor": platform.processor(),
        "memory": os.popen("free -h").read().strip() if os.name == "posix" else "N/A",
        "disk_space": os.popen("df -h").read().strip() if os.name == "posix" else "N/A",
        "environment_variables": {k: v for k, v in os.environ.items() if not k.startswith("AWS_") and not "SECRET" in k.upper() and not "KEY" in k.upper()}
    }

def create_shutdown_marker(bucket, execution_id, reason="Notebook execution failed"):
    """
    Create a shutdown marker file in S3 to indicate the reason for shutdown
    """
    try:
        shutdown_time = iso_time()
        marker_content = {
            "reason": reason,
            "timestamp": shutdown_time,
            "executionId": execution_id
        }
        
        s3 = boto3.client('s3')
        s3.put_object(
            Bucket=bucket,
            Key=f"executions/{execution_id}/shutdown_marker.json",
            Body=json.dumps(marker_content, indent=4),
            ContentType='application/json'
        )
        print(f"Created shutdown marker in S3: executions/{execution_id}/shutdown_marker.json")
        
        # Also create a local file for the shell script to find
        with open("shutdown_reason.txt", "w") as f:
            f.write(f"{reason} at {shutdown_time}")
            
        return True
    except Exception as e:
        print(f"Error creating shutdown marker: {str(e)}")
        print(traceback.format_exc())
        return False

def initiate_instance_shutdown(bucket=None, execution_id=None, reason="Notebook execution failed"):
    """
    Initiate shutdown of the SageMaker notebook instance
    Uses the SageMaker API to request instance shutdown
    """
    try:
        # Create shutdown marker if bucket and execution_id provided
        if bucket and execution_id:
            create_shutdown_marker(bucket, execution_id, reason)
            # Wait to ensure S3 operations complete
            time.sleep(5)
        
        # Get the instance name from environment variable
        instance_name = os.environ.get('NOTEBOOK_INSTANCE_NAME')
        if not instance_name:
            # If env var not set, try to get from instance metadata
            response = subprocess.check_output(['curl', '-s', 'http://169.254.169.254/latest/meta-data/instance-id'])
            instance_name = response.decode('utf-8')
            
        if instance_name:
            print(f"Initiating shutdown of notebook instance: {instance_name}")
            sm_client = boto3.client('sagemaker')
            sm_client.stop_notebook_instance(NotebookInstanceName=instance_name)
            return True
        else:
            print("Failed to determine instance name, cannot initiate shutdown")
            return False
    except Exception as e:
        print(f"Error initiating instance shutdown: {str(e)}")
        print(traceback.format_exc())
        return False

def extract_cell_error_output(cell):
    """Extract error output from a cell for better error reporting"""
    if not hasattr(cell, 'outputs'):
        return None
    
    error_outputs = []
    for output in cell.outputs:
        if output.output_type == 'error':
            error_outputs.append({
                'ename': output.get('ename', ''),
                'evalue': output.get('evalue', ''),
                'traceback': output.get('traceback', [])
            })
        elif output.output_type == 'stream' and output.get('name') == 'stderr':
            error_outputs.append({
                'stderr': output.get('text', '')
            })
    
    return error_outputs if error_outputs else None

def update_status(bucket, key, notebook_path, output_path, execution_id, nb, 
                 status="RUNNING", error_message=None, error_detail=None, traceback_str=None, 
                 current_cell_idx=None, cell_error_output=None):
    # Count total code cells
    total_cells = sum(1 for cell in nb.cells if cell.cell_type == 'code')
    
    # Count completed cells
    completed_cells = 0
    for idx, cell in enumerate(nb.cells):
        if cell.cell_type == 'code' and 'execution_count' in cell and cell.execution_count is not None:
            completed_cells += 1
    
    # Calculate progress
    progress = 0 if total_cells == 0 else int(100 * completed_cells / total_cells)
    
    # Create status object
    status_obj = {
        "executionId": execution_id,
        "status": status,
        "startTime": start_time,
        "notebookPath": notebook_path,
        "expectedOutputPath": output_path,
        "cellsTotal": total_cells,
        "cellsCompleted": completed_cells,
        "progress": progress
    }
    
    if status == "COMPLETED" or status == "FAILED":
        status_obj["endTime"] = iso_time()
        
    if current_cell_idx is not None:
        current_cell = nb.cells[current_cell_idx] if current_cell_idx < len(nb.cells) else None
        if current_cell and current_cell.cell_type == 'code':
            status_obj["currentCell"] = {
                "index": current_cell_idx,
                "source": current_cell.source[:500] + ("..." if len(current_cell.source) > 500 else "")
            }
    
    if error_message:
        status_obj["errorMessage"] = error_message
    
    if error_detail:
        status_obj["errorDetail"] = error_detail
        
    if traceback_str:
        status_obj["stackTrace"] = traceback_str
    
    if cell_error_output:
        status_obj["cellErrorOutput"] = cell_error_output
        
    # Add system info on failure for troubleshooting
    if status == "FAILED":
        status_obj["systemInfo"] = get_system_info()
    
    # Upload status to S3
    s3 = boto3.client('s3')
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=json.dumps(status_obj, indent=4),
        ContentType='application/json'
    )
    
    return status_obj

class CellTrackingClient(NotebookClient):
    def __init__(self, nb, s3_bucket, s3_key, notebook_path, output_path, execution_id, **kwargs):
        super().__init__(nb, **kwargs)
        self.s3_bucket = s3_bucket
        self.s3_key = s3_key
        self.notebook_path = notebook_path
        self.output_path = output_path
        self.execution_id = execution_id
        
    def execute_cell(self, cell, cell_index, **kwargs):
        # Update status with current cell before execution
        update_status(
            self.s3_bucket, 
            self.s3_key, 
            self.notebook_path,
            self.output_path,
            self.execution_id,
            self.nb,
            current_cell_idx=cell_index
        )
        
        # Execute the cell
        try:
            result = super().execute_cell(cell, cell_index, **kwargs)
            
            # Update status after successful execution
            update_status(
                self.s3_bucket, 
                self.s3_key, 
                self.notebook_path,
                self.output_path,
                self.execution_id,
                self.nb,
                current_cell_idx=cell_index
            )
            
            return result
            
        except CellExecutionError as e:
            # Get detailed error information
            error_traceback = traceback.format_exc()
            cell_error = extract_cell_error_output(cell)
            
            # Capture detailed error information
            error_detail = {
                "cellIndex": cell_index,
                "cellSource": cell.source,
                "errorType": type(e).__name__,
                "errorMessage": str(e)
            }
            
            # Update status with comprehensive error details
            update_status(
                self.s3_bucket, 
                self.s3_key, 
                self.notebook_path,
                self.output_path,
                self.execution_id,
                self.nb,
                status="FAILED",
                error_message=str(e),
                error_detail=error_detail,
                traceback_str=error_traceback,
                current_cell_idx=cell_index,
                cell_error_output=cell_error
            )
            
            # Save the partially executed notebook to allow debugging
            try:
                nbformat.write(self.nb, f"partial_{self.execution_id}.ipynb")
                s3 = boto3.client('s3')
                s3.upload_file(
                    f"partial_{self.execution_id}.ipynb", 
                    self.s3_bucket, 
                    f"executions/{self.execution_id}/partial_{os.path.basename(self.output_path)}"
                )
            except Exception as save_error:
                print(f"Failed to save partial notebook: {save_error}")
            
            # Initiate instance shutdown after ensuring all logs are saved
            print("Detected cell execution failure. Preparing to shut down the instance...")
            # Create shutdown marker and initiate shutdown
            initiate_instance_shutdown(
                self.s3_bucket, 
                self.execution_id, 
                f"Cell execution failed at index {cell_index}"
            )
            
            raise

class CellTrackingEngine(NBClientEngine):
    def __init__(self, s3_bucket, s3_key, notebook_path, output_path, execution_id):
        self.s3_bucket = s3_bucket
        self.s3_key = s3_key
        self.notebook_path = notebook_path
        self.output_path = output_path
        self.execution_id = execution_id
        
    def execute_notebook(self, nb, **kwargs):
        kwargs['progress_bar'] = False  # Disable progress bar since we're tracking our own progress
        client = CellTrackingClient(
            nb, 
            self.s3_bucket, 
            self.s3_key, 
            self.notebook_path,
            self.output_path,
            self.execution_id,
            **kwargs
        )
        return client.execute()

if __name__ == "__main__":
    # Parse arguments
    input_notebook = sys.argv[1]
    output_notebook = sys.argv[2]
    execution_id = sys.argv[3]
    s3_bucket = sys.argv[4]
    s3_key = sys.argv[5]
    notebook_path = sys.argv[6]
    output_path = sys.argv[7]
    
    # Set global start time
    start_time = iso_time()
    
    # Read the notebook
    nb = nbformat.read(input_notebook, as_version=4)
    
    # Update initial status with total cells count
    update_status(s3_bucket, s3_key, notebook_path, output_path, execution_id, nb)
    
    try:
        # Execute the notebook with our custom engine
        engine = CellTrackingEngine(s3_bucket, s3_key, notebook_path, output_path, execution_id)
        nb = engine.execute_notebook(
            nb, 
            input_path=input_notebook,
            output_path=output_notebook,
            parameters={"execution_id": execution_id}
        )
        
        # Final status update
        update_status(s3_bucket, s3_key, notebook_path, output_path, execution_id, nb, status="COMPLETED")
        print("Notebook execution completed successfully")
        sys.exit(0)
        
    except Exception as e:
        # Get the traceback
        error_traceback = traceback.format_exc()
        
        # Create detailed error information
        error_detail = {
            "errorType": type(e).__name__,
            "errorMessage": str(e),
            "executionEnv": {
                "cwd": os.getcwd(),
                "user": os.getenv("USER", "unknown"),
                "path": os.getenv("PATH", "")
            }
        }
        
        # Check if we can determine the current cell
        current_cell_idx = None
        cell_error_output = None
        for idx, cell in enumerate(nb.cells):
            if cell.cell_type == 'code' and hasattr(cell, 'execution_count') and cell.execution_count is None:
                current_cell_idx = idx
                cell_error_output = extract_cell_error_output(cell)
                break
        
        # Update status with comprehensive error information
        update_status(
            s3_bucket, 
            s3_key, 
            notebook_path,
            output_path,
            execution_id,
            nb,
            status="FAILED", 
            error_message=str(e),
            error_detail=error_detail,
            traceback_str=error_traceback,
            current_cell_idx=current_cell_idx,
            cell_error_output=cell_error_output
        )
        
        # Save the partially executed notebook to aid debugging
        try:
            nbformat.write(nb, f"partial_{execution_id}.ipynb")
            s3 = boto3.client('s3')
            s3.upload_file(
                f"partial_{execution_id}.ipynb",
                s3_bucket,
                f"executions/{execution_id}/partial_execution.ipynb"
            )
            print(f"Saved partial notebook execution to s3://{s3_bucket}/executions/{execution_id}/partial_execution.ipynb")
        except Exception as save_error:
            print(f"Failed to save partial notebook: {save_error}")
            
        print(f"Notebook execution failed: {str(e)}")
        print(f"Stack trace: {error_traceback}")
        
        # Initiate instance shutdown after ensuring all logs are saved
        print("Detected notebook execution failure. Preparing to shut down the instance...")
        # Create shutdown marker and initiate shutdown
        shutdown_success = initiate_instance_shutdown(
            s3_bucket, 
            execution_id, 
            f"Notebook execution failed: {str(e)[:200]}"
        )
        print(f"Instance shutdown {'initiated' if shutdown_success else 'failed'}")
        sys.exit(1)
`;

/**
 * Function to upload the Python script to S3
 * @param outputS3Bucket The S3 bucket to upload the script to
 * @param executionId Unique identifier for the execution
 * @returns The S3 path where the script was uploaded
 */
export async function uploadExecutionScriptToS3(
  outputS3Bucket: string,
  executionId: string
): Promise<string> {
  // This function would use AWS SDK to upload the script to S3
  // Here's a placeholder for how it might look
  const credentials = {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  };

  const s3 = new S3Client({
    region: "us-east-1",
    credentials,
  });
  const scriptKey = `executions/${executionId}/execute_notebook_with_tracking.py`;

  await s3.send(
    new PutObjectCommand({
      Bucket: outputS3Bucket,
      Key: scriptKey,
      Body: notebookExecutionScript,
      ContentType: "text/plain",
    })
  );

  return `s3://${outputS3Bucket}/${scriptKey}`;
}

/**
 * Create a shell script that will be executed when the notebook instance starts
 * This script will:
 * 1. Download the notebook from S3
 * 2. Download the execution script from S3
 * 3. Execute the notebook using the script
 * 4. Upload the results back to S3
 */
export function createAutoExecuteNotebookScript(
  s3Path: string,
  outputS3Bucket: string,
  executionId: string
): string {
  // Parse bucket name and key from s3Path (format: s3://bucket-name/key)
  const s3Uri = new URL(s3Path);
  const bucket = s3Uri.hostname;
  const key = s3Uri.pathname.slice(1); // Remove the leading "/"

  // Define consistent output paths
  const outputDir = `executions/${executionId}`;
  // Extract file name from the key
  const fileName = key.split("/").pop() || "notebook.ipynb";
  const executedFileName = `executed-${fileName}`;
  const outputKey = `${outputDir}/${executedFileName}`;
  const statusKey = `${outputDir}/status.json`;
  const outputPath = `s3://${outputS3Bucket}/${outputKey}`;

  // Define the path to the execution script in S3
  const scriptKey = `${outputDir}/execute_notebook_with_tracking.py`;
  const scriptS3Path = `s3://${outputS3Bucket}/${scriptKey}`;

  return `#!/bin/bash
set -e

# Create working directories
mkdir -p /home/ec2-user/SageMaker/notebooks
mkdir -p /home/ec2-user/SageMaker/outputs

# Log startup
echo "Starting notebook auto-execution for ${executionId}"
echo "Downloading notebook from s3://${bucket}/${key}"

# Update status to running
aws s3 cp - s3://${outputS3Bucket}/${statusKey} <<EOL
{
    "executionId": "${executionId}",
    "status": "RUNNING",
    "startTime": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
    "notebookPath": "s3://${bucket}/${key}",
    "expectedOutputPath": "${outputPath}",
    "cellsTotal": 0,
    "cellsCompleted": 0,
    "currentCell": null,
    "progress": 0
}
EOL

# Download the notebook from S3
aws s3 cp s3://${bucket}/${key} /home/ec2-user/SageMaker/notebooks/${fileName}

# Install any additional dependencies
pip install -q papermill nbformat boto3 --upgrade

cd /home/ec2-user/SageMaker/notebooks

# Download the execution script from S3
echo "Downloading execution script from ${scriptS3Path}"
aws s3 cp ${scriptS3Path} execute_notebook_with_tracking.py

# Execute the notebook using our downloaded tracking script
echo "Executing notebook with cell-by-cell tracking..."
# Capture all output to a log file as well
# Pass instance name as environment variable to the Python script
export NOTEBOOK_INSTANCE_NAME=$(grep -oP '(?<=instance_name\s=\s).*(?=;)' /etc/profile.d/sagemaker-notebook-container-profile.sh | tr -d '"')
python execute_notebook_with_tracking.py ${fileName} ${executedFileName} ${executionId} ${outputS3Bucket} ${statusKey} s3://${bucket}/${key} ${outputPath} 2>&1 | tee execution.log || EXECUTION_FAILED=true

# Upload execution logs to S3 for debugging
aws s3 cp execution.log s3://${outputS3Bucket}/executions/${executionId}/execution.log

# Upload results - status is already updated by the Python script
if [ -z "$EXECUTION_FAILED" ]; then
    # Upload the executed notebook to S3 if it wasn't already uploaded
    aws s3 cp ${executedFileName} s3://${outputS3Bucket}/${outputKey}
else
    # Upload any partial notebooks that might have been saved
    if [ -f "partial_${executionId}.ipynb" ]; then
        aws s3 cp partial_${executionId}.ipynb s3://${outputS3Bucket}/executions/${executionId}/partial_execution.ipynb
    fi
    # Upload the original error output
    if [ -f "execution.log" ]; then
        aws s3 cp execution.log s3://${outputS3Bucket}/executions/${executionId}/execution.log
    fi
    
    # Check if shutdown_reason.txt was created by the Python script
    if [ ! -f "shutdown_reason.txt" ]; then
        # Create a shutdown marker file to indicate the reason for shutdown (fallback)
        echo "Notebook execution failed at $(date -u +"%Y-%m-%dT%H:%M:%SZ")" > shutdown_reason.txt
        aws s3 cp shutdown_reason.txt s3://${outputS3Bucket}/executions/${executionId}/shutdown_reason.txt
    else
        # Upload the shutdown_reason.txt file created by the Python script
        aws s3 cp shutdown_reason.txt s3://${outputS3Bucket}/executions/${executionId}/shutdown_reason.txt
    fi
    
    # Wait to ensure all S3 uploads are complete before the instance is shut down
    echo "Waiting for S3 operations to complete before instance shutdown..."
    # Use a more robust wait with retry for S3 operations
    MAX_RETRIES=5
    for i in $(seq 1 $MAX_RETRIES); do
        if aws s3 ls s3://${outputS3Bucket}/executions/${executionId}/shutdown_reason.txt &>/dev/null; then
            echo "Confirmed shutdown marker file is in S3."
            break
        fi
        echo "Waiting for S3 operations to complete (attempt $i of $MAX_RETRIES)..."
        sleep 5
    done
fi

echo "Notebook execution completed"
`;
}

/**
 * Create a lifecycle configuration object for SageMaker
 * Also ensures the Python script is uploaded to S3 first
 */
export async function createNotebookLifecycleConfig(
  s3Path: string,
  outputS3Bucket: string,
  executionId: string
): Promise<LifecycleConfigOptions> {
  // First, upload the Python script to S3
  await uploadExecutionScriptToS3(outputS3Bucket, executionId);

  // Then create the lifecycle config with the shell script
  const script = createAutoExecuteNotebookScript(
    s3Path,
    outputS3Bucket,
    executionId
  );

  return {
    configName: `auto-exec-${executionId}`,
    onStartScript: script,
  };
}
