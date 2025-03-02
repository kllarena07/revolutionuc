// app/api/co2-intensity/route.ts
import { Redis } from '@upstash/redis'
import { NextResponse } from 'next/server'

// Initialize Redis client
const redis = new Redis({
  url: process.env.REDIS_URL || '',
  token: process.env.REDIS_TOKEN || '',
})

// Cache keys for different regions
const CACHE_KEYS = {
  'US-MIDA-PJM': 'co2-intensity-mida',
  'US-CAL-CISO': 'co2-intensity-cali',
  'US-NW-PACW': 'co2-intensity-oregon',
  'HK': 'co2-intensity-hk',
  'GB': 'co2-intensity-gb'
}

// API tokens for different regions
const API_TOKENS = {
  'US-MIDA-PJM': process.env.VA_AUTH_TOKEN || '',
  'US-CAL-CISO': process.env.CALI_AUTH_TOKEN || '',
  'US-NW-PACW': process.env.OREGON_AUTH_TOKEN || '',
  'HK': process.env.HK_AUTH_TOKEN || '',
  'GB': process.env.GB_AUTH_TOKEN || ''
}

const CACHE_TTL = 60 * 60 // 1 hour in seconds

const getApiUrl = (zone: string) => {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 1); // 24 hours ago
  
  const formatDate = (date: Date) => {
    return date.toISOString().split('T')[0]; // Format as YYYY-MM-DD
  };
  
  return `https://api.electricitymap.org/v3/carbon-intensity/history?zone=${zone}`;
};

type RawHistoryItem = {
  zone: string
  carbonIntensity: number
  datetime: string
  updatedAt: string
  createdAt: string
  emissionFactorType: string
  isEstimated: boolean
  estimationMethod: string | null
}

type TransformedHistoryItem = {
  region: string
  created_at: string
  intensity: number
}

async function fetchRegionData(region: string): Promise<TransformedHistoryItem[]> {
  const cacheKey = CACHE_KEYS[region as keyof typeof CACHE_KEYS];
  const apiToken = API_TOKENS[region as keyof typeof API_TOKENS];
  const apiUrl = getApiUrl(region);
  
  // Check if we have cached data
  const cachedData = await redis.get<TransformedHistoryItem[]>(cacheKey)
  
  if (cachedData) {
    console.log(`Returning cached CO2 intensity data for ${region}`)
    return cachedData
  }
  
  // No cache or expired, fetch from API
  console.log(`Fetching fresh CO2 intensity data from API for ${region}`)
  const response = await fetch(apiUrl, {
    headers: {
      'auth-token': apiToken,
    },
  })
  
  if (!response.ok) {
    console.log(response)
    throw new Error(`API request failed with status ${response.status} for region ${region}`)
  }
  
  const data = await response.json()
  
  // Transform the data to match the desired schema
  const transformedData = data.history.map((item: RawHistoryItem): TransformedHistoryItem => ({
    region: item.zone,
    created_at: item.datetime,
    intensity: item.carbonIntensity,
  }))
  
  // Cache the transformed data
  await redis.set(cacheKey, transformedData, { ex: CACHE_TTL })
  
  return transformedData
}

export async function GET() {
  try {
    // Get all regions
    const regions = Object.keys(CACHE_KEYS);
    
    // Fetch data for all regions in parallel
    const allDataPromises = regions.map(region => 
      fetchRegionData(region)
        .catch(error => {
          console.error(`Error fetching data for ${region}:`, error);
          return [] as TransformedHistoryItem[]; // Return empty array if region fetch fails
        })
    );
    
    const allRegionsData = await Promise.all(allDataPromises);
    
    // Combine all region data into a single array
    const combinedData = allRegionsData.flat();
    
    return NextResponse.json(combinedData);
  } catch (error) {
    console.error('Error fetching CO2 intensity data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch CO2 intensity data' },
      { status: 500 }
    )
  }
}