import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';

export const dynamic = 'force-dynamic';

export async function GET() {
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    try {
        // Get ALL records to see full history
        const { data, error, count } = await supabase
            .from('market_levels')
            .select('timestamp, support_price, resistance_price, gamma_high_price, gamma_low_price', { count: 'exact' })
            .order('timestamp', { ascending: true })
            .limit(1000);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // Group by hour to see variation over time
        const hourlyData: Record<string, { minS: number, maxS: number, minR: number, maxR: number, count: number }> = {};

        for (const r of data || []) {
            const hour = r.timestamp.substring(0, 13); // YYYY-MM-DDTHH
            if (!hourlyData[hour]) {
                hourlyData[hour] = {
                    minS: r.support_price, maxS: r.support_price,
                    minR: r.resistance_price, maxR: r.resistance_price,
                    count: 0
                };
            }
            hourlyData[hour].minS = Math.min(hourlyData[hour].minS, r.support_price);
            hourlyData[hour].maxS = Math.max(hourlyData[hour].maxS, r.support_price);
            hourlyData[hour].minR = Math.min(hourlyData[hour].minR, r.resistance_price);
            hourlyData[hour].maxR = Math.max(hourlyData[hour].maxR, r.resistance_price);
            hourlyData[hour].count++;
        }

        // Find overall min/max
        let overallMinS = Infinity, overallMaxS = -Infinity;
        let overallMinR = Infinity, overallMaxR = -Infinity;

        for (const r of data || []) {
            overallMinS = Math.min(overallMinS, r.support_price);
            overallMaxS = Math.max(overallMaxS, r.support_price);
            overallMinR = Math.min(overallMinR, r.resistance_price);
            overallMaxR = Math.max(overallMaxR, r.resistance_price);
        }

        return NextResponse.json({
            totalRecords: count,
            fetchedRecords: data?.length || 0,
            oldestRecord: data?.[0]?.timestamp,
            newestRecord: data?.[data?.length - 1]?.timestamp,
            supportRange: {
                min: Math.round(overallMinS),
                max: Math.round(overallMaxS),
                variation: Math.round(overallMaxS - overallMinS)
            },
            resistanceRange: {
                min: Math.round(overallMinR),
                max: Math.round(overallMaxR),
                variation: Math.round(overallMaxR - overallMinR)
            },
            hourlyBreakdown: Object.entries(hourlyData).map(([hour, stats]) => ({
                hour,
                supportRange: `${Math.round(stats.minS)} - ${Math.round(stats.maxS)}`,
                resistanceRange: `${Math.round(stats.minR)} - ${Math.round(stats.maxR)}`,
                records: stats.count
            }))
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
