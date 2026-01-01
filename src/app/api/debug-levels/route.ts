import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';

export const dynamic = 'force-dynamic';

export async function GET() {
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    try {
        // Get all market_levels records from last 7 days
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const { data, error } = await supabase
            .from('market_levels')
            .select('timestamp, support_price, resistance_price, gamma_high_price, gamma_low_price')
            .gte('timestamp', sevenDaysAgo)
            .order('timestamp', { ascending: true });

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // Calculate stats
        const validRecords = data?.filter(d =>
            Math.abs(d.support_price - d.resistance_price) > 100
        ) || [];

        // Get min/max values to see range
        let supportMin = Infinity, supportMax = -Infinity;
        let resistanceMin = Infinity, resistanceMax = -Infinity;

        for (const r of validRecords) {
            if (r.support_price < supportMin) supportMin = r.support_price;
            if (r.support_price > supportMax) supportMax = r.support_price;
            if (r.resistance_price < resistanceMin) resistanceMin = r.resistance_price;
            if (r.resistance_price > resistanceMax) resistanceMax = r.resistance_price;
        }

        return NextResponse.json({
            totalRecords: data?.length || 0,
            validRecords: validRecords.length,
            timeRange: {
                oldest: data?.[0]?.timestamp,
                newest: data?.[data.length - 1]?.timestamp
            },
            supportRange: { min: Math.round(supportMin), max: Math.round(supportMax), variation: Math.round(supportMax - supportMin) },
            resistanceRange: { min: Math.round(resistanceMin), max: Math.round(resistanceMax), variation: Math.round(resistanceMax - resistanceMin) },
            // Show sample of data points
            samples: validRecords.slice(0, 10).map(r => ({
                time: r.timestamp,
                S: Math.round(r.support_price),
                R: Math.round(r.resistance_price)
            })),
            latestSamples: validRecords.slice(-5).map(r => ({
                time: r.timestamp,
                S: Math.round(r.support_price),
                R: Math.round(r.resistance_price)
            }))
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
