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
  'US-NY-NYIS': 'co2-intensity-nyiso',
  'US-CAL-CISO': 'co2-intensity-cali',
  'US-SW-PNM': 'co2-intensity-newmex'
}

// API tokens for different regions
const API_TOKENS = {
  'US-NY-NYIS': process.env.NY_AUTH_TOKEN || '',
  'US-CAL-CISO': process.env.CALI_AUTH_TOKEN || '',
  'US-SW-PNM': process.env.NEWMEX_AUTH_TOKEN || ''
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

export async function GET(request: Request) {
  try {
    // Get the region from the request header
    const region = request.headers.get('x-region') || 'US-NY-NYIS';
    
    // Validate region
    if (!CACHE_KEYS[region as keyof typeof CACHE_KEYS]) {
      return NextResponse.json(
        { error: 'Invalid region specified' },
        { status: 400 }
      )
    }
    
    const cacheKey = CACHE_KEYS[region as keyof typeof CACHE_KEYS];
    const apiToken = API_TOKENS[region as keyof typeof API_TOKENS];
    const apiUrl = getApiUrl(region);
    
    // Check if we have cached data
    const cachedData = await redis.get<TransformedHistoryItem[]>(cacheKey)
    
    if (cachedData) {
      console.log(`Returning cached CO2 intensity data for ${region}`)
      return NextResponse.json(cachedData)
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
      throw new Error(`API request failed with status ${response.status}`)
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
    
    return NextResponse.json(transformedData)
  } catch (error) {
    console.error('Error fetching CO2 intensity data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch CO2 intensity data' },
      { status: 500 }
    )
  }
}