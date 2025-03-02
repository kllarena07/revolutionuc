"use client"

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

const MapContainer = dynamic(
  () => import('react-leaflet').then((mod) => mod.MapContainer),
  { ssr: false }
);

const TileLayer = dynamic(
  () => import('react-leaflet').then((mod) => mod.TileLayer),
  { ssr: false }
);

const Marker = dynamic(
  () => import('react-leaflet').then((mod) => mod.Marker),
  { ssr: false }
);

const Popup = dynamic(
  () => import('react-leaflet').then((mod) => mod.Popup),
  { ssr: false }
);

// Import Leaflet only on client-side
let L: any;
if (typeof window !== 'undefined') {
  L = require('leaflet');
  // Don't import CSS this way - it causes HMR issues
  // require('leaflet/dist/leaflet.css');
}

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

interface ForecastData {
  region: string;
  created_at: string;
  intensity: number;
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

  const [forecastData, setForecastData] = useState<ForecastData[]>([]);
  console.log(forecastData);
  
  // Create DefaultIcon only on client side
  const [defaultIcon, setDefaultIcon] = useState<any>(null);
  
  // Initialize Leaflet-related items only on client side
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Import the CSS inside the useEffect
      import('leaflet/dist/leaflet.css');
      
      // Now we're safely on the client side
      const icon = L.icon({
        iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
      });
      
