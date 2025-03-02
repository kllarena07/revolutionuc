'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

interface NotebookUploaderProps {
  compact?: boolean;
}

export default function NotebookUploader({ compact = false }: NotebookUploaderProps) {
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
        return 'bg-green-900 text-green-300';
      case 'Failed':
      case 'Stopped':
        return 'bg-red-900 text-red-300';
      case 'InProgress':
      case 'processing':
        return 'bg-blue-900 text-blue-300';
      default:
        return 'bg-zinc-700 text-zinc-300';
    }
  };

  return (
    <div className={`bg-zinc-800 rounded-lg border border-zinc-700 overflow-hidden ${compact ? 'text-xs' : ''}`}>
      <div className="px-3 py-2">
        <div className="flex items-center">
          <svg 
            className={`${compact ? 'w-3 h-3 mr-1' : 'w-4 h-4 mr-2'} text-zinc-400`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24" 
            xmlns="http://www.w3.org/2000/svg"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className={`font-medium ${compact ? 'text-xs' : 'text-sm'}`}>
            {compact ? 'Upload Notebook' : 'Jupyter Notebook Upload'}
          </h3>
        </div>
      </div>
      
      <div className={`${compact ? 'p-2' : 'p-3'} border-t border-zinc-700`}>
        <form onSubmit={handleSubmit} className={`${compact ? 'space-y-2' : 'space-y-3'}`}>
          <div>
            <label className={`block ${compact ? 'mb-0.5' : 'mb-1'} text-xs font-medium text-zinc-300`}>
              Select Notebook File (.ipynb)
            </label>
            <div className="flex">
              <input
                type="file"
                accept=".ipynb"
                onChange={handleFileChange}
                className="w-full text-xs text-zinc-300 
                         file:mr-2 file:py-1 file:px-2 
                         file:rounded file:border-0 
                         file:text-xs file:font-medium 
                         file:bg-zinc-700 file:text-zinc-200 
                         hover:file:bg-zinc-600"
              />
            </div>
            {file && (
              <p className="mt-1 text-xs text-zinc-400 truncate">
                Selected: {file.name}
              </p>
            )}
          </div>
          
          <button
            type="submit"
            disabled={!file || loading}
            className={`w-full ${compact ? 'py-1 text-xs' : 'py-2 text-sm'} px-3 rounded font-medium text-white flex items-center justify-center
                       ${!file || loading 
                         ? 'bg-zinc-600 cursor-not-allowed' 
                         : 'bg-green-600 hover:bg-green-700'}`}
          >
            {loading ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Uploading...
              </>
            ) : (
              <>
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Upload & Run Notebook
              </>
            )}
          </button>
        </form>
        
        {error && (
          <div className="mt-3 p-2 bg-red-900 bg-opacity-40 text-red-300 rounded border border-red-800 text-xs">
            <p>{error}</p>
          </div>
        )}
        
        {result && (
          <div className="mt-3 text-xs">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-zinc-400">Job:</span> {result.jobName}
              </div>
              {jobStatus && (
                <span className={`px-2 py-0.5 rounded text-xs ${getStatusColor(jobStatus)}`}>
                  {jobStatus}
                </span>
              )}
            </div>
            
            {result.startTime && (
              <p className="mt-1"><span className="text-zinc-400">Started:</span> {new Date(result.startTime).toLocaleString()}</p>
            )}
            
            {jobStatus === 'Completed' && (
              <div className="mt-2 p-1.5 bg-green-900 bg-opacity-30 border border-green-800 rounded text-xs text-green-300">
                Notebook execution completed successfully!
              </div>
            )}
            
            {jobStatus === 'Failed' && (
              <div className="mt-2 p-1.5 bg-red-900 bg-opacity-30 border border-red-800 rounded text-xs text-red-300">
                <p>Notebook execution failed.</p>
                {result.failureReason && (
                  <p className="mt-1"><span className="text-zinc-400">Reason:</span> {result.failureReason}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
} 