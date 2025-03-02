'use client';

import { useState, useEffect } from 'react';

export default function NotebookUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [statusInterval, setStatusInterval] = useState<NodeJS.Timeout | null>(null);

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (statusInterval) {
        clearInterval(statusInterval);
      }
    };
  }, [statusInterval]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      if (selectedFile.name.endsWith('.ipynb')) {
        setFile(selectedFile);
        setError(null);
      } else {
        setFile(null);
        setError('Please select a valid Jupyter notebook (.ipynb) file');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!file) {
      setError('Please select a notebook file first');
      return;
    }
    
    setLoading(true);
    setError(null);
    setResult(null);
    setJobStatus(null);
    
    try {
      const formData = new FormData();
      formData.append('notebook', file);
      
      const response = await fetch('/api/warren-run', {
        method: 'POST',
        body: formData,
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload notebook');
      }
      
      setResult(data);
      setJobStatus(data.status);
      
      // Start polling for job status
      if (data.jobName) {
        const interval = setInterval(async () => {
          await checkJobStatus(data.jobName);
        }, 10000); // Check every 10 seconds
        
        setStatusInterval(interval);
      }
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  const checkJobStatus = async (jobName: string) => {
    if (!jobName || checkingStatus) return;
    
    setCheckingStatus(true);
    
    try {
      const response = await fetch(`/api/job-status?jobName=${encodeURIComponent(jobName)}`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to check job status');
      }
      
      setJobStatus(data.status);
      
      // Update the result with the latest status data
      setResult((prev: any) => ({
        ...prev,
        ...data
      }));
      
      // If job is completed or failed, stop polling
      if (data.status === 'Completed' || data.status === 'Failed' || data.status === 'Stopped') {
        if (statusInterval) {
          clearInterval(statusInterval);
          setStatusInterval(null);
        }
      }
      
    } catch (err) {
      console.error('Error checking job status:', err);
    } finally {
      setCheckingStatus(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Completed':
        return 'bg-green-100 text-green-800';
      case 'Failed':
      case 'Stopped':
        return 'bg-red-100 text-red-800';
      case 'InProgress':
      case 'processing':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded shadow-md">
      <h2 className="text-xl font-bold mb-4">Upload Jupyter Notebook to SageMaker</h2>
      
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="block mb-2 text-sm font-medium text-gray-700">
            Select Notebook File
          </label>
          <input
            type="file"
            accept=".ipynb"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-500
                     file:mr-4 file:py-2 file:px-4
                     file:rounded file:border-0
                     file:text-sm file:font-semibold
                     file:bg-blue-50 file:text-blue-700
                     hover:file:bg-blue-100"
          />
          {file && (
            <p className="mt-1 text-sm text-gray-500">
              Selected: {file.name}
            </p>
          )}
        </div>
        
        <button
          type="submit"
          disabled={!file || loading}
          className={`w-full py-2 px-4 rounded font-medium text-white
                    ${!file || loading 
                      ? 'bg-gray-400 cursor-not-allowed' 
                      : 'bg-blue-600 hover:bg-blue-700'}`}
        >
          {loading ? 'Uploading...' : 'Upload and Run Notebook'}
        </button>
      </form>
      
      {error && (
        <div className="mt-4 p-3 bg-red-50 text-red-700 rounded">
          <p>{error}</p>
        </div>
      )}
      
      {result && (
        <div className="mt-4 p-3 bg-gray-50 rounded">
          <h3 className="font-bold">Job Information</h3>
          <p className="mt-2">Job ID: {result.jobId}</p>
          <p className="mt-1">Job Name: {result.jobName}</p>
          
          {jobStatus && (
            <p className="mt-1">
              Status: 
              <span className={`ml-2 px-2 py-1 rounded text-xs font-medium ${getStatusColor(jobStatus)}`}>
                {jobStatus}
              </span>
            </p>
          )}
          
          {result.startTime && (
            <p className="mt-1">Started: {new Date(result.startTime).toLocaleString()}</p>
          )}
          
          {result.endTime && (
            <p className="mt-1">Completed: {new Date(result.endTime).toLocaleString()}</p>
          )}
          
          {result.outputs && result.outputs.length > 0 && (
            <div className="mt-3">
              <h4 className="font-semibold">Output Files:</h4>
              <ul className="mt-1 text-sm">
                {result.outputs.map((output: any, index: number) => (
                  <li key={index} className="mt-1">
                    {output.key.split('/').pop()} - {(output.size / 1024).toFixed(2)} KB
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {jobStatus === 'Completed' && (
            <p className="mt-3">
              Notebook execution completed successfully! Check the output S3 bucket for results.
            </p>
          )}
          
          {jobStatus === 'Failed' && (
            <div className="mt-3">
              <p className="text-red-600 font-medium">Notebook execution failed.</p>
              {result.failureReason && (
                <p className="mt-1 text-sm text-red-600">
                  Reason: {result.failureReason}
                </p>
              )}
              {result.logInfo && (
                <a 
                  href={result.logInfo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-sm text-blue-600 hover:underline"
                >
                  View CloudWatch Logs
                </a>
              )}
              <p className="mt-2 text-sm">
                Check the output files above for error details and partial results.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}