import { NextResponse } from "next/server";

interface TokenZonePair {
  token: string;
  zone: string;
}

const apiKeys = {
  CALI_AUTH_TOKEN: process.env.CALI_AUTH_TOKEN as string,
  NY_AUTH_TOKEN: process.env.NY_AUTH_TOKEN as string,
  NEWMEX_AUTH_TOKEN: process.env.NEWMEX_AUTH_TOKEN as string,
};

const zones = {
  CALI_ZONE: "US-CAL-CISO",
  NY_ZONE: "US-NY-NYIS",
  NEWMEX_ZONE: "US-SW-PNM",
};

async function fetchCarbonIntensity(token: string, zone: string) {
  const response = await fetch(
    `https://api.electricitymap.org/v3/carbon-intensity/latest?zone=${zone}`,
    {
      method: "GET",
      headers: {
        "auth-token": token,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch data for zone: ${zone}`);
  }

  return response.json();
}

export async function GET() {
  // Create an array of objects containing both token and zone
  const tokenZonePairs = Object.keys(apiKeys).map((key) => {
    const zoneKey = key.replace("AUTH_TOKEN", "ZONE");
    const token = apiKeys[key as keyof typeof apiKeys];
    const zone = zones[zoneKey as keyof typeof zones];

    return { token, zone }; // Return an object with token and zone
  });

  // Iterate through each token-zone pair and fetch data
  const dataPromises = tokenZonePairs.map(({ token, zone }) => {
    return fetchCarbonIntensity(token, zone);
  });

  try {
    // Wait for all fetch requests to resolve
    const results = await Promise.all(dataPromises);
    return NextResponse.json(results); // Return the results as JSON
  } catch (error) {
    console.error(error);
    return NextResponse.error(); // Return error if any fetch fails
  }
}