      setDefaultIcon(icon);
      L.Marker.prototype.options.icon = icon;
      setIsClient(true);
    }
  }, []);
  
  useEffect(() => {
    fetchCarbonData();
    // No need to set isClient here as it's handled in the Leaflet initialization
  }, []);
  
  // Simulated API call to get CO2Signal data
  const fetchCarbonData = () => {
    setIsLoading(true);
    
    // Simulate API delay
    setTimeout(async () => {
      // Fetch real carbon intensity data from our API
      try {
        // Get forecast data from our history API
        const forecastResponse = await fetch('/api/history', {
          headers: {
            'x-region': 'US-SW-PNM'
          }
        });
        if (!forecastResponse.ok) {
          throw new Error('Failed to fetch forecast data');
        }
        const forecastResult = await forecastResponse.json();
        setForecastData(forecastResult);
        
        // Update server data with some randomization for demonstration
        const updatedData = serverData.map(server => ({
          ...server,
          intensity: server.intensity + (Math.random() > 0.5 ? 1 : -1) * Math.floor(Math.random() * 30)
        }));
        
        setServerData(updatedData);
      } catch (error) {
        console.error('Error fetching carbon data:', error);
        // Fall back to random data if API fails
        const updatedData = serverData.map(server => ({
          ...server,
          intensity: server.intensity + (Math.random() > 0.5 ? 1 : -1) * Math.floor(Math.random() * 30)
        }));
        
        setServerData(updatedData);
      }
      setIsLoading(false);
    }, 1000);
  };
  
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
  
  // Get Leaflet icon based on carbon intensity
  const getIntensityIcon = (intensity: number) => {
    // Only create icons on the client side
    if (typeof window === 'undefined' || !isClient) return null;
    
    let color = "#10B981"; // green
    if (intensity >= 200 && intensity < 350) color = "#FBBF24"; // yellow
    if (intensity >= 350 && intensity < 500) color = "#F97316"; // orange
    if (intensity >= 500) color = "#EF4444"; // red
    
    return L.divIcon({
      className: "custom-div-icon",
      html: `<div style="background-color: ${color}; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 10px;">${intensity < 200 ? '✓' : ''}</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });
  };
  
  // Find the greenest server
  const greenestServer = [...serverData].sort((a, b) => a.intensity - b.intensity)[0];
  
  return (
    <div className="h-screen flex flex-col bg-zinc-900 text-zinc-200">
      <header className="bg-zinc-800 p-4 shadow-sm flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">EcoLLM: Green AI Training Platform</h1>
          <p className="text-sm text-zinc-400">Minimize the carbon footprint of your large language models</p>
        </div>
        <div className="flex space-x-2">
          <button 
            className={`px-3 py-1 rounded-md text-sm ${activeTab === 'map' ? 'bg-green-600 text-white' : 'bg-green-800 text-zinc-300'}`}
            onClick={() => setActiveTab('map')}
          >
            Global Map
          </button>
          <button 
            className={`px-3 py-1 rounded-md text-sm ${activeTab === 'config' ? 'bg-green-600 text-white' : 'bg-green-800 text-zinc-300'}`}
            onClick={() => setActiveTab('config')}
          >
            Configuration
          </button>
        </div>
      </header>
      
      <div className="flex-1 overflow-hidden flex">
        {/* Main content area with map and scheduler */}
        <div className="flex-1 flex flex-col">
          {/* Map Section - Takes 70% of the height when scheduler is active */}
          <div className={`${activeTab === 'scheduler' ? 'h-[70%]' : 'h-full'} relative`}>
            {isClient && (
              <MapContainer 
                center={[39.8283, -98.5795]} 
                zoom={3} 
                style={{ height: "100%", width: "100%" }}
                scrollWheelZoom={true}
                maxBounds={[[-60, -170], [75, 170]]}
                maxBoundsViscosity={1.0}
                zoomControl={false}
                attributionControl={false}
                minZoom={4}
              >
                <TileLayer
                  url="https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png"
                />
                {serverData.map(server => (
                  <Marker 
                    key={server.id} 
                    position={[server.lat, server.lng]} 
                    eventHandlers={{
                      click: () => {
                        setSelectedServer(server);
                      },
                    }}
                  >
                    {/* No Popup component here as we're showing details in the side panel */}
                  </Marker>
                ))}
              </MapContainer>
            )}
            
            {/* Map Controls Overlay */}
            <div className="absolute top-4 right-4 z-[1000]">
              <button 
                className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-md text-sm flex items-center shadow-lg"
                onClick={fetchCarbonData}
                disabled={isLoading}
              >
                {isLoading ? "Updating..." : "Refresh Data"}
              </button>
            </div>
          </div>
          
          {/* Scheduler Section - Only visible when scheduler tab is active, takes 30% of height */}
          <div className="h-[30%] bg-zinc-800 p-4 overflow-y-auto border-t border-zinc-700">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-lg font-semibold text-zinc-100">Green Scheduler</h2>
              <button className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-md text-sm">
                Schedule Training
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="font-medium mb-2 text-zinc-200 text-sm">Carbon Intensity Forecast</h3>
                <div className="h-20 bg-zinc-800 rounded-lg mb-1 relative border border-zinc-700">
                  {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-green-500"></div>
                    </div>
                  ) : (
                    <div className="relative w-full h-full p-2">
                      {forecastData.length > 0 && (
                        <div className="absolute left-2 top-0 h-full flex flex-col justify-between text-xs text-zinc-300 pr-1">
                          <span>{Math.max(...forecastData.map(d => d.intensity))} gCO₂</span>
                          <span>{Math.min(...forecastData.map(d => d.intensity))} gCO₂</span>
                        </div>
                      )}
                      <svg viewBox="0 0 100 100" className="w-full h-full pl-8" preserveAspectRatio="none">
                        {forecastData.length > 0 && (
                          <>
                            {(() => {
                              const minIntensity = Math.min(...forecastData.map(d => d.intensity));
                              const maxIntensity = Math.max(...forecastData.map(d => d.intensity));
                              const range = maxIntensity - minIntensity;
                              const padding = range * 0.1; // 10% padding
                              const effectiveMin = Math.max(0, minIntensity - padding);
                              const effectiveMax = maxIntensity + padding;
                              
                              // Function to scale the y value
                              const scaleY = (value: number) => 
                                100 - ((value - effectiveMin) / (effectiveMax - effectiveMin) * 100);
                              
                              // Create horizontal grid lines
                              const gridLines = [];
                              for (let i = 0; i <= 4; i++) {
                                const y = i * 25;
                                gridLines.push(
                                  <line 
                                    key={`grid-${i}`} 
                                    x1="0" 
                                    y1={y} 
                                    x2="100" 
                                    y2={y} 
                                    stroke="#3f3f46" 
                                    strokeWidth="0.5" 
                                    strokeDasharray="2,2" 
                                  />
                                );
                              }
                              
                              return (
                                <>
                                  {/* Grid lines */}
                                  {gridLines}
                                  
                                  {/* Axis lines */}
                                  <line x1="0" y1="0" x2="0" y2="100" stroke="#71717A" strokeWidth="1" />
                                  <line x1="0" y1="100" x2="100" y2="100" stroke="#71717A" strokeWidth="1" />
                                  
                                  {/* Area under the curve */}
                                  <path 
                                    d={`
                                      M0,${scaleY(forecastData[0].intensity)}
                                      ${forecastData.map((data, index) => 
                                        `L${(index / (forecastData.length - 1)) * 100},${scaleY(data.intensity)}`
                                      ).join(' ')}
                                      L100,100 L0,100 Z
                                    `}
                                    fill="url(#greenGradient)" 
                                    opacity="0.3" 
                                  />
                                  
                                  {/* Line chart - using path instead of polyline for consistent width */}
                                  <path 
                                    d={`
                                      M0,${scaleY(forecastData[0].intensity)}
                                      ${forecastData.map((data, index) => 
                                        `L${(index / (forecastData.length - 1)) * 100},${scaleY(data.intensity)}`
                                      ).join(' ')}
                                    `}
                                    fill="none" 
                                    stroke="#10B981" 
                                    strokeWidth="1.5" 
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    vectorEffect="non-scaling-stroke"
                                  />
                                  
                                  {/* Data points */}
                                  {forecastData.map((data, index) => (
                                    <circle 
                                      key={index}
                                      cx={`${(index / (forecastData.length - 1)) * 100}`}
                                      cy={`${scaleY(data.intensity)}`}
                                      r="1.5"
                                      fill="#10B981"
                                      stroke="#10B981"
                                      strokeWidth="1"
                                      className="hover:r-3 transition-all duration-200 cursor-pointer"
                                    />
                                  ))}
                                </>
                              );
                            })()}
                            
                            {/* Gradient definition */}
                            <defs>
                              <linearGradient id="greenGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor="#10B981" stopOpacity="0.8" />
                                <stop offset="100%" stopColor="#10B981" stopOpacity="0.1" />
                              </linearGradient>
                            </defs>
                          </>
                        )}
                      </svg>
                      
                      {/* Tooltip */}
                      <div 
                        id="carbon-tooltip" 
                        className="absolute bg-zinc-900 text-white text-xs p-2 rounded shadow-lg z-10 pointer-events-none border border-zinc-600"
                        style={{ display: 'none', transform: 'translate(-50%, -100%)' }}
                      ></div>
                      
                      {/* Invisible hover areas for tooltips */}
                      {forecastData.length > 0 && (() => {
                        const minIntensity = Math.min(...forecastData.map(d => d.intensity));
                        const maxIntensity = Math.max(...forecastData.map(d => d.intensity));
                        const range = maxIntensity - minIntensity;
                        const padding = range * 0.1;
                        const effectiveMin = Math.max(0, minIntensity - padding);
                        const effectiveMax = maxIntensity + padding;
                        
                        const scaleY = (value: number) => 
                          100 - ((value - effectiveMin) / (effectiveMax - effectiveMin) * 100);
                          
                        return forecastData.map((data, index) => (
                          <div 
                            key={index}
                            className="absolute w-4 h-4 cursor-pointer"
                            style={{
                              left: `${(index / (forecastData.length - 1)) * 100}%`,
                              top: `${scaleY(data.intensity)}%`,
                              transform: 'translate(-50%, -50%)'
                            }}
                            onMouseOver={(e) => {
                              const tooltip = document.getElementById('carbon-tooltip');
                              if (tooltip) {
                                const date = new Date(data.created_at);
                                const formattedDate = date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                                tooltip.innerHTML = `<div class="font-medium">${data.intensity} gCO<sub>2</sub>/kWh</div><div>${formattedDate}</div>`;
                                
                                // Position the tooltip above the data point
                                tooltip.style.left = `${(index / (forecastData.length - 1)) * 100}%`;
                                tooltip.style.top = `${scaleY(data.intensity) - 10}%`;
                                
                                tooltip.style.display = 'block';
                              }
                            }}
                            onMouseOut={() => {
                              const tooltip = document.getElementById('carbon-tooltip');
                              if (tooltip) {
                                tooltip.style.display = 'none';
                              }
                            }}
                          />
                        ));
                      })()}
                    </div>
                  )}
                </div>
                <div className="flex justify-between text-xs text-zinc-400">
                  {forecastData.length > 0 && (
                    <>
                      <span>{new Date(forecastData[forecastData.length - 1].created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                      <span>{forecastData.length > Math.floor(forecastData.length / 2) && 
                        new Date(forecastData[Math.floor(forecastData.length / 2)].created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                      <span>{new Date(forecastData[0].created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </>
                  )}
                  {forecastData.length === 0 && (
                    <>
                      <span>Now</span>
                      <span>12h</span>
                      <span>24h</span>
                    </>
                  )}
                </div>
              </div>
              
              <div>
                <h3 className="font-medium mb-2 text-zinc-200 text-sm">Optimal Training Windows</h3>
                <div className="space-y-2">
                  <div className="p-2 bg-green-900 border border-green-700 rounded-lg flex justify-between items-center">
                    <div>
                      <p className="font-medium text-xs text-zinc-200">Today, 3:00 AM - 7:00 AM</p>
                      <p className="text-xs text-zinc-400">EU North (Stockholm)</p>
                    </div>
                    <div className="text-green-400 font-medium text-xs">115 gCO<sub>2</sub>/kWh</div>
                  </div>
                  
                  <div className="p-2 bg-green-900 border border-green-700 rounded-lg flex justify-between items-center">
                    <div>
                      <p className="font-medium text-xs text-zinc-200">Tomorrow, 2:00 AM - 6:00 AM</p>
                      <p className="text-xs text-zinc-400">US West (Oregon)</p>
                    </div>
                    <div className="text-green-400 font-medium text-xs">130 gCO<sub>2</sub>/kWh</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Side Panel - Always visible on desktop */}
        <div className="hidden md:block w-96 bg-zinc-800 shadow-lg overflow-y-auto">
          {activeTab === 'config' && (
            <div className="p-4">
              <h2 className="text-lg font-semibold mb-4 text-zinc-100">Model Configuration</h2>
              
              {/* Carbon Footprint Overview */}
              <div className="mb-6">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="font-medium text-zinc-200">Carbon Footprint</h3>
                  <span className="bg-green-900 text-green-300 px-2 py-1 rounded-full text-xs font-medium">
                    {savingsPercentage}% Reduction
                  </span>
                </div>
                
                <div className="flex space-x-2 mb-2">
                  <div className="flex-1 bg-red-900 p-2 rounded-lg text-center">
                    <p className="text-red-300 text-xs">Standard</p>
                    <p className="text-sm font-bold text-red-200">{currentData.baseline} kg</p>
                  </div>
                  <div className="flex-1 bg-yellow-900 p-2 rounded-lg text-center">
                    <p className="text-yellow-300 text-xs">Optimized</p>
                    <p className="text-sm font-bold text-yellow-200">{currentData.optimized} kg</p>
                  </div>
                  <div className="flex-1 bg-green-900 p-2 rounded-lg text-center">
                    <p className="text-green-300 text-xs">Green Energy</p>
                    <p className="text-sm font-bold text-green-200">{currentData.renewable} kg</p>
                  </div>
                </div>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">Model Size</label>
                  <select 
                    className="w-full p-2 border rounded-md bg-zinc-700 border-zinc-600 text-zinc-200"
                    value={modelSize}
                    onChange={(e) => setModelSize(e.target.value)}
                  >
                    <option value="small">Small (1B parameters)</option>
                    <option value="medium">Medium (7B parameters)</option>
                    <option value="large">Large (70B parameters)</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">Training Location</label>
                  <select 
                    className="w-full p-2 border rounded-md bg-zinc-700 border-zinc-600 text-zinc-200"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  >
                    <option value="northamerica">North America</option>
                    <option value="europe">Europe</option>
                    <option value="asia">Asia</option>
                  </select>
                </div>
                
                <div>
                  <h3 className="text-sm text-zinc-400 mb-1">Optimizations</h3>
                  <div className="space-y-1">
                    <label className="flex items-center">
                      <input 
                        type="checkbox" 
                        className="mr-2 bg-zinc-700 border-zinc-600"
                        checked={optimizations.includes('quantization')}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setOptimizations([...optimizations, 'quantization']);
                          } else {
                            setOptimizations(optimizations.filter(item => item !== 'quantization'));
                          }
                        }}
                      />
                      <span className="text-sm text-zinc-300">Quantization (8-bit)</span>
                    </label>
                    
                    <label className="flex items-center">
                      <input 
                        type="checkbox" 
                        className="mr-2 bg-zinc-700 border-zinc-600"
                        checked={optimizations.includes('pruning')}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setOptimizations([...optimizations, 'pruning']);
                          } else {
                            setOptimizations(optimizations.filter(item => item !== 'pruning'));
                          }
                        }}
                      />
                      <span className="text-sm text-zinc-300">Weight Pruning</span>
                    </label>
                    
                    <label className="flex items-center">
                      <input 
                        type="checkbox" 
                        className="mr-2 bg-zinc-700 border-zinc-600"
                        checked={optimizations.includes('distillation')}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setOptimizations([...optimizations, 'distillation']);
                          } else {
                            setOptimizations(optimizations.filter(item => item !== 'distillation'));
                          }
                        }}
                      />
                      <span className="text-sm text-zinc-300">Knowledge Distillation</span>
                    </label>
                    
                    <label className="flex items-center">
                      <input 
                        type="checkbox" 
                        className="mr-2 bg-zinc-700 border-zinc-600"
                        checked={optimizations.includes('mixedprecision')}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setOptimizations([...optimizations, 'mixedprecision']);
                          } else {
                            setOptimizations(optimizations.filter(item => item !== 'mixedprecision'));
                          }
                        }}
                      />
                      <span className="text-sm text-zinc-300">Mixed Precision Training</span>
                    </label>
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">Early Stopping Patience</label>
                  <input type="range" className="w-full bg-zinc-700" min="1" max="10" defaultValue="3" />
                  <div className="flex justify-between text-xs text-zinc-400">
                    <span>Aggressive</span>
                    <span>Balanced</span>
                    <span>Conservative</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {activeTab === 'map' && (
            <div className="p-4">
              <h2 className="text-lg font-semibold mb-4 text-zinc-100">Server List</h2>
              
              {/* Selected server details - Integrated from popup */}
              {selectedServer && (
                <div className="p-3 border border-zinc-700 rounded-lg bg-zinc-700 mb-4">
                  <div className="flex justify-between items-start">
                    <h3 className="font-medium text-zinc-200">{selectedServer.name} Details</h3>
                    <button 
                      className="text-zinc-400"
                      onClick={() => setSelectedServer(null)}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-zinc-400">Provider</p>
                      <p className="font-medium text-zinc-200">{selectedServer.provider}</p>
                    </div>
                    <div>
                      <p className="text-sm text-zinc-400">Carbon Intensity</p>
                      <p className="font-medium text-zinc-200">{selectedServer.intensity} gCO<sub>2</sub>/kWh</p>
                    </div>
                    <div>
                      <p className="text-sm text-zinc-400">Location</p>
                      <p className="font-medium text-zinc-200">{selectedServer.lat.toFixed(2)}, {selectedServer.lng.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-zinc-400">Estimated Savings</p>
                      <p className="font-medium text-green-500">
                        {Math.round((550 - selectedServer.intensity) / 5.5)}% vs. worst region
                      </p>
                    </div>
                  </div>
                  <div className="mt-2">
                    <button className="w-full bg-green-600 hover:bg-green-700 text-white py-1 rounded-md text-sm">
                      Schedule Training on This Server
                    </button>
                  </div>
                </div>
              )}
              
              {/* Recommended server section */}
              <div className="p-3 bg-zinc-700 rounded-lg mb-4">
                <h3 className="font-medium mb-1 text-zinc-200">Recommended Server</h3>
                {greenestServer && (
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium text-zinc-200">{greenestServer.name}</span>
                      <p className="text-sm text-zinc-400">{greenestServer.provider}</p>
                    </div>
                    <div className="flex items-center">
                      <div className={`w-3 h-3 rounded-full ${getIntensityColor(greenestServer.intensity)} mr-2`}></div>
                      <span className="font-medium text-zinc-200">{greenestServer.intensity} gCO<sub>2</sub>/kWh</span>
                    </div>
                    <button className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-md text-sm">
                      Select Server
                    </button>
                  </div>
                )}
              </div>
              
              <div className="overflow-hidden rounded-lg border border-zinc-700">
                <table className="min-w-full divide-y divide-zinc-700">
                  <thead className="bg-zinc-700">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">Location</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">Provider</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">Carbon</th>
                    </tr>
                  </thead>
                  <tbody className="bg-zinc-800 divide-y divide-zinc-700">
                    {serverData.sort((a, b) => a.intensity - b.intensity).map(server => (
                      <tr 
                        key={server.id} 
                        className={`${selectedServer?.id === server.id ? "bg-zinc-700" : ""} cursor-pointer hover:bg-zinc-700`}
                        onClick={() => setSelectedServer(server)}
                      >
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="text-sm font-medium text-zinc-200">{server.name}</div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="text-sm text-zinc-400">{server.provider}</div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className={`w-3 h-3 rounded-full ${getIntensityColor(server.intensity)} mr-2`}></div>
                            <div className="text-sm text-zinc-200">{server.intensity}</div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          
          <div className="p-4 border-t border-zinc-700">
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