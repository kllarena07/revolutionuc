"use client";

import React, { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence, animate } from 'framer-motion';
import NotebookUploader from './NotebookUploader';

// Import Leaflet only on client-side
let L: any;
if (typeof window !== "undefined") {
  L = require("leaflet");
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
  zone: string;
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

interface GeoJSONFeature {
  type: string;
  properties: {
    name: string;
    zone?: string;
  };
  geometry: {
    type: string;
    coordinates: any[];
  };
}

// Create a wrapper component for the map to handle the Leaflet-specific props
const MapWrapper = ({ children, selectedServer, isClientSide }: { 
  children: React.ReactNode, 
  selectedServer: ServerData | null,
  isClientSide: boolean 
}) => {
   if (!isClientSide) return null;
  
  // We need to use require here to avoid SSR issues
  const { MapContainer, TileLayer, GeoJSON, Marker, useMap } = require('react-leaflet');
  
  // Create an internal MapController component that uses the useMap hook
  const MapController = ({ selectedServer }: { selectedServer: ServerData | null }) => {
    const map = useMap();
    
    useEffect(() => {
      if (selectedServer && map) {
        map.setView(
          [selectedServer.lat, selectedServer.lng], 
          4, 
          { animate: true, duration: 1.5 }
        );
      }
    }, [selectedServer, map]);
    
    return null;
  };
  
  return (
    <MapContainer
      center={[39.8283, -98.5795]}
      zoom={3}
      style={{ height: "100%", width: "100%" }}
      scrollWheelZoom={true}
      maxBounds={[
        [-60, -170],
        [75, 170],
      ]}
      maxBoundsViscosity={1.0}
      zoomControl={false}
      attributionControl={false}
      minZoom={2}
    >
      <TileLayer
        url="https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png"
      />
      
      {selectedServer && <MapController selectedServer={selectedServer} />}
      
      {children}
    </MapContainer>
  );
};

const CarbonFootprintDashboard = () => {
  const [modelSize, setModelSize] = useState("medium");
  const [location, setLocation] = useState("europe");
  const [optimizations, setOptimizations] = useState<string[]>([
    "quantization",
    "pruning",
  ]);
  const [serverData, setServerData] = useState<ServerData[]>([
    { id: 'us-east', name: 'US East (Virginia)', lat: 38.9072, lng: -77.0369, intensity: 420, provider: 'AWS', zone: 'US-MIDA-PJM' },
    { id: 'us-west', name: 'US West (California)', lat: 37.7749, lng: -122.4194, intensity: 320, provider: 'AWS', zone: 'US-CAL-CISO' },
    { id: 'us-northwest', name: 'US Northwest (Oregon)', lat: 45.5051, lng: -122.6750, intensity: 280, provider: 'AWS', zone: 'US-NW-PACW' },
    { id: 'eu-west', name: 'EU West (London)', lat: 51.5074, lng: -0.1278, intensity: 210, provider: 'AWS', zone: 'GB' },
    { id: 'asia-east', name: 'Asia East (Hong Kong)', lat: 22.3193, lng: 114.1694, intensity: 550, provider: 'AWS', zone: 'HK' }
  ]);
  const [selectedServer, setSelectedServer] = useState<ServerData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("map");
  const [isClient, setIsClient] = useState(false);
  const [geoJSONData, setGeoJSONData] = useState<GeoJSONFeature[]>([]);
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);

  const [forecastData, setForecastData] = useState<ForecastData[]>([]);
  
  // Create DefaultIcon only on client side
  const [defaultIcon, setDefaultIcon] = useState<any>(null);

  // Add new state for animation and live data simulation
  const [isLiveMode, setIsLiveMode] = useState(true); // Set to true by default
  const [liveUpdateInterval, setLiveUpdateInterval] = useState<NodeJS.Timeout | null>(null);
  const [dataUpdateTimestamp, setDataUpdateTimestamp] = useState<Date | null>(null);
  const [animatedIntensity, setAnimatedIntensity] = useState<number | null>(null);
  
  // Add new state for idle animations
  const [animationTimestamp, setAnimationTimestamp] = useState(new Date());
  const [randomMetrics, setRandomMetrics] = useState({
    cpuUsage: Math.floor(Math.random() * 30) + 10,
    memoryUsage: Math.floor(Math.random() * 40) + 30,
    networkTraffic: Math.floor(Math.random() * 50) + 20
  });
  
  // Update random metrics periodically for idle animations
  useEffect(() => {
    const idleAnimationInterval = setInterval(() => {
      setAnimationTimestamp(new Date());
      setRandomMetrics({
        cpuUsage: Math.max(5, Math.min(80, randomMetrics.cpuUsage + (Math.random() - 0.5) * 10)),
        memoryUsage: Math.max(20, Math.min(90, randomMetrics.memoryUsage + (Math.random() - 0.5) * 8)),
        networkTraffic: Math.max(10, Math.min(100, randomMetrics.networkTraffic + (Math.random() - 0.5) * 15))
      });
    }, 3000);
    
    return () => clearInterval(idleAnimationInterval);
  }, [randomMetrics]);

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (liveUpdateInterval) {
        clearInterval(liveUpdateInterval);
      }
    };
  }, [liveUpdateInterval]);

  // Function to start live updates
  function startLiveUpdates() {
    if (liveUpdateInterval) {
      clearInterval(liveUpdateInterval);
    }
    
    setIsLiveMode(true);
    setDataUpdateTimestamp(new Date());
    
    // Update data every 5 seconds
    const interval = setInterval(async () => {
      try {
        // Fetch real data from API instead of simulating
        await fetchCarbonData();
        setDataUpdateTimestamp(new Date());
        
        // If a server is selected, update its forecast data too
        if (selectedServer) {
          await fetchForecastForRegion(selectedServer.zone);
          
          // Animate the current intensity value
          setAnimatedIntensity(serverData.find(s => s.id === selectedServer.id)?.intensity || null);
        }
      } catch (error) {
        console.error("Error in live update interval:", error);
      }
    }, 5000);
    
    setLiveUpdateInterval(interval);
  }
  
  // Function to stop live updates
  function stopLiveUpdates() {
    if (liveUpdateInterval) {
      clearInterval(liveUpdateInterval);
      setLiveUpdateInterval(null);
    }
    setIsLiveMode(false);
  }

  // Initialize Leaflet-related items only on client side
  useEffect(() => {
    if (typeof window !== "undefined") {
      // Import the CSS inside the useEffect
      // @ts-ignore
      import('leaflet/dist/leaflet.css');
      
      // Now we're safely on the client side
      const icon = L.icon({
        iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
        shadowUrl:
          "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
      });

      setDefaultIcon(icon);
      L.Marker.prototype.options.icon = icon;
      setIsClient(true);
      
      // Load GeoJSON data for regions
      // No need to fetch from /api/geojson since it doesn't exist
      // Just use the fallback GeoJSON data directly
      setGeoJSONData([
        {
          type: "Feature",
          properties: { name: "Virginia", zone: "US-MIDA-PJM" },
          geometry: {
            type: "Polygon",
            coordinates: [[
              [-83.6754, 36.5407], [-83.3755, 37.2024], [-82.9344, 37.5311], [-82.5951, 37.8779], 
              [-81.9673, 38.1930], [-81.5262, 38.4169], [-80.8565, 38.5513], [-80.2988, 38.3510], 
              [-79.7673, 38.2701], [-79.0876, 38.0803], [-78.4143, 38.2065], [-77.8346, 38.3774], 
              [-77.4353, 38.6835], [-77.0569, 38.9344], [-76.9141, 38.8929], [-76.5859, 38.2065], 
              [-76.2421, 37.9571], [-76.3628, 37.5575], [-76.5421, 37.2157], [-76.3353, 36.9454], 
              [-76.0550, 36.8513], [-75.8672, 36.5510], [-75.9975, 36.5510], [-76.4531, 36.5510], 
              [-77.1475, 36.5510], [-77.8346, 36.5510], [-78.7988, 36.5510], [-79.6729, 36.5407], 
              [-80.5029, 36.5407], [-81.3755, 36.5407], [-82.2954, 36.5407], [-83.6754, 36.5407]
            ]]
          }
        },
        {
          type: "Feature",
          properties: { name: "California", zone: "US-CAL-CISO" },
          geometry: {
            type: "Polygon",
            coordinates: [[
              [-124.4096, 42.0095], [-124.2065, 41.9583], [-123.6255, 42.0095], [-123.1555, 42.0095], 
              [-122.5195, 42.0095], [-121.9297, 42.0095], [-121.2305, 42.0095], [-120.6201, 41.9959],
              [-120.0024, 41.9959], [-119.9988, 41.1836], [-119.9988, 40.4534], [-120.0061, 39.7988],
              [-120.0061, 39.0021], [-120.0024, 38.2471], [-120.0024, 37.5555], [-119.9988, 36.9946],
              [-119.9988, 36.4032], [-119.9988, 35.7959], [-119.9988, 35.0049], [-120.0024, 34.5642],
              [-120.0024, 34.0195], [-120.2539, 33.7207], [-120.5005, 33.4375], [-120.7837, 33.3398],
              [-121.0010, 33.2544], [-121.4648, 33.5156], [-121.9043, 33.7573], [-122.2461, 34.1455],
              [-122.5073, 34.5081], [-122.7539, 34.7461], [-123.0054, 35.0049], [-123.2568, 35.4980],
              [-123.5059, 36.0046], [-123.7573, 36.5625], [-123.9990, 37.2485], [-124.1235, 37.6416],
              [-124.2065, 38.0591], [-124.2896, 38.5156], [-124.3652, 39.0021], [-124.3896, 39.5068],
              [-124.4096, 40.0000], [-124.3408, 40.5151], [-124.2065, 41.0037], [-124.3066, 41.5088],
              [-124.4096, 42.0095]
            ]]
          }
        },
        {
          type: "Feature",
          properties: { name: "Oregon", zone: "US-NW-PACW" },
          geometry: {
            type: "Polygon",
            coordinates: [[
              [-124.5664, 46.2991], [-124.2432, 46.2991], [-124.0137, 45.7693], [-123.9111, 45.5278],
              [-123.4619, 45.7085], [-123.1787, 45.9521], [-122.8955, 45.9033], [-122.3853, 45.7046],
              [-121.9971, 45.6558], [-121.5356, 45.6069], [-121.2177, 45.7046], [-121.0840, 45.6069],
              [-120.6519, 45.7571], [-120.1611, 45.6558], [-119.6094, 45.8569], [-119.0576, 45.9033],
              [-118.9856, 45.9998], [-117.9602, 45.9033], [-116.9165, 45.9998], [-116.4633, 45.9998],
              [-116.4633, 44.9636], [-116.4633, 43.8509], [-116.4633, 42.8155], [-116.4633, 41.9918],
              [-117.1387, 41.9918], [-118.0078, 41.9918], [-119.3555, 41.9918], [-120.6689, 41.9918],
              [-122.0825, 41.9918], [-123.1982, 41.9918], [-124.5664, 41.9918], [-124.5664, 43.4541],
              [-124.5664, 44.5278], [-124.5664, 46.2991]
            ]]
          }
        },
        {
          type: "Feature",
          properties: { name: "Great Britain", zone: "GB" },
          geometry: {
            type: "Polygon",
            coordinates: [[
              [-5.7, 49.9], [-5.5, 50.1], [-4.9, 50.4], [-4.2, 51.2], [-5.3, 51.6], [-4.8, 52.0],
              [-4.5, 52.8], [-3.6, 53.4], [-3.1, 53.4], [-2.9, 53.8], [-3.6, 54.6], [-3.4, 55.0],
              [-2.7, 55.8], [-2.0, 56.0], [-2.5, 56.5], [-3.3, 56.8], [-2.4, 57.5], [-1.8, 57.6],
              [-2.0, 58.6], [-1.2, 58.4], [-0.2, 58.3], [0.2, 57.8], [0.3, 56.7], [0.5, 56.0],
              [1.5, 55.0], [1.8, 53.5], [1.4, 52.9], [1.6, 52.1], [1.3, 51.7], [1.4, 51.2],
              [0.7, 50.8], [0.0, 50.5], [-0.5, 50.1], [-1.9, 50.0], [-2.6, 50.2], [-3.6, 50.2],
              [-4.3, 50.3], [-5.7, 49.9]
            ]]
          }
        },
        {
          type: "Feature",
          properties: { name: "Hong Kong", zone: "HK" },
          geometry: {
            type: "Polygon",
            coordinates: [[
              [113.8, 22.1], [113.9, 22.2], [114.0, 22.3], [114.1, 22.4], [114.2, 22.5],
              [114.3, 22.5], [114.4, 22.4], [114.3, 22.3], [114.2, 22.2], [114.1, 22.1],
              [114.0, 22.1], [113.9, 22.1], [113.8, 22.1]
            ]]
          }
        }
      ]);
    }
  }, []);

  useEffect(() => {
    fetchCarbonData().then(() => {
      // After loading server data, fetch forecast for the first server
      if (serverData.length > 0 && !selectedServer) {
        const firstServer = serverData[0];
        fetchForecastForRegion(firstServer.zone);
      }
      
      // Start live updates by default
      startLiveUpdates();
    });
  }, []);
  
  // Fetch carbon intensity data from API
  const fetchCarbonData = async () => {
    setIsLoading(true);
    
    try {
      // Fetch all regions' data from our history API
      const response = await fetch('/api/history');
      
      let allRegionsData = [];
      
      try {
        // Try to parse the JSON response
        allRegionsData = await response.json();
      } catch (parseError) {
        console.error('Error parsing JSON response:', parseError);
        // If JSON parsing fails, throw an error to trigger the fallback
        throw new Error('Failed to parse API response as JSON');
      }
      
      
      // Group data by region
      const dataByRegion: Record<string, ForecastData[]> = {};
      allRegionsData.forEach((item: ForecastData) => {
        if (!dataByRegion[item.region]) {
          dataByRegion[item.region] = [];
        }
        dataByRegion[item.region].push(item);
      });
      
      // Update server data with the latest intensity values from each region
      const updatedServerData = serverData.map(server => {
        const regionData = dataByRegion[server.zone];
        if (regionData && regionData.length > 0) {
          // Sort by created_at to get the latest entry
          const sortedData = [...regionData].sort((a, b) => 
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
          return {
            ...server,
            intensity: sortedData[0].intensity
          };
        }
        return server;
      });
      
      setServerData(updatedServerData);
      
      // Set forecast data for the selected server or first server
      if (selectedServer) {
        const selectedRegionData = dataByRegion[selectedServer.zone];
        if (selectedRegionData) {
          // Sort chronologically for the graph
          const sortedData = [...selectedRegionData].sort((a, b) => 
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
          setForecastData(sortedData);
        }
      } else if (updatedServerData.length > 0) {
        const firstRegionData = dataByRegion[updatedServerData[0].zone];
        if (firstRegionData) {
          // Sort chronologically for the graph
          const sortedData = [...firstRegionData].sort((a, b) => 
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
          setForecastData(sortedData);
        }
      }
      
    } catch (error) {
      console.error('Error fetching carbon data:', error);
      // Fall back to random data if API fails
      const updatedData = serverData.map(server => ({
        ...server,
        intensity: server.intensity + (Math.random() > 0.5 ? 1 : -1) * Math.floor(Math.random() * 30)
      }));
      
      setServerData(updatedData);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch forecast data for a specific region
  const fetchForecastForRegion = async (zone: string) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/history');
      
      if (!response.ok) {
        throw new Error(`Failed to fetch forecast data for zone: ${zone}`);
      }
      
      // Check if the response is JSON before parsing
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('API did not return JSON data');
      }
      
      const allRegionsData = await response.json();
      
      // Filter data for the selected region
      const regionData = allRegionsData.filter((item: ForecastData) => item.region === zone);
      
      if (regionData.length > 0) {
        // Sort data by timestamp to ensure proper chronological order
        const sortedData = [...regionData].sort((a, b) => 
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        setForecastData(sortedData);
        console.log(`Loaded ${sortedData.length} data points for ${zone}`);
      } else {
        console.warn(`No data found for zone: ${zone}`);
        setForecastData([]);
      }
    } catch (error) {
      console.error(`Error fetching carbon data for zone ${zone}:`, error);
      setForecastData([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Mock data for the visualization
  const carbonData: CarbonData = {
    baseline: 1200, // kg CO2
    optimized: 320, // kg CO2
    renewable: 80, // kg CO2
  };

  // Calculate savings based on selected options
  const calculateSavings = (): CarbonData => {
    let multiplier = 1;

    // Model size impact
    if (modelSize === "small") multiplier *= 0.7;
    if (modelSize === "large") multiplier *= 1.4;

    // Location impact
    if (location === "europe") multiplier *= 0.85;
    if (location === "asia") multiplier *= 1.2;

    // Optimization impact
    const optimizationFactor = 1 - optimizations.length * 0.15;

    return {
      baseline: Math.round(carbonData.baseline * multiplier),
      optimized: Math.round(
        carbonData.optimized * multiplier * optimizationFactor
      ),
      renewable: Math.round(
        carbonData.renewable * multiplier * optimizationFactor
      ),
    };
  };

  const currentData = calculateSavings();
  const savingsPercentage = Math.round(
    ((currentData.baseline - currentData.renewable) / currentData.baseline) *
      100
  );

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
    if (typeof window === "undefined" || !isClient) return null;

    let color = "#10B981"; // green
    if (intensity >= 200 && intensity < 350) color = "#FBBF24"; // yellow
    if (intensity >= 350 && intensity < 500) color = "#F97316"; // orange
    if (intensity >= 500) color = "#EF4444"; // red

    // Create a pulsing animation for the markers
    const pulseAnimation = `
      @keyframes pulse {
        0% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.2); opacity: 0.8; }
        100% { transform: scale(1); opacity: 1; }
      }
    `;

    // Add the animation style to the document if it doesn't exist
    if (!document.getElementById('marker-animations')) {
      const styleEl = document.createElement('style');
      styleEl.id = 'marker-animations';
      styleEl.innerHTML = pulseAnimation;
      document.head.appendChild(styleEl);
    }

    // Create the marker with animation
    return L.divIcon({
      className: "custom-div-icon",
      html: `<div style="background-color: ${color}; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 10px; animation: pulse 2s infinite ease-in-out;">${
        intensity < 200 ? "✓" : ""
      }</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
  };
  
  // Get GeoJSON style based on region
  const getGeoJSONStyle = (feature: any) => {
    const zone = feature.properties.zone;
    const server = serverData.find(s => s.zone === zone);
    const isHovered = hoveredRegion === zone;
    const isSelected = selectedServer?.zone === zone;
    
    let fillColor = "#3f3f46"; // Default zinc-700
    let weight = 1;
    let opacity = 0.7;
    let fillOpacity = 0.2;
    
    if (server) {
      if (server.intensity < 200) fillColor = "#10B981"; // green-500
      else if (server.intensity < 350) fillColor = "#FBBF24"; // yellow-500
      else if (server.intensity < 500) fillColor = "#F97316"; // orange-500
      else fillColor = "#EF4444"; // red-500
    }
    
    if (isHovered) {
      weight = 2;
      opacity = 1;
      fillOpacity = 0.4;
    }
    
    if (isSelected) {
      weight = 3;
      opacity = 1;
      fillOpacity = 0.5;
    }
    
    return {
      fillColor,
      color: "#ffffff",
      weight,
      opacity,
      fillOpacity
    };
  };
  
  // Event handlers for GeoJSON features
  const onEachFeature = (feature: any, layer: any) => {
    const zone = feature.properties.zone;
    
    layer.on({
      mouseover: () => {
        setHoveredRegion(zone);
      },
      mouseout: () => {
        setHoveredRegion(null);
      },
      click: () => {
        const server = serverData.find(s => s.zone === zone);
        if (server) {
          handleServerSelect(server);
        }
      }
    });
  };
  
  // Handle server selection with animation
  const handleServerSelect = (server: ServerData) => {
    setSelectedServer(server);
    fetchForecastForRegion(server.zone);
    setAnimatedIntensity(server.intensity);
    // Hide the recommended server card after selection
    setShowRecommendedServer(false);
  };
  
  // Find the greenest server
  const greenestServer = [...serverData].sort(
    (a, b) => a.intensity - b.intensity
  )[0];
  
  // State for showing/hiding recommended server card
  const [showRecommendedServer, setShowRecommendedServer] = useState(true);

  //call the OpenAI API key
  const handleScheduleTraining = async () => {
    try {
      const response = await fetch("/api/openai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          prompt: "Write a haiku about AI",
        }),
      });

      const data = await response.json();
      console.log(data);
    } catch (error) {
      console.error("Error calling OpenAI API:", error);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-zinc-900 text-zinc-200">
      <header className="bg-zinc-800 p-4 shadow-sm flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">
            EcoLLM: Green AI Training Platform
          </h1>
          <p className="text-sm text-zinc-400">
            Minimize the carbon footprint of your large language models
          </p>
        </div>
        <div className="flex items-center space-x-4">
          {/* Add animated system status indicators */}
          <div className="hidden md:flex items-center space-x-3 mr-4 text-xs">
            <motion.div 
              className="flex items-center"
              animate={{ opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1"></div>
              <span className="text-green-400">System Online</span>
            </motion.div>
            <motion.div 
              className="flex items-center"
              initial={{ opacity: 0.8 }}
              animate={{ opacity: [0.8, 1, 0.8] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mr-1"></div>
              <span className="text-blue-400">CPU: {Math.round(randomMetrics.cpuUsage)}%</span>
            </motion.div>
            <motion.div 
              className="flex items-center"
              initial={{ opacity: 0.8 }}
              animate={{ opacity: [0.8, 1, 0.8] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-purple-500 mr-1"></div>
              <span className="text-purple-400">MEM: {Math.round(randomMetrics.memoryUsage)}%</span>
            </motion.div>
          </div>
          
          <div className="flex space-x-2">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className={`px-3 py-1 rounded-md text-sm ${
                activeTab === "map"
                  ? "bg-green-600 text-white"
                  : "bg-green-800 text-zinc-300"
              }`}
              onClick={() => setActiveTab("map")}
            >
              Global Map
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className={`px-3 py-1 rounded-md text-sm ${
                activeTab === "config"
                  ? "bg-green-600 text-white"
                  : "bg-green-800 text-zinc-300"
              }`}
              onClick={() => setActiveTab("config")}
            >
              Configuration
            </motion.button>
          </div>
        </div>
      </header>

      {/* Add a subtle animated border at the top with fixed animation properties */}
      <motion.div 
        className="h-0.5 bg-gradient-to-r from-green-600 via-blue-500 to-purple-600"
        animate={{ 
          backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"]
        }}
        transition={{ 
          duration: 15, 
          repeat: Infinity,
          ease: "linear",
          repeatType: "loop"
        }}
        style={{ backgroundSize: "200% 100%" }}
      />

      <div className="flex-1 overflow-hidden flex">
        {/* Main content area with map and scheduler */}
        <div className="flex-1 flex flex-col">
          {/* Map Section - Takes 70% of the height when scheduler is active */}
          <div
            className={`${
              activeTab === "scheduler" ? "h-[70%]" : "h-full"
            } relative`}
          >
            {isClient && (
              <MapWrapper selectedServer={selectedServer} isClientSide={isClient}>
                {/* GeoJSON overlays for regions */}
                {geoJSONData.map((feature, index) => {
                  // We need to use require here to avoid SSR issues
                  const { GeoJSON } = require('react-leaflet');
                  return (
                    <GeoJSON 
                      key={`geojson-${index}`}
                      data={feature}
                      style={getGeoJSONStyle}
                      onEachFeature={onEachFeature}
                    />
                  );
                })}
                
                {serverData.map(server => {
                  // We need to use require here to avoid SSR issues
                  const { Marker } = require('react-leaflet');
                  return (
                    <Marker 
                      key={server.id} 
                      position={[server.lat, server.lng]} 
                      icon={getIntensityIcon(server.intensity)}
                      eventHandlers={{
                        click: () => {
                          handleServerSelect(server);
                        },
                      }}
                    />
                  );
                })}
              </MapWrapper>
            )}

            {/* Map Controls Overlay */}
            <div className="absolute top-4 right-4 z-[1000] flex space-x-2">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-md text-sm flex items-center shadow-lg"
                onClick={fetchCarbonData}
                disabled={isLoading}
              >
                {isLoading ? "Updating..." : "Refresh Data"}
              </motion.button>
            </div>
            
            {/* Live update indicator */}
            {isLiveMode && dataUpdateTimestamp && (
              <div className="absolute bottom-4 right-4 z-[1000] bg-zinc-800 bg-opacity-80 text-zinc-200 text-xs px-3 py-1 rounded-md flex items-center shadow-lg">
                <motion.div 
                  className="w-2 h-2 rounded-full bg-green-500 mr-2"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                />
                <span>Live Mode • Last update: {dataUpdateTimestamp.toLocaleTimeString()}</span>
              </div>
            )}
            
            {/* Add floating data metrics */}
            <div className="absolute top-4 left-4 z-[1000] bg-zinc-800 bg-opacity-70 text-zinc-200 text-xs p-2 rounded-md shadow-lg border border-zinc-700">
              <div className="flex flex-col space-y-1">
                <motion.div 
                  className="flex justify-between items-center"
                  initial={{ opacity: 0.8 }}
                  animate={{ opacity: [0.8, 1, 0.8] }}
                  transition={{ duration: 4, repeat: Infinity }}
                >
                  <span className="text-zinc-400 mr-2">Global Average:</span>
                  <span className="font-medium">{Math.round(serverData.reduce((sum, server) => sum + server.intensity, 0) / serverData.length)} gCO₂/kWh</span>
                </motion.div>
                <motion.div 
                  className="flex justify-between items-center"
                  initial={{ opacity: 0.8 }}
                  animate={{ opacity: [0.8, 1, 0.8] }}
                  transition={{ duration: 4, repeat: Infinity, delay: 1 }}
                >
                  <span className="text-zinc-400 mr-2">Best Region:</span>
                  <span className="font-medium text-green-400">{greenestServer?.intensity} gCO₂/kWh</span>
                </motion.div>
                <motion.div 
                  className="flex justify-between items-center"
                  initial={{ opacity: 0.8 }}
                  animate={{ opacity: [0.8, 1, 0.8] }}
                  transition={{ duration: 4, repeat: Infinity, delay: 2 }}
                >
                  <span className="text-zinc-400 mr-2">Network:</span>
                  <span className="font-medium text-blue-400">{Math.round(randomMetrics.networkTraffic)} Mbps</span>
                </motion.div>
                <motion.div 
                  className="flex justify-between items-center"
                  initial={{ opacity: 0.8 }}
                  animate={{ opacity: [0.8, 1, 0.8] }}
                  transition={{ duration: 4, repeat: Infinity, delay: 3 }}
                >
                  <span className="text-zinc-400 mr-2">Last Scan:</span>
                  <span className="font-medium">{animationTimestamp.toLocaleTimeString()}</span>
                </motion.div>
              </div>
            </div>
          </div>

          {/* Scheduler Section - Only visible when scheduler tab is active, takes 30% of height */}
          <div className="h-[30%] bg-zinc-800 p-4 overflow-y-auto border-t border-zinc-700">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-lg font-semibold text-zinc-100 flex items-center">
                <motion.span
                  className="inline-block w-2 h-2 rounded-full bg-green-500 mr-2"
                  animate={{ 
                    scale: [1, 1.3, 1],
                    opacity: [0.7, 1, 0.7]
                  }}
                  transition={{ 
                    duration: 3,
                    repeat: Infinity,
                    repeatType: "reverse"
                  }}
                />
                Green Scheduler
              </h2>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-md text-sm"
                onClick={handleScheduleTraining}
              >
                Schedule Training
              </motion.button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="font-medium mb-2 text-zinc-200 text-sm">
                  Carbon Intensity Forecast
                </h3>
                <div className="h-20 bg-zinc-800 rounded-lg mb-1 relative border border-zinc-700">
                  {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <motion.div 
                        className="rounded-full h-6 w-6 border-t-2 border-green-500"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      />
                    </div>
                  ) : (
                    <div className="relative w-full h-full p-2">
                      {forecastData.length > 0 ? (
                        <div className="absolute left-2 top-0 h-full flex flex-col justify-between text-xs text-zinc-300 pr-1">
                          <motion.span
                            key={`max-${Math.max(...forecastData.map((d) => d.intensity))}`}
                            initial={{ opacity: 0, x: -5 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.3 }}
                          >
                            {Math.max(...forecastData.map((d) => d.intensity))}{" "}
                            gCO₂
                          </motion.span>
                          <motion.span
                            key={`min-${Math.min(...forecastData.map((d) => d.intensity))}`}
                            initial={{ opacity: 0, x: -5 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.3 }}
                          >
                            {Math.min(...forecastData.map((d) => d.intensity))}{" "}
                            gCO₂
                          </motion.span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full text-xs text-zinc-400">
                          No data available for this region
                        </div>
                      )}
                      <svg
                        viewBox="0 0 100 100"
                        className="w-full h-full pl-8"
                        preserveAspectRatio="none"
                      >
                        {forecastData.length > 0 && (
                          <>
                            {(() => {
                              const minIntensity = Math.min(
                                ...forecastData.map((d) => d.intensity)
                              );
                              const maxIntensity = Math.max(
                                ...forecastData.map((d) => d.intensity)
                              );
                              const range = maxIntensity - minIntensity;
                              const padding = range * 0.1; // 10% padding
                              const effectiveMin = Math.max(
                                0,
                                minIntensity - padding
                              );
                              const effectiveMax = maxIntensity + padding;

                              // Function to scale the y value
                              const scaleY = (value: number) =>
                                100 -
                                ((value - effectiveMin) /
                                  (effectiveMax - effectiveMin)) *
                                  100;

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
                                  <line
                                    x1="0"
                                    y1="0"
                                    x2="0"
                                    y2="100"
                                    stroke="#71717A"
                                    strokeWidth="1"
                                  />
                                  <line
                                    x1="0"
                                    y1="100"
                                    x2="100"
                                    y2="100"
                                    stroke="#71717A"
                                    strokeWidth="1"
                                  />

                                  {/* Area under the curve */}
                                  <motion.path
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 0.3 }}
                                    transition={{ duration: 0.5 }}
                                    d={`
                                      M0,${scaleY(forecastData[0].intensity)}
                                      ${forecastData
                                        .map(
                                          (data, index) =>
                                            `L${
                                              (index /
                                                (forecastData.length - 1)) *
                                              100
                                            },${scaleY(data.intensity)}`
                                        )
                                        .join(" ")}
                                      L100,100 L0,100 Z
                                    `}
                                    fill="url(#greenGradient)"
                                    opacity="0.3"
                                  />

                                  {/* Line chart - using path instead of polyline for consistent width */}
                                  <motion.path
                                    initial={{ pathLength: 0, opacity: 0 }}
                                    animate={{ pathLength: 1, opacity: 1 }}
                                    transition={{ duration: 1, ease: "easeInOut" }}
                                    d={`
                                      M0,${scaleY(forecastData[0].intensity)}
                                      ${forecastData
                                        .map(
                                          (data, index) =>
                                            `L${
                                              (index /
                                                (forecastData.length - 1)) *
                                              100
                                            },${scaleY(data.intensity)}`
                                        )
                                        .join(" ")}
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
                                    <motion.circle
                                      key={index}
                                      initial={{ scale: 0 }}
                                      animate={{ scale: 1 }}
                                      transition={{ 
                                        delay: index * 0.05, 
                                        duration: 0.3,
                                        type: "spring"
                                      }}
                                      cx={`${
                                        (index / (forecastData.length - 1)) *
                                        100
                                      }`}
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
                              <linearGradient
                                id="greenGradient"
                                x1="0%"
                                y1="0%"
                                x2="0%"
                                y2="100%"
                              >
                                <stop
                                  offset="0%"
                                  stopColor="#10B981"
                                  stopOpacity="0.8"
                                />
                                <stop
                                  offset="100%"
                                  stopColor="#10B981"
                                  stopOpacity="0.1"
                                />
                              </linearGradient>
                            </defs>
                          </>
                        )}
                      </svg>

                      {/* Tooltip */}
                      <div
                        id="carbon-tooltip"
                        className="absolute bg-zinc-900 text-white text-xs p-2 rounded shadow-lg z-10 pointer-events-none border border-zinc-600"
                        style={{
                          display: "none",
                          transform: "translate(-50%, -100%)",
                        }}
                      ></div>

                      {/* Invisible hover areas for tooltips */}
                      {forecastData.length > 0 &&
                        (() => {
                          const minIntensity = Math.min(
                            ...forecastData.map((d) => d.intensity)
                          );
                          const maxIntensity = Math.max(
                            ...forecastData.map((d) => d.intensity)
                          );
                          const range = maxIntensity - minIntensity;
                          const padding = range * 0.1;
                          const effectiveMin = Math.max(
                            0,
                            minIntensity - padding
                          );
                          const effectiveMax = maxIntensity + padding;

                          const scaleY = (value: number) =>
                            100 -
                            ((value - effectiveMin) /
                              (effectiveMax - effectiveMin)) *
                              100;

                          return forecastData.map((data, index) => (
                            <div
                              key={index}
                              className="absolute w-4 h-4 cursor-pointer"
                              style={{
                                left: `${
                                  (index / (forecastData.length - 1)) * 100
                                }%`,
                                top: `${scaleY(data.intensity)}%`,
                                transform: "translate(-50%, -50%)",
                              }}
                              onMouseOver={(e) => {
                                const tooltip =
                                  document.getElementById("carbon-tooltip");
                                if (tooltip) {
                                  const date = new Date(data.created_at);
                                  const formattedDate = date.toLocaleString(
                                    [], 
                                    { 
                                      month: 'short',
                                      day: 'numeric',
                                      hour: "2-digit", 
                                      minute: "2-digit" 
                                    }
                                  );
                                  tooltip.innerHTML = `<div class="font-medium">${data.intensity} gCO<sub>2</sub>/kWh</div><div>${formattedDate}</div>`;

                                  // Position the tooltip above the data point
                                  tooltip.style.left = `${
                                    (index / (forecastData.length - 1)) * 100
                                  }%`;
                                  tooltip.style.top = `${
                                    scaleY(data.intensity) - 10
                                  }%`;

                                  tooltip.style.display = "block";
                                }
                              }}
                              onMouseOut={() => {
                                const tooltip =
                                  document.getElementById("carbon-tooltip");
                                if (tooltip) {
                                  tooltip.style.display = "none";
                                }
                              }}
                            />
                          ));
                        })()}
                    </div>
                  )}
                </div>
                <div className="flex justify-between text-xs text-zinc-400">
                  {forecastData.length > 0 ? (
                    <>
                      <span>
                        {new Date(
                          forecastData[0].created_at
                        ).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span>
                        {forecastData.length > 2 &&
                          new Date(
                            forecastData[
                              Math.floor(forecastData.length / 2)
                            ].created_at
                          ).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                      </span>
                      <span>
                        {new Date(
                          forecastData[forecastData.length - 1].created_at
                        ).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </>
                  ) : (
                    <>
                      <span>-</span>
                      <span>No data available</span>
                      <span>-</span>
                    </>
                  )}
                </div>
              </div>

              <div>
                <h3 className="font-medium mb-2 text-zinc-200 text-sm">
                  Optimal Training Windows
                </h3>
                <div className="space-y-2">
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="p-2 bg-green-900 border border-green-700 rounded-lg flex justify-between items-center"
                  >
                    <div>
                      <p className="font-medium text-xs text-zinc-200">
                        Today, 3:00 AM - 7:00 AM
                      </p>
                      <p className="text-xs text-zinc-400">
                        EU North (Stockholm)
                      </p>
                    </div>
                    <div className="text-green-400 font-medium text-xs">
                      115 gCO<sub>2</sub>/kWh
                    </div>
                  </motion.div>

                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.1 }}
                    className="p-2 bg-green-900 border border-green-700 rounded-lg flex justify-between items-center"
                  >
                    <div>
                      <p className="font-medium text-xs text-zinc-200">
                        Tomorrow, 2:00 AM - 6:00 AM
                      </p>
                      <p className="text-xs text-zinc-400">US West (Oregon)</p>
                    </div>
                    <div className="text-green-400 font-medium text-xs">
                      130 gCO<sub>2</sub>/kWh
                    </div>
                  </motion.div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Side Panel - Always visible on desktop */}
        <div className="hidden md:block w-96 bg-zinc-800 shadow-lg overflow-y-auto">
          {activeTab === "config" && (
            <div className="p-4">
              <h2 className="text-lg font-semibold mb-4 text-zinc-100 flex items-center">
                <motion.div
                  className="inline-block w-3 h-3 rounded-full bg-blue-500 mr-2"
                  animate={{ 
                    boxShadow: [
                      "0 0 0 rgba(59, 130, 246, 0)",
                      "0 0 0 rgba(59, 130, 246, 0.4)",
                      "0 0 0 rgba(59, 130, 246, 0)"
                    ]
                  }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                Model Configuration
              </h2>

              {/* Carbon Footprint Overview */}
              <div className="mb-6">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="font-medium text-zinc-200">
                    Carbon Footprint
                  </h3>
                  <motion.span 
                    key={savingsPercentage}
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    className="bg-green-900 text-green-300 px-2 py-1 rounded-full text-xs font-medium"
                  >
                    {savingsPercentage}% Reduction
                  </motion.span>
                </div>

                <div className="flex space-x-2 mb-2">
                  <motion.div 
                    initial={{ height: 0 }}
                    animate={{ height: "auto" }}
                    transition={{ duration: 0.5 }}
                    className="flex-1 bg-red-900 p-2 rounded-lg text-center"
                  >
                    <p className="text-red-300 text-xs">Standard</p>
                    <motion.p 
                      key={currentData.baseline}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-sm font-bold text-red-200"
                    >
                      {currentData.baseline} kg
                    </motion.p>
                  </motion.div>
                  <motion.div 
                    initial={{ height: 0 }}
                    animate={{ height: "auto" }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                    className="flex-1 bg-yellow-900 p-2 rounded-lg text-center"
                  >
                    <p className="text-yellow-300 text-xs">Optimized</p>
                    <motion.p 
                      key={currentData.optimized}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-sm font-bold text-yellow-200"
                    >
                      {currentData.optimized} kg
                    </motion.p>
                  </motion.div>
                  <motion.div 
                    initial={{ height: 0 }}
                    animate={{ height: "auto" }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="flex-1 bg-green-900 p-2 rounded-lg text-center"
                  >
                    <p className="text-green-300 text-xs">Green Energy</p>
                    <motion.p 
                      key={currentData.renewable}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-sm font-bold text-green-200"
                    >
                      {currentData.renewable} kg
                    </motion.p>
                  </motion.div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">
                    Model Size
                  </label>
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
                  <label className="block text-sm text-zinc-400 mb-1">
                    Training Location
                  </label>
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
                        checked={optimizations.includes("quantization")}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setOptimizations([
                              ...optimizations,
                              "quantization",
                            ]);
                          } else {
                            setOptimizations(
                              optimizations.filter(
                                (item) => item !== "quantization"
                              )
                            );
                          }
                        }}
                      />
                      <span className="text-sm text-zinc-300">
                        Quantization (8-bit)
                      </span>
                    </label>

                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        className="mr-2 bg-zinc-700 border-zinc-600"
                        checked={optimizations.includes("pruning")}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setOptimizations([...optimizations, "pruning"]);
                          } else {
                            setOptimizations(
                              optimizations.filter((item) => item !== "pruning")
                            );
                          }
                        }}
                      />
                      <span className="text-sm text-zinc-300">
                        Weight Pruning
                      </span>
                    </label>

                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        className="mr-2 bg-zinc-700 border-zinc-600"
                        checked={optimizations.includes("distillation")}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setOptimizations([
                              ...optimizations,
                              "distillation",
                            ]);
                          } else {
                            setOptimizations(
                              optimizations.filter(
                                (item) => item !== "distillation"
                              )
                            );
                          }
                        }}
                      />
                      <span className="text-sm text-zinc-300">
                        Knowledge Distillation
                      </span>
                    </label>

                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        className="mr-2 bg-zinc-700 border-zinc-600"
                        checked={optimizations.includes("mixedprecision")}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setOptimizations([
                              ...optimizations,
                              "mixedprecision",
                            ]);
                          } else {
                            setOptimizations(
                              optimizations.filter(
                                (item) => item !== "mixedprecision"
                              )
                            );
                          }
                        }}
                      />
                      <span className="text-sm text-zinc-300">
                        Mixed Precision Training
                      </span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-zinc-400 mb-1">
                    Early Stopping Patience
                  </label>
                  <input
                    type="range"
                    className="w-full bg-zinc-700"
                    min="1"
                    max="10"
                    defaultValue="3"
                  />
                  <div className="flex justify-between text-xs text-zinc-400">
                    <span>Aggressive</span>
                    <span>Balanced</span>
                    <span>Conservative</span>
                  </div>
                </div>
              </div>

              {/* Add animated efficiency tips */}
              <motion.div 
                className="mt-6 p-3 border border-blue-800 bg-blue-900 bg-opacity-30 rounded-lg"
                initial={{ opacity: 0.9, y: 5 }}
                animate={{ 
                  opacity: [0.9, 1, 0.9],
                  y: [5, 0, 5]
                }}
                transition={{ 
                  duration: 6,
                  repeat: Infinity,
                  repeatType: "reverse"
                }}
              >
                <h3 className="text-sm font-medium text-blue-300 mb-1 flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2h-1V9z" clipRule="evenodd" />
                  </svg>
                  Efficiency Tip
                </h3>
                <p className="text-xs text-blue-200">
                  Training during low-carbon intensity periods can reduce emissions by up to 80% compared to peak hours.
                </p>
              </motion.div>
            </div>
          )}

          {activeTab === "map" && (
            <div className="p-4">
              <h2 className="text-lg font-semibold mb-4 text-zinc-100 flex items-center">
                <motion.div
                  className="inline-block w-3 h-3 rounded-full bg-green-500 mr-2"
                  animate={{ 
                    boxShadow: [
                      "0 0 0 rgba(16, 185, 129, 0)",
                      "0 0 0 rgba(16, 185, 129, 0.4)",
                      "0 0 0 rgba(16, 185, 129, 0)"
                    ]
                  }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                Server List
              </h2>

              {/* Selected server details - Integrated from popup */}
              <AnimatePresence>
                {selectedServer && (
                  <motion.div 
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    className="p-3 border border-zinc-700 rounded-lg bg-zinc-700 mb-4"
                  >
                    <div className="flex justify-between items-start">
                      <h3 className="font-medium text-zinc-200">
                        {selectedServer.name} Details
                      </h3>
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
                        <p className="font-medium text-zinc-200">
                          {selectedServer.provider}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-zinc-400">Carbon Intensity</p>
                        <motion.p 
                          key={selectedServer.intensity}
                          initial={{ color: "#ffffff" }}
                          animate={{ color: selectedServer.intensity < 200 ? "#10B981" : 
                                           selectedServer.intensity < 350 ? "#FBBF24" : 
                                           selectedServer.intensity < 500 ? "#F97316" : "#EF4444" }}
                          className="font-medium text-zinc-200"
                        >
                          {animatedIntensity !== null ? (
                            <motion.span
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              key={animatedIntensity}
                            >
                              {animatedIntensity}
                            </motion.span>
                          ) : (
                            selectedServer.intensity
                          )} gCO<sub>2</sub>/kWh
                        </motion.p>
                      </div>
                      <div>
                        <p className="text-sm text-zinc-400">Location</p>
                        <p className="font-medium text-zinc-200">
                          {selectedServer.lat.toFixed(2)},{" "}
                          {selectedServer.lng.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-zinc-400">Estimated Savings</p>
                        <motion.p 
                          key={Math.round((550 - selectedServer.intensity) / 5.5)}
                          initial={{ scale: 0.9 }}
                          animate={{ scale: 1 }}
                          className="font-medium text-green-500"
                        >
                          {Math.round((550 - selectedServer.intensity) / 5.5)}%
                          vs. worst region
                        </motion.p>
                      </div>
                    </div>

                                        {/* Integrated NotebookUploader */}
                                        <div className="mt-3 border-t border-zinc-600 pt-2">
                      <NotebookUploader compact={true} />
                    </div>
                    {/* <div className="mt-2">
                      <button 
                        className="w-full bg-green-600 hover:bg-green-700 text-white py-1 rounded-md text-sm"
                        onClick={handleScheduleTraining}
                      >
                        Schedule Training on This Server
                      </button>
                    </div> */}
                    

                  </motion.div>
                )}
              </AnimatePresence>

              {/* Recommended server section - now in sidebar */}
              {showRecommendedServer && greenestServer && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.4 }}
                  className="p-3 bg-zinc-700 rounded-lg mb-4"
                >
                  <h3 className="font-medium mb-1 text-zinc-200 flex items-center">
                    <motion.div
                      className="w-2 h-2 rounded-full bg-green-500 mr-1"
                      animate={{ 
                        scale: [1, 1.2, 1],
                        opacity: [1, 0.8, 1]
                      }}
                      transition={{ 
                        duration: 2,
                        repeat: Infinity,
                        repeatType: "reverse"
                      }}
                    />
                    Recommended Server
                  </h3>
                  
                  <motion.div 
                    className="flex items-center justify-between"
                    initial={{ x: -10, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  >
                    <div>
                      <span className="font-medium text-zinc-200">
                        {greenestServer.name}
                      </span>
                      <p className="text-sm text-zinc-400">
                        {greenestServer.provider}
                      </p>
                    </div>
                    <div className="flex flex-col items-end">
                      <div className="flex items-center">
                        <motion.div
                          className={`w-3 h-3 rounded-full ${getIntensityColor(
                            greenestServer.intensity
                          )} mr-2`}
                          animate={{ 
                            scale: [1, 1.2, 1],
                            opacity: [1, 0.8, 1]
                          }}
                          transition={{ 
                            duration: 2,
                            repeat: Infinity,
                            repeatType: "reverse"
                          }}
                        />
                        <span className="font-medium text-zinc-200">
                          {greenestServer.intensity} gCO<sub>2</sub>/kWh
                        </span>
                      </div>
                      <motion.button 
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-md text-sm mt-2"
                        onClick={() => handleServerSelect(greenestServer)}
                      >
                        Select Server
                      </motion.button>
                    </div>
                  </motion.div>
                </motion.div>
              )}

              <div className="overflow-hidden rounded-lg border border-zinc-700">
                <table className="min-w-full divide-y divide-zinc-700">
                  <thead className="bg-zinc-700">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                        Location
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                        Provider
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                        Carbon
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-zinc-800 divide-y divide-zinc-700">
                    {serverData
                      .sort((a, b) => a.intensity - b.intensity)
                      .map((server, index) => (
                        <motion.tr
                          key={server.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.05, duration: 0.3 }}
                          className={`${
                            selectedServer?.id === server.id
                              ? "bg-zinc-700"
                              : ""
                          } cursor-pointer hover:bg-zinc-700`}
                          onClick={() => {
                            handleServerSelect(server);
                          }}
                        >
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="text-sm font-medium text-zinc-200">
                              {server.name}
                              {isLiveMode && server.id === selectedServer?.id && (
                                <motion.span 
                                  className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-green-500"
                                  animate={{ opacity: [1, 0.3, 1] }}
                                  transition={{ duration: 1.5, repeat: Infinity }}
                                />
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="text-sm text-zinc-400">
                              {server.provider}
                            </div>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="flex items-center">
                              <div
                                className={`w-3 h-3 rounded-full ${getIntensityColor(
                                  server.intensity
                                )} mr-2`}
                              ></div>
                              <motion.div 
                                key={server.intensity}
                                className="text-sm text-zinc-200"
                                initial={{ opacity: 0.7 }}
                                animate={{ opacity: 1 }}
                                transition={{ duration: 0.3 }}
                              >
                                {server.intensity}
                              </motion.div>
                              {isLiveMode && server.id === selectedServer?.id && (
                                <motion.span 
                                  className="ml-1 text-xs text-green-400"
                                  initial={{ opacity: 0, x: -5 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  exit={{ opacity: 0, x: 5 }}
                                >
                                  live
                                </motion.span>
                              )}
                            </div>
                          </td>
                        </motion.tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {/* Add animated carbon savings counter */}
              <motion.div 
                className="mt-4 p-3 border border-green-800 bg-green-900 bg-opacity-30 rounded-lg"
                initial={{ opacity: 0.9 }}
                animate={{ 
                  opacity: [0.9, 1, 0.9],
                }}
                transition={{ 
                  duration: 4,
                  repeat: Infinity,
                  repeatType: "reverse"
                }}
              >
                <h3 className="text-sm font-medium text-green-300 mb-1">Carbon Savings Tracker</h3>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-green-200">Potential Monthly Savings:</span>
                  <motion.span 
                    className="text-sm font-bold text-green-300"
                    initial={{ opacity: 0.9 }}
                    animate={{ 
                      opacity: [0.9, 1, 0.9],
                      scale: [1, 1.03, 1]
                    }}
                    transition={{ 
                      duration: 3,
                      repeat: Infinity,
                      repeatType: "reverse"
                    }}
                  >
                    {Math.round(550 - greenestServer?.intensity) * 24 * 30 / 1000} kg CO₂
                  </motion.span>
                </div>
                <div className="w-full bg-green-800 bg-opacity-30 h-1.5 rounded-full mt-1 overflow-hidden">
                  <motion.div 
                    className="h-full bg-green-500"
                    initial={{ width: "0%" }}
                    animate={{ width: `${Math.min(100, (550 - (greenestServer?.intensity || 0)) / 5.5)}%` }}
                    transition={{ duration: 1.5, ease: "easeOut" }}
                  />
                </div>
              </motion.div>
            </div>
          )}

          {activeTab === "notebook" && (
            <div className="p-4">
              <h2 className="text-lg font-semibold mb-4 text-zinc-100 flex items-center">
                <motion.div
                  className="inline-block w-3 h-3 rounded-full bg-green-500 mr-2"
                  animate={{ 
                    boxShadow: [
                      "0 0 0 rgba(34, 197, 94, 0)",
                      "0 0 0 rgba(34, 197, 94, 0.4)",
                      "0 0 0 rgba(34, 197, 94, 0)"
                    ]
                  }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                Jupyter Notebook
              </h2>
              
              <NotebookUploader />
            </div>
          )}

          {/* Removed standalone "Run Training" section */}
        </div>
      </div>

      {/* Notification system */}
      <AnimatePresence>
        {isLiveMode && dataUpdateTimestamp && (
          <motion.div 
            id="live-notification"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed bottom-4 left-4 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg p-3 max-w-xs z-50"
          >
            <div className="flex items-start">
              <div className="flex-shrink-0 mt-0.5">
                <motion.div 
                  className="w-3 h-3 rounded-full bg-green-500"
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
              </div>
              {/* <div className="ml-3">
                <h3 className="text-sm font-medium text-zinc-200">Live Dashboard Active</h3>
                <p className="mt-1 text-xs text-zinc-400">
                  Data is being updated in real-time from the API. Carbon intensity values reflect current grid conditions.
                </p>
              </div> */}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add floating particles with fixed animation properties */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {[...Array(8)].map((_, i) => (
          <motion.div
            key={`particle-${i}`}
            className="absolute w-2 h-2 rounded-full bg-green-500 opacity-20"
            initial={{ 
              x: `${Math.random() * 100}%`, 
              y: `${Math.random() * 100}%`,
              opacity: 0.1 + Math.random() * 0.2
            }}
            animate={{ 
              x: [
                `${Math.random() * 100}%`, 
                `${Math.random() * 100}%`, 
                `${Math.random() * 100}%`
              ],
              y: [
                `${Math.random() * 100}%`, 
                `${Math.random() * 100}%`, 
                `${Math.random() * 100}%`
              ],
              opacity: [
                0.1 + Math.random() * 0.2, 
                0.1 + Math.random() * 0.2, 
                0.1 + Math.random() * 0.2
              ]
            }}
            transition={{ 
              duration: 20 + Math.random() * 10,
              repeat: Infinity,
              ease: "linear"
            }}
          />
        ))}
      </div>

      {/* Loading indicator - non-intrusive version */}
      <AnimatePresence>
        {isLoading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed bottom-4 right-4 z-[1000]"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-zinc-800 rounded-lg p-3 shadow-xl flex items-center space-x-3 border border-zinc-700"
            >
              <motion.div 
                className="w-5 h-5 border-2 border-t-green-500 border-zinc-600 rounded-full"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              />
              <p className="text-sm text-zinc-300">
                Updating data...
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CarbonFootprintDashboard;
