"use client"

import React, { useState, useEffect } from 'react';

const ServerMap = () => {
    return (
      <div className="bg-white p-6 rounded-lg shadow">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Global Server Carbon Intensity</h2>
        <div className="flex items-center">
          <button 
            className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-md text-sm flex items-center"
            onClick={fetchCarbonData}
            // disabled={isLoading}
          >
            {/* {isLoading ? "Updating..." : "Refresh Data"} */}
          </button>
        </div>
      </div>
      
      <div className="mb-4">
        <div className="p-4 bg-green-50 rounded-lg mb-4">
          <h3 className="font-medium mb-2">Recommended Server</h3>
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
      </div>
      
      {/* World Map Visualization */}
      <div className="relative h-64 bg-blue-50 rounded-lg mb-4 overflow-hidden">
        {/* Simple world map outline */}
        <div className="absolute inset-0 p-4">
          <img src="/api/placeholder/800/400" alt="World Map Placeholder" className="w-full h-full object-contain opacity-20" />
          
          {/* Server location markers */}
          {serverData.map(server => (
            <div 
              key={server.id} 
              className="absolute cursor-pointer transform -translate-x-1/2 -translate-y-1/2"
              style={{
                top: `${(90 - server.lat) / 180 * 100}%`,
                left: `${(180 + server.lng) / 360 * 100}%`
              }}
              onClick={() => setSelectedServer(server)}
            >
              <div className={`w-4 h-4 rounded-full ${getIntensityColor(server.intensity)} border-2 border-white`}></div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Server list */}
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Location</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Provider</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Carbon Intensity</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {serverData.sort((a, b) => a.intensity - b.intensity).map(server => (
              <tr key={server.id} className={selectedServer?.id === server.id ? "bg-blue-50" : ""}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">{server.name}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-500">{server.provider}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className={`w-3 h-3 rounded-full ${getIntensityColor(server.intensity)} mr-2`}></div>
                    <div className="text-sm text-gray-900">{server.intensity} gCO<sub>2</sub>/kWh</div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <button 
                    className="text-blue-600 hover:text-blue-900"
                    onClick={() => setSelectedServer(server)}
                  >
                    View Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Selected server details modal */}
      {selectedServer && (
        <div className="mt-4 p-4 border border-gray-200 rounded-lg bg-gray-50">
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
          <div className="mt-4">
            <button className="w-full bg-green-500 hover:bg-green-600 text-white py-2 rounded-md">
              Schedule Training on This Server
            </button>
          </div>
        </div>
      )}
    </div>
  )}
    )
}

export default ServerMap;