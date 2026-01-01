import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';

export const dynamic = 'force-dynamic';

export async function GET() {
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    try {
        // Get most recent 20 records (regardless of date)
        const { data: recentData, error: recentError } = await supabase
            .from('market_levels')
            .select('timestamp, support_price, resistance_price, gamma_high_price, gamma_low_price')
            .order('timestamp', { ascending: false })
            .limit(20);

        if (recentError) {
            return NextResponse.json({ error: recentError.message }, { status: 500 });
        }

        // Calculate which are valid
        const validRecent = recentData?.filter(d =>
            Math.abs(d.support_price - d.resistance_price) > 100
        ) || [];

        return NextResponse.json({
            totalRecentRecords: recentData?.length || 0,
            validRecentRecords: validRecent.length,
            mostRecent: recentData?.slice(0, 10).map(r => ({
                time: r.timestamp,
                S: Math.round(r.support_price),
                R: Math.round(r.resistance_price),
                diff: Math.round(Math.abs(r.support_price - r.resistance_price)),
                valid: Math.abs(r.support_price - r.resistance_price) > 100
            }))
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
