// app/api/co2-intensity/route.ts
import { Redis } from '@upstash/redis'
import { NextResponse } from 'next/server'

// Initialize Redis client
const redis = new Redis({
  url: process.env.REDIS_URL || '',
  token: process.env.REDIS_TOKEN || '',
})

const CACHE_KEY = 'co2-intensity-nyiso'
const CACHE_TTL = 60 * 60 // 1 hour in seconds
const getApiUrl = () => {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 1); // 24 hours ago
  
  const formatDate = (date: Date) => {
    return date.toISOString().split('T')[0]; // Format as YYYY-MM-DD
  };
  
  return `https://api.electricitymap.org/v3/carbon-intensity/past-range?zone=US-NY-NYIS&start=${formatDate(start)}&end=${formatDate(end)}`;
};

const API_URL = getApiUrl();
const API_KEY = process.env.NY_AUTH_TOKEN || ''

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

export async function GET() {
  try {
    // Check if we have cached data
    const cachedData = await redis.get<TransformedHistoryItem[]>(CACHE_KEY)
    
    if (cachedData) {
      console.log('Returning cached CO2 intensity data')
      return NextResponse.json(cachedData)
    }
    
    // No cache or expired, fetch from API
    console.log('Fetching fresh CO2 intensity data from API')
    const response = await fetch(API_URL, {
      headers: {
        'auth-token': API_KEY || '',
      },
    })
    
    if (!response.ok) {
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
    await redis.set(CACHE_KEY, transformedData, { ex: CACHE_TTL })
    
    return NextResponse.json(transformedData)
  } catch (error) {
    console.error('Error fetching CO2 intensity data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch CO2 intensity data' },
      { status: 500 }
    )
  }
}