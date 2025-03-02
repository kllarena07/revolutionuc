'use client';

import { useState, useEffect, useRef } from 'react';
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
  
  // New states for log streaming
  const [logContent, setLogContent] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [logPollingInterval, setLogPollingInterval] = useState<NodeJS.Timeout | null>(null);
  const [logLoadAttempts, setLogLoadAttempts] = useState(0); // Track loading attempts
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Clean up intervals on unmount
  useEffect(() => {
    return () => {
      if (statusInterval) {
        clearInterval(statusInterval);
      }
      if (logPollingInterval) {
        clearInterval(logPollingInterval);
      }
    };
  }, [statusInterval, logPollingInterval]);

  // Auto-scroll logs to bottom when content changes
  useEffect(() => {
    if (logContainerRef.current && isStreaming) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logContent, isStreaming]);

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

  const fetchLogContent = async (jobId: string) => {
    try {
      setLogLoadAttempts(prev => prev + 1);
      
      // Use the origin from the current page instead of hardcoding localhost:3000
      const baseUrl = window.location.origin;
      const url = `${baseUrl}/api/notebook-logs?jobId=${jobId}&type=execution`;
      console.log(`Fetching logs from: ${url}`);
      
      const response = await fetch(url, {
        // Add cache control to prevent caching issues
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      if (response.status === 416) {
        // Handle "Range Not Satisfiable" error - log file likely doesn't exist yet
        console.log('Log file not ready yet (Range Not Satisfiable)');
        return;
      }
      
      if (!response.ok) {
        console.error(`Failed to fetch logs: ${response.status} ${response.statusText}`);
        return;
      }
      
      // Get the content type to handle different response formats
      const contentType = response.headers.get('content-type');
      let data;
      
      if (contentType && contentType.includes('application/json')) {
        // Handle JSON response
        const jsonData = await response.json();
        data = typeof jsonData === 'string' ? jsonData : JSON.stringify(jsonData, null, 2);
        console.log('Received JSON log data:', data);
      } else {
        // Handle text response
        data = await response.text();
        console.log(`Received log data (${data.length} chars)`);
      }
      
      if (data && data.trim().length > 0) {
        console.log('Setting log content to:', data.substring(0, 100) + '...');
        setLogContent(prev => {
          // If the new data is the same as the old data, no need to update
          if (prev === data) {
            console.log('Log content unchanged');
            return prev;
          }
          return data;
        });
      } else {
        console.log('Log data is empty or only whitespace');
      }
    } catch (err) {
      console.error('Error fetching logs:', err);
      
      // If we get an InvalidRange error, the log might not exist yet
      if (err instanceof Error && err.message.includes('InvalidRange')) {
        console.log('Log file not ready yet (InvalidRange error)');
        // Continue polling - don't stop the process
      }
    }
  };

  const startLogStreaming = (jobId: string) => {
    // Clear any existing content and intervals
    setLogContent('');
    setLogLoadAttempts(0);
    if (logPollingInterval) {
      clearInterval(logPollingInterval);
    }
    
    setIsStreaming(true);
    
    // Clean the jobId to ensure no formatting issues
    const cleanJobId = jobId.trim().replace('/execution.log', '');
    console.log(`Starting log streaming for job: ${cleanJobId}`);
    
    // Add a small initial delay to give time for the log file to be created
    setTimeout(() => {
      // Initial fetch after delay
      fetchLogContent(cleanJobId);
      
      // Use variable polling interval based on attempts
      let pollInterval = 2000; // Start with 2 seconds
      let currentAttempts = 0;
      const maxAttempts = 30; // Limit to prevent infinite polling
      
      // Then start regular polling with progressive backoff
      const interval = setInterval(() => {
        currentAttempts++;
        fetchLogContent(cleanJobId);
        
        // If we have log content or we've reached the limit, stabilize polling rate
        if (logContent.length > 0 || currentAttempts > 10) {
          pollInterval = 5000; // Switch to 5 seconds once we have content
        } else if (currentAttempts > 5) {
          pollInterval = 3000; // 3 seconds after 5 attempts
        }
        
        // If we've reached the max attempts and still don't have logs, slow down polling
        if (currentAttempts >= maxAttempts && logContent.length === 0) {
          console.log(`Max log polling attempts (${maxAttempts}) reached. Slowing polling rate.`);
          clearInterval(interval);
          setLogPollingInterval(setInterval(() => {
            fetchLogContent(cleanJobId);
          }, 10000)); // Poll every 10 seconds after max attempts
        }
      }, pollInterval);
      
      setLogPollingInterval(interval);
    }, 2000); // Wait 2 seconds before starting to poll
  };

  const stopLogStreaming = () => {
    if (logPollingInterval) {
      clearInterval(logPollingInterval);
      setLogPollingInterval(null);
    }
    setIsStreaming(false);
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
    setLogContent('');
    
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
      
      // Start log streaming immediately after job is submitted
      if (data.jobId) {
        startLogStreaming(data.jobId);
      }
      
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
      
      // If job is completed or failed, stop polling and log streaming
      if (data.status === 'Completed' || data.status === 'Failed' || data.status === 'Stopped') {
        if (statusInterval) {
          clearInterval(statusInterval);
          setStatusInterval(null);
        }
        
        // Fetch logs one final time before stopping
        if (result?.jobId) {
          // Clean the jobId before final log fetch
          const cleanJobId = result.jobId.trim().replace('/execution.log', '');
          await fetchLogContent(cleanJobId);
        }
        
        stopLogStreaming();
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

  // Function to generate placeholder logs based on job status and loading attempts
  const getPlaceholderLogs = (jobId: string) => {
    const timestamp = new Date().toISOString();
    
    if (logLoadAttempts === 0) {
      return `[${timestamp}] Initializing log streaming for job ${jobId}...\n[${timestamp}] Connecting to AWS S3 bucket...\n[${timestamp}] Waiting for SageMaker Processing job to start...`;
    } else if (logLoadAttempts < 3) {
      return `[${timestamp}] Initializing log streaming for job ${jobId}...\n[${timestamp}] Connecting to AWS S3 bucket...\n[${timestamp}] Waiting for SageMaker Processing job to start...\n[${timestamp}] Attempt ${logLoadAttempts}: Checking for log file in S3...`;
    } else if (logLoadAttempts < 6) {
      return `[${timestamp}] SageMaker job ${jobId} is being provisioned...\n[${timestamp}] Setting up compute instance (ml.t3.medium)...\n[${timestamp}] Downloading notebook from S3...\n[${timestamp}] Attempt ${logLoadAttempts}: Waiting for first log entries...`;
    } else if (logLoadAttempts < 10) {
      return `[${timestamp}] SageMaker job ${jobId} is starting execution...\n[${timestamp}] Container is running setup scripts...\n[${timestamp}] Installing required Python packages...\n[${timestamp}] Attempt ${logLoadAttempts}: Waiting for notebook execution to begin...`;
    } else {
      return `[${timestamp}] SageMaker job ${jobId} should be running...\n[${timestamp}] If logs don't appear soon, there might be an issue with the job execution.\n[${timestamp}] Check AWS SageMaker console for more details.\n[${timestamp}] Attempts: ${logLoadAttempts} - Still waiting for log data...`;
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
                Upload & Train Model
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
            
            {/* Log Transcript Area */}
            {(isStreaming || logContent) && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center">
                    <svg 
                      className="w-3 h-3 mr-1 text-zinc-400" 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24" 
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span className="text-xs font-medium text-zinc-300">Live Execution Log</span>
                  </div>
                  {isStreaming && (
                    <span className="flex items-center text-xs text-zinc-400">
                      <span className="relative flex h-2 w-2 mr-1">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                      </span>
                      Streaming
                    </span>
                  )}
                </div>
                <div 
                  ref={logContainerRef}
                  className="bg-zinc-900 border border-zinc-700 rounded p-2 h-64 overflow-y-auto font-mono text-xs whitespace-pre-wrap text-white"
                  data-testid="log-container"
                >
                  {logContent 
                    ? logContent 
                    : result?.jobId 
                      ? getPlaceholderLogs(result.jobId)
                      : 'Waiting for job to start...'}
                </div>
                {(!logContent && logLoadAttempts > 0) && (
                  <div className="mt-1 text-xs text-zinc-500 flex items-center">
                    <svg className="animate-spin -ml-1 mr-1 h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Loading logs (attempt {logLoadAttempts})...
                  </div>
                )}
                {logContent && (
                  <div className="mt-1 text-xs text-green-500 flex items-center">
                    <svg 
                      className="w-3 h-3 mr-1" 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24" 
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Logs loaded successfully ({logContent.length} characters)
                  </div>
                )}
              </div>
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