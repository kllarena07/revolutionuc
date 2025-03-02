#!/bin/bash
set -e

# Install required packages
pip install nbconvert ipykernel matplotlib scikit-learn boto3 awscli

# Set up directories
INPUT_DIR=/opt/ml/processing/input/notebook
OUTPUT_DIR=/opt/ml/processing/output
LOG_DIR=/opt/ml/processing/logs
mkdir -p $OUTPUT_DIR $LOG_DIR

# Set up S3 output path for logs
JOB_ID=$(echo $AWS_SAGEMAKER_PROCESSING_JOB_NAME | cut -d'-' -f3)
S3_LOG_PATH="s3://current-sagemaker-notebooks/logs/${JOB_ID}/execution_log.txt"

# Find the notebook file
NOTEBOOK_FILE=$(find $INPUT_DIR -name "*.ipynb" | head -1)
if [ -z "$NOTEBOOK_FILE" ]; then
  echo "Error: No notebook file found in $INPUT_DIR" | tee -a $LOG_DIR/execution.log
  aws s3 cp $LOG_DIR/execution.log $S3_LOG_PATH
  exit 1
fi

NOTEBOOK_NAME=$(basename "$NOTEBOOK_FILE")
echo "Starting execution of notebook: $NOTEBOOK_NAME" | tee -a $LOG_DIR/execution.log
aws s3 cp $LOG_DIR/execution.log $S3_LOG_PATH

# Function to stream logs to S3
stream_logs() {
  while true; do
    aws s3 cp $LOG_DIR/execution.log $S3_LOG_PATH
    sleep 5
  done
}

# Start log streaming in the background
stream_logs &
STREAM_PID=$!

# Convert and execute the notebook with output capture
echo "Converting notebook to Python script..." | tee -a $LOG_DIR/execution.log
jupyter nbconvert --to script "$NOTEBOOK_FILE" --output /tmp/converted_notebook 2>&1 | tee -a $LOG_DIR/execution.log

echo "Executing notebook..." | tee -a $LOG_DIR/execution.log
{
  python /tmp/converted_notebook.py 2>&1
  EXEC_STATUS=$?
  echo "Notebook execution completed with status: $EXEC_STATUS"
} | tee -a $LOG_DIR/execution.log

# Execute the notebook with papermill to capture outputs
echo "Generating notebook with outputs..." | tee -a $LOG_DIR/execution.log
pip install papermill
papermill "$NOTEBOOK_FILE" "$OUTPUT_DIR/$NOTEBOOK_NAME" -k python3 2>&1 | tee -a $LOG_DIR/execution.log

# Copy final output to S3
echo "Saving executed notebook to S3..." | tee -a $LOG_DIR/execution.log
aws s3 cp "$OUTPUT_DIR/$NOTEBOOK_NAME" "s3://current-sagemaker-notebooks/output/${JOB_ID}/$NOTEBOOK_NAME"

# Final log update
echo "Job completed. Output saved to S3." | tee -a $LOG_DIR/execution.log
aws s3 cp $LOG_DIR/execution.log $S3_LOG_PATH

# Kill the log streaming process
kill $STREAM_PID

exit $EXEC_STATUS

