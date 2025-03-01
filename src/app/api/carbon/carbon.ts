import { NextResponse } from "next/server";

export async function GET() {
  try {
    const response = await fetch(
      "https://api.electricitymap.org/v3/carbon-intensity/latest?zone=US-CAL-CISO",
      {
        method: "GET",
        headers: {
          "auth-token": "M0AjKIjkQUJLZwf7A3TG",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Error: ${response.statusText}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
