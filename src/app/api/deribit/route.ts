import { NextRequest, NextResponse } from 'next/server';

const DERIBIT_API_BASE = 'https://www.deribit.com/api/v2';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const endpoint = searchParams.get('endpoint');

    if (!endpoint) {
        return NextResponse.json({ error: 'Missing endpoint parameter' }, { status: 400 });
    }

    // Build the Deribit URL
    const url = new URL(`${DERIBIT_API_BASE}${endpoint}`);

    // Forward all other query params
    searchParams.forEach((value, key) => {
        if (key !== 'endpoint') {
            url.searchParams.append(key, value);
        }
    });

    try {
        const response = await fetch(url.toString(), {
            headers: {
                'Content-Type': 'application/json',
            },
            next: { revalidate: 10 }, // Cache for 10 seconds only
        });

        if (!response.ok) {
            throw new Error(`Deribit API error: ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
            return NextResponse.json({ error: data.error.message }, { status: 400 });
        }

        // Return with cache control headers to prevent stale data
        return NextResponse.json(data.result, {
            headers: {
                'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30',
            },
        });
    } catch (error) {
        console.error('Deribit API proxy error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch from Deribit API' },
            { status: 500 }
        );
    }
}
