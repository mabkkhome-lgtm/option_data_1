
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        let allRows: any[] = [];
        let offset = 0;
        const CHUNK_SIZE = 1000;
        const MAX_ROWS = 50000; // Cap to prevent infinite loops

        // Pagination Loop
        while (allRows.length < MAX_ROWS) {
            const { data, error } = await supabase
                .from('market_levels')
                .select('*')
                .order('timestamp', { ascending: false })
                .range(offset, offset + CHUNK_SIZE - 1);

            if (error) {
                console.error('Fetch Error:', error);
                throw error;
            }

            if (!data || data.length === 0) {
                break;
            }

            allRows.push(...data);

            if (data.length < CHUNK_SIZE) {
                break; // Reached end of table
            }

            offset += CHUNK_SIZE;
        }

        console.log(`[API] Detched total ${allRows.length} rows`);

        // Filter valid rows (S != R) > 0.01
        const filtered = allRows.filter((d: any) => {
            return Math.abs(d.support_price - d.resistance_price) > 0.01;
        });

        // Normalize Timestamps
        const normalized = filtered.map((d: any) => {
            let ts: number;
            // Handle String vs Number
            if (typeof d.timestamp === 'string') {
                ts = new Date(d.timestamp).getTime();
            } else {
                ts = d.timestamp as number;
            }

            // Normalization Logic (Target: Seconds ~ 1.7e9)
            // If MS (1.7e12) -> / 1000
            if (ts > 10000000000) {
                ts = Math.floor(ts / 1000);
            }

            // Safety Force Logic (fix 1970 issue if any)
            // If < 1.6e9 -> * 1000
            while (ts < 1600000000) {
                ts = ts * 1000;
            }
            // If > 2.5e9 -> / 1000 (Safety)
            while (ts > 2500000000) {
                ts = ts / 1000;
            }

            return {
                timestamp: Math.floor(ts),
                // Map DB field names to chart-expected names
                support: d.support_price,
                resistance: d.resistance_price,
                gammaHigh: d.gamma_high_price,
                gammaLow: d.gamma_low_price
            };
        });

        // Process immature hours: For 00:00-08:00 CET of each day, use previous day's 23:55 values
        // This is because new contracts for next expiry aren't mature enough
        const processedData = normalized.map((item: any, index: number, arr: any[]) => {
            const date = new Date(item.timestamp * 1000);
            // Convert to CET for hour check
            const cetHour = parseInt(date.toLocaleString('en-US', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }));

            // If between 00:00 and 08:00 CET
            if (cetHour >= 0 && cetHour < 8) {
                // Find the previous day's ~23:55 value
                // Calculate the start of this CET day
                const cetDateStr = date.toLocaleString('en-US', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });

                // Look for a value from the previous day around 23:00-23:59
                const prevDayEndValue = arr.find((d: any) => {
                    const dDate = new Date(d.timestamp * 1000);
                    const dCetHour = parseInt(dDate.toLocaleString('en-US', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }));
                    const dCetDateStr = dDate.toLocaleString('en-US', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });

                    // Different day and hour is 23
                    return dCetDateStr !== cetDateStr && dCetHour === 23 && d.timestamp < item.timestamp;
                });

                if (prevDayEndValue) {
                    return {
                        ...item,
                        support: prevDayEndValue.support,
                        resistance: prevDayEndValue.resistance,
                        gammaHigh: prevDayEndValue.gammaHigh,
                        gammaLow: prevDayEndValue.gammaLow
                    };
                }
            }

            return item;
        });

        return NextResponse.json({
            success: true,
            count: processedData.length,
            data: processedData
        }, {
            headers: {
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                'Pragma': 'no-cache'
            }
        });

    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
