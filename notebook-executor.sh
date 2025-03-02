#!/bin/bash
set -e

# Configuration
S3_BUCKET=${S3_BUCKET:-"current-sagemaker-notebooks"}
JOB_ID=${JOB_ID:-$(date +%s)}
OUTPUT_S3_PATH="s3://${S3_BUCKET}/outputs/${JOB_ID}/output.log"
UPDATE_INTERVAL=2  # seconds between output updates

# Install required dependencies
echo "Installing dependencies..."
pip install nbconvert ipykernel matplotlib scikit-learn boto3 awscli

# Set up directories
OUTPUT_DIR="/opt/ml/processing/output"
NOTEBOOK_DIR="/opt/ml/processing/input/notebook"
LOG_FILE="/tmp/notebook_output.log"
mkdir -p $OUTPUT_DIR

# Empty the output file in S3 first
echo "Initializing output log in S3..."
echo "" | aws s3 cp - ${OUTPUT_S3_PATH}

# Find the notebook file
NOTEBOOK_FILE=$(find $NOTEBOOK_DIR -name "*.ipynb" | head -1)
if [ -z "$NOTEBOOK_FILE" ]; then
  echo "Error: No notebook file found in $NOTEBOOK_DIR"
  exit 1
fi

echo "Using notebook file: $NOTEBOOK_FILE"

# Function to append log to S3
update_s3_log() {
  if [ -s "$LOG_FILE" ]; then
    aws s3 cp "$LOG_FILE" "${OUTPUT_S3_PATH}" --no-progress
    echo "Updated output log in S3 at $(date)"
  fi
}

# Set up trap to update S3 on exit
trap update_s3_log EXIT

# Convert notebook to Python script
echo "Converting notebook to Python script..."
jupyter nbconvert --to script "$NOTEBOOK_FILE" --output /tmp/converted_notebook
SCRIPT_FILE="/tmp/converted_notebook.py"

# Start background process to periodically update S3
(
  while true; do
    sleep ${UPDATE_INTERVAL}
    update_s3_log
  done
) &
UPDATER_PID=$!

# Execute the converted script with output capture
echo "Executing notebook..." | tee -a "$LOG_FILE"
{
  PYTHONUNBUFFERED=1 python "$SCRIPT_FILE" 2>&1 
  echo "Notebook execution completed with exit code $?" 
} | tee -a "$LOG_FILE"

# Kill the background updater
kill $UPDATER_PID

# Final update to S3
update_s3_log

echo "Execution complete. Full output available at: ${OUTPUT_S3_PATH}"

