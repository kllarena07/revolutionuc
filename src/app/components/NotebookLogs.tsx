import { useState, useEffect, useRef } from 'react';

interface NotebookLog {
  timestamp: string;
  level: string;
  message: string;
  notebookId?: string;
}

const NotebookLogs = () => {
  const [logs, setLogs] = useState<NotebookLog[]>([]);
  const [rawLogs, setRawLogs] = useState<string[]>([]);
  const [logError, setLogError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [logRefreshKey, setLogRefreshKey] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [parsedMode, setParsedMode] = useState(true);
  const refreshInterval = useRef<NodeJS.Timeout | null>(null);

  // Function to fetch notebook logs
  const fetchLogs = async () => {
    setIsLoading(true);
    setLogError(null);
    
    try {
      console.log('Fetching notebook logs...');
      
      // Make the API request - remove the range parameters if they're causing issues
      const response = await fetch('/api/notebook-logs');
      
      // Check for errors
      if (!response.ok) {
        if (response.status === 416) {
          throw new Error('Range not satisfiable - the requested log range does not exist');
        }
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }
      
      // Get response data
      const contentType = response.headers.get('content-type');
      let logData;
      
      if (contentType && contentType.includes('application/json')) {
        logData = await response.json();
      } else {
        const textData = await response.text();
        // Handle non-JSON response
        logData = textData.split('\n').filter(line => line.trim().length > 0);
      }
      
      console.log('Received log data:', logData);
      
      // Store raw logs
      const logArray = Array.isArray(logData) ? logData : [String(logData)];
      setRawLogs(logArray);
      
      // Try to parse structured logs
      const parsedLogs: NotebookLog[] = [];
      logArray.forEach(log => {
        try {
          // If it's already a parsed object
          if (typeof log === 'object' && log !== null) {
            parsedLogs.push(log as NotebookLog);
          } else if (typeof log === 'string') {
            // Try to parse JSON strings
            try {
              const parsed = JSON.parse(log);
              parsedLogs.push(parsed);
            } catch (jsonError) {
              // If not JSON, create a simple log entry
              parsedLogs.push({
                timestamp: new Date().toISOString(),
                level: 'info',
                message: log
              });
            }
          }
        } catch (parseError) {
          console.warn('Could not parse log entry:', log);
        }
      });
      
      setLogs(parsedLogs);
      setLogRefreshKey(prev => prev + 1); // Force re-render
      
    } catch (error) {
      console.error('Error fetching notebook logs:', error);
      setLogError(error instanceof Error ? error.message : 'Unknown error fetching logs');
    } finally {
      setIsLoading(false);
    }
  };
  
  // Auto-refresh logs when enabled
  useEffect(() => {
    if (autoRefresh) {
      refreshInterval.current = setInterval(() => {
        fetchLogs();
      }, 5000); // Refresh every 5 seconds
    } else if (refreshInterval.current) {
      clearInterval(refreshInterval.current);
    }
    
    return () => {
      if (refreshInterval.current) {
        clearInterval(refreshInterval.current);
      }
    };
  }, [autoRefresh]);
  
  // Fetch logs on first render
  useEffect(() => {
    fetchLogs();
    // Clean up interval on unmount
    return () => {
      if (refreshInterval.current) {
        clearInterval(refreshInterval.current);
      }
    };
  }, []);
  
  // Get log level color
  const getLogLevelColor = (level: string): string => {
    level = level.toLowerCase();
    switch (level) {
      case 'error':
        return 'text-red-500';
      case 'warning':
      case 'warn':
        return 'text-yellow-500';
      case 'info':
        return 'text-blue-400';
      case 'debug':
        return 'text-gray-400';
      default:
        return 'text-green-400';
    }
  };
  
  // Format timestamp
  const formatTimestamp = (timestamp: string): string => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch (e) {
      return timestamp;
    }
  };
  
  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold text-gray-900">Notebook Execution Logs</h2>
        <div className="flex space-x-3">
          <button
            onClick={() => setParsedMode(!parsedMode)}
            className="px-4 py-2 rounded-md text-white bg-blue-600 hover:bg-blue-700"
          >
            {parsedMode ? 'Show Raw Logs' : 'Show Parsed Logs'}
          </button>
          <button
            onClick={fetchLogs}
            disabled={isLoading}
            className={`px-4 py-2 rounded-md text-white ${
              isLoading ? "bg-gray-400" : "bg-green-600 hover:bg-green-700"
            }`}
          >
            {isLoading ? "Loading..." : "Refresh Logs"}
          </button>
          <div className="flex items-center">
            <input
              type="checkbox"
              id="autoRefresh"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
            />
            <label htmlFor="autoRefresh" className="ml-2 text-sm text-gray-700">
              Auto-refresh
            </label>
          </div>
        </div>
      </div>
      
      {logError && (
        <div className="mb-4 p-3 bg-red-100 border border-red-200 text-red-700 rounded-md">
          <p>Error: {logError}</p>
        </div>
      )}
      
      <div 
        className="bg-gray-900 text-green-400 font-mono p-4 rounded-md overflow-auto max-h-[600px]"
        key={logRefreshKey} // Force re-render when this changes
      >
        {isLoading && (logs.length === 0 || rawLogs.length === 0) ? (
          <div className="flex justify-center items-center h-40">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-green-500"></div>
          </div>
        ) : parsedMode ? (
          logs.length === 0 ? (
            <p className="text-gray-400">No logs available</p>
          ) : (
            <div className="space-y-2">
              {logs.map((log, index) => (
                <div 
                  key={index} 
                  className="py-2 px-2 border-b border-gray-800 last:border-0 hover:bg-gray-800 rounded"
                >
                  <div className="flex items-start">
                    <span className="text-gray-500 mr-2">
                      {log.timestamp ? formatTimestamp(log.timestamp) : 'Unknown time'}
                    </span>
                    {log.level && <span className={`font-bold mr-2 ${getLogLevelColor(log.level)}`}>[{log.level.toUpperCase()}]</span>}
                    {log.notebookId && <span className="text-purple-400 mr-2">{log.notebookId}</span>}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap">{log.message}</div>
                </div>
              ))}
            </div>
          )
        ) : (
          rawLogs.length === 0 ? (
            <p className="text-gray-400">No raw logs available</p>
          ) : (
            <pre className="whitespace-pre-wrap break-words">
              {rawLogs.map((log, index) => (
                <div 
                  key={index} 
                  className="py-1 border-b border-gray-800 last:border-0"
                >
                  {typeof log === 'string' ? log : JSON.stringify(log, null, 2)}
                </div>
              ))}
            </pre>
          )
        )}
      </div>
    </div>
  );
};

export default NotebookLogs; 