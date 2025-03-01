"use client"

import React, { useState, useEffect } from 'react';

interface ServerData {
  id: string;
  name: string;
  lat: number;
  lng: number;
  intensity: number;
  provider: string;
}

interface CarbonData {
  baseline: number;
  optimized: number;
  renewable: number;
}

const CarbonFootprintDashboard = () => {
  const [modelSize, setModelSize] = useState('medium');
  const [location, setLocation] = useState('europe');
  const [optimizations, setOptimizations] = useState<string[]>(['quantization', 'pruning']);
  const [serverData, setServerData] = useState<ServerData[]>([
    { id: 'us-east', name: 'US East', lat: 40.7128, lng: -74.0060, intensity: 420, provider: 'AWS' },
    { id: 'us-west', name: 'US West', lat: 37.7749, lng: -122.4194, intensity: 320, provider: 'GCP' },
    { id: 'eu-west', name: 'EU West', lat: 48.8566, lng: 2.3522, intensity: 210, provider: 'Azure' },
    { id: 'eu-north', name: 'EU North', lat: 59.3293, lng: 18.0686, intensity: 110, provider: 'AWS' },
    { id: 'asia-east', name: 'Asia East', lat: 35.6762, lng: 139.6503, intensity: 550, provider: 'GCP' },
    { id: 'asia-south', name: 'Asia South', lat: 1.3521, lng: 103.8198, intensity: 480, provider: 'Azure' }
  ]);
  const [selectedServer, setSelectedServer] = useState<ServerData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('map');
  const [isClient, setIsClient] = useState(false);
  
  // Simulated API call to get CO2Signal data
  const fetchCarbonData = () => {
    setIsLoading(true);
    
    // Simulate API delay
    setTimeout(() => {
      // In a real implementation, this would call the CO2Signal API
      // through your backend service
      const updatedData = serverData.map(server => ({
        ...server,
        intensity: server.intensity + (Math.random() > 0.5 ? 1 : -1) * Math.floor(Math.random() * 30)
      }));
      
      setServerData(updatedData);
      setIsLoading(false);
    }, 1000);
  };
  
  useEffect(() => {
    fetchCarbonData();
    setIsClient(true);
    // In a real implementation, you might set up a polling interval
    // to refresh data periodically
  }, []);
  
  // Mock data for the visualization
  const carbonData: CarbonData = {
    baseline: 1200, // kg CO2
    optimized: 320,  // kg CO2
    renewable: 80,   // kg CO2
  };
  
  // Calculate savings based on selected options
  const calculateSavings = (): CarbonData => {
    let multiplier = 1;
    
    // Model size impact
    if (modelSize === 'small') multiplier *= 0.7;
    if (modelSize === 'large') multiplier *= 1.4;
    
    // Location impact
    if (location === 'europe') multiplier *= 0.85;
    if (location === 'asia') multiplier *= 1.2;
    
    // Optimization impact
    const optimizationFactor = 1 - (optimizations.length * 0.15);
    
    return {
      baseline: Math.round(carbonData.baseline * multiplier),
      optimized: Math.round(carbonData.optimized * multiplier * optimizationFactor),
      renewable: Math.round(carbonData.renewable * multiplier * optimizationFactor),
    };
  };
  
  const currentData = calculateSavings();
  const savingsPercentage = Math.round(((currentData.baseline - currentData.renewable) / currentData.baseline) * 100);
  
  // Get color based on carbon intensity
  const getIntensityColor = (intensity: number): string => {
    if (intensity < 200) return "bg-green-500";
    if (intensity < 350) return "bg-yellow-500";
    if (intensity < 500) return "bg-orange-500";
    return "bg-red-500";
  };
  
  // Find the greenest server
  const greenestServer = [...serverData].sort((a, b) => a.intensity - b.intensity)[0];
  
  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <header className="bg-white p-4 shadow-sm flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-gray-800">EcoLLM: Green AI Training Platform</h1>
          <p className="text-sm text-gray-600">Minimize the carbon footprint of your large language models</p>
        </div>
        <div className="flex space-x-2">
          <button 
            className={`px-3 py-1 rounded-md text-sm ${activeTab === 'map' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
            onClick={() => setActiveTab('map')}
          >
            Global Map
          </button>
          <button 
            className={`px-3 py-1 rounded-md text-sm ${activeTab === 'config' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
            onClick={() => setActiveTab('config')}
          >
            Configuration
          </button>
          <button 
            className={`px-3 py-1 rounded-md text-sm ${activeTab === 'scheduler' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
            onClick={() => setActiveTab('scheduler')}
          >
            Scheduler
          </button>
        </div>
      </header>
      
      <div className="flex-1 overflow-hidden flex">
        {/* Main Map Section */}
        <div className={`flex-1 flex flex-col ${activeTab !== 'map' ? 'hidden md:flex' : ''}`}>
          <div className="p-4 bg-white shadow-sm flex justify-between items-center">
            <h2 className="text-lg font-semibold">Global Server Carbon Intensity</h2>
            <button 
              className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-md text-sm flex items-center"
              onClick={fetchCarbonData}
              disabled={isLoading}
            >
              {isLoading ? "Updating..." : "Refresh Data"}
            </button>
          </div>
          
          <div className="flex-1 relative bg-blue-50 overflow-hidden">
            {/* World map visualization */}
            <div className="absolute inset-0">
              <img src="/api/placeholder/1200/800" alt="World Map" className="w-full h-full object-cover opacity-20" />
              
              {/* Server location markers - only render on client side */}
              {isClient && serverData.map(server => (
                <div 
                  key={server.id} 
                  className="absolute cursor-pointer transform -translate-x-1/2 -translate-y-1/2 transition-all hover:scale-125"
                  style={{
                    top: `${(90 - server.lat) / 180 * 100}%`,
                    left: `${(180 + server.lng) / 360 * 100}%`,
                  }}
                  onClick={() => setSelectedServer(server)}
                >
                  <div className={`w-6 h-6 rounded-full ${getIntensityColor(server.intensity)} border-2 border-white flex items-center justify-center text-xs text-white font-bold`}>
                    {server.intensity < 200 ? '✓' : ''}
                  </div>
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-1 bg-black bg-opacity-75 text-white text-xs py-1 px-2 rounded whitespace-nowrap">
                    {server.name} ({server.intensity})
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="p-4 bg-white shadow-sm">
            <div className="p-3 bg-green-50 rounded-lg mb-2">
              <h3 className="font-medium mb-1">Recommended Server</h3>
              {greenestServer && (
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{greenestServer.name}</span>
                    <p className="text-sm text-gray-600">{greenestServer.provider}</p>
                  </div>
                  <div className="flex items-center">
                    <div className={`w-3 h-3 rounded-full ${getIntensityColor(greenestServer.intensity)} mr-2`}></div>
                    <span className="font-medium">{greenestServer.intensity} gCO<sub>2</sub>/kWh</span>
                  </div>
                  <button className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded-md text-sm">
                    Select Server
                  </button>
                </div>
              )}
            </div>
            
            {/* Selected server details */}
            {selectedServer && (
              <div className="p-3 border border-gray-200 rounded-lg bg-gray-50">
                <div className="flex justify-between items-start">
                  <h3 className="font-medium">{selectedServer.name} Details</h3>
                  <button 
                    className="text-gray-500"
                    onClick={() => setSelectedServer(null)}
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Provider</p>
                    <p className="font-medium">{selectedServer.provider}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Carbon Intensity</p>
                    <p className="font-medium">{selectedServer.intensity} gCO<sub>2</sub>/kWh</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Location</p>
                    <p className="font-medium">{selectedServer.lat.toFixed(2)}, {selectedServer.lng.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Estimated Savings</p>
                    <p className="font-medium text-green-600">
                      {Math.round((550 - selectedServer.intensity) / 5.5)}% vs. worst region
                    </p>
                  </div>
                </div>
                <div className="mt-2">
                  <button className="w-full bg-green-500 hover:bg-green-600 text-white py-1 rounded-md text-sm">
                    Schedule Training on This Server
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Side Panel */}
        <div className={`w-full md:w-96 bg-white shadow-lg overflow-y-auto ${activeTab === 'map' ? 'hidden md:block' : ''}`}>
          {activeTab === 'config' && (
            <div className="p-4">
              <h2 className="text-lg font-semibold mb-4">Model Configuration</h2>
              
              {/* Carbon Footprint Overview */}
              <div className="mb-6">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="font-medium">Carbon Footprint</h3>
                  <span className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs font-medium">
                    {savingsPercentage}% Reduction
                  </span>
                </div>
                
                <div className="flex space-x-2 mb-2">
                  <div className="flex-1 bg-red-50 p-2 rounded-lg text-center">
                    <p className="text-red-600 text-xs">Standard</p>
                    <p className="text-sm font-bold">{currentData.baseline} kg</p>
                  </div>
                  <div className="flex-1 bg-yellow-50 p-2 rounded-lg text-center">
                    <p className="text-yellow-600 text-xs">Optimized</p>
                    <p className="text-sm font-bold">{currentData.optimized} kg</p>
                  </div>
                  <div className="flex-1 bg-green-50 p-2 rounded-lg text-center">
                    <p className="text-green-600 text-xs">Green Energy</p>
                    <p className="text-sm font-bold">{currentData.renewable} kg</p>
                  </div>
                </div>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Model Size</label>
                  <select 
                    className="w-full p-2 border rounded-md"
                    value={modelSize}
                    onChange={(e) => setModelSize(e.target.value)}
                  >
                    <option value="small">Small (1B parameters)</option>
                    <option value="medium">Medium (7B parameters)</option>
                    <option value="large">Large (70B parameters)</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Training Location</label>
                  <select 
                    className="w-full p-2 border rounded-md"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  >
                    <option value="northamerica">North America</option>
                    <option value="europe">Europe</option>
                    <option value="asia">Asia</option>
                  </select>
                </div>
                
                <div>
                  <h3 className="text-sm text-gray-600 mb-1">Optimizations</h3>
                  <div className="space-y-1">
                    <label className="flex items-center">
                      <input 
                        type="checkbox" 
                        className="mr-2"
                        checked={optimizations.includes('quantization')}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setOptimizations([...optimizations, 'quantization']);
                          } else {
                            setOptimizations(optimizations.filter(item => item !== 'quantization'));
                          }
                        }}
                      />
                      <span className="text-sm">Quantization (8-bit)</span>
                    </label>
                    
                    <label className="flex items-center">
                      <input 
                        type="checkbox" 
                        className="mr-2"
                        checked={optimizations.includes('pruning')}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setOptimizations([...optimizations, 'pruning']);
                          } else {
                            setOptimizations(optimizations.filter(item => item !== 'pruning'));
                          }
                        }}
                      />
                      <span className="text-sm">Weight Pruning</span>
                    </label>
                    
                    <label className="flex items-center">
                      <input 
                        type="checkbox" 
                        className="mr-2"
                        checked={optimizations.includes('distillation')}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setOptimizations([...optimizations, 'distillation']);
                          } else {
                            setOptimizations(optimizations.filter(item => item !== 'distillation'));
                          }
                        }}
                      />
                      <span className="text-sm">Knowledge Distillation</span>
                    </label>
                    
                    <label className="flex items-center">
                      <input 
                        type="checkbox" 
                        className="mr-2"
                        checked={optimizations.includes('mixedprecision')}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setOptimizations([...optimizations, 'mixedprecision']);
                          } else {
                            setOptimizations(optimizations.filter(item => item !== 'mixedprecision'));
                          }
                        }}
                      />
                      <span className="text-sm">Mixed Precision Training</span>
                    </label>
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Early Stopping Patience</label>
                  <input type="range" className="w-full" min="1" max="10" defaultValue="3" />
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Aggressive</span>
                    <span>Balanced</span>
                    <span>Conservative</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {activeTab === 'scheduler' && (
            <div className="p-4">
              <h2 className="text-lg font-semibold mb-4">Green Scheduler</h2>
              
              <div className="mb-4">
                <h3 className="font-medium mb-2">Carbon Intensity Forecast (24h)</h3>
                <div className="h-32 bg-gray-100 rounded-lg mb-2 relative">
                  {/* Simple line chart representing 24-hour forecast */}
                  <svg viewBox="0 0 24 100" className="w-full h-full">
                    <polyline 
                      points="0,70 1,65 2,60 3,62 4,50 5,45 6,40 7,45 8,50 9,55 10,60 11,50 12,45 13,50 14,55 15,65 16,70 17,75 18,70 19,65 20,60 21,55 22,50 23,45 24,40" 
                      fill="none" 
                      stroke="#10B981" 
                      strokeWidth="2" 
                    />
                    <line x1="0" y1="0" x2="0" y2="100" stroke="#CBD5E1" strokeWidth="1" />
                    <line x1="0" y1="100" x2="24" y2="100" stroke="#CBD5E1" strokeWidth="1" />
                  </svg>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Now</span>
                  <span>6h</span>
                  <span>12h</span>
                  <span>18h</span>
                  <span>24h</span>
                </div>
              </div>
              
              <div className="mb-4">
                <h3 className="font-medium mb-2">Optimal Training Windows</h3>
                <div className="space-y-2">
                  <div className="p-2 bg-green-50 border border-green-200 rounded-lg flex justify-between items-center">
                    <div>
                      <p className="font-medium text-sm">Today, 3:00 AM - 7:00 AM</p>
                      <p className="text-xs text-gray-600">EU North (Stockholm)</p>
                    </div>
                    <div className="text-green-600 font-medium text-sm">115 gCO<sub>2</sub>/kWh</div>
                  </div>
                  
                  <div className="p-2 bg-green-50 border border-green-200 rounded-lg flex justify-between items-center">
                    <div>
                      <p className="font-medium text-sm">Tomorrow, 2:00 AM - 6:00 AM</p>
                      <p className="text-xs text-gray-600">US West (Oregon)</p>
                    </div>
                    <div className="text-green-600 font-medium text-sm">130 gCO<sub>2</sub>/kWh</div>
                  </div>
                </div>
              </div>
              
              <div>
                <h3 className="font-medium mb-2">Scheduling Options</h3>
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input type="radio" name="schedule" className="mr-2" defaultChecked />
                    <span className="text-sm">Optimize for lowest carbon intensity</span>
                  </label>
                  
                  <label className="flex items-center">
                    <input type="radio" name="schedule" className="mr-2" />
                    <span className="text-sm">Balance carbon and training speed</span>
                  </label>
                  
                  <label className="flex items-center">
                    <input type="radio" name="schedule" className="mr-2" />
                    <span className="text-sm">Optimize for fastest completion</span>
                  </label>
                </div>
              </div>
            </div>
          )}
          
          {activeTab === 'map' && (
            <div className="p-4">
              <h2 className="text-lg font-semibold mb-4">Server List</h2>
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Location</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Provider</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Carbon</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {serverData.sort((a, b) => a.intensity - b.intensity).map(server => (
                      <tr 
                        key={server.id} 
                        className={`${selectedServer?.id === server.id ? "bg-blue-50" : ""} cursor-pointer hover:bg-gray-50`}
                        onClick={() => setSelectedServer(server)}
                      >
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{server.name}</div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="text-sm text-gray-500">{server.provider}</div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className={`w-3 h-3 rounded-full ${getIntensityColor(server.intensity)} mr-2`}></div>
                            <div className="text-sm text-gray-900">{server.intensity}</div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          
          <div className="p-4 border-t">
            <button className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-md">
              Start Optimized Training
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CarbonFootprintDashboard;