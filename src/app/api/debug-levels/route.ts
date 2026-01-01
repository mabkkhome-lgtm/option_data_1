import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';

export const dynamic = 'force-dynamic';

export async function GET() {
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    try {
        // Get last 500 records
        const { data, error } = await supabase
            .from('market_levels')
            .select('timestamp, support_price, resistance_price, gamma_high_price, gamma_low_price')
            .order('timestamp', { ascending: false })
            .limit(500);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // Analyze the data
        const records = data?.map(r => ({
            time: r.timestamp,
            S: Math.round(r.support_price),
            R: Math.round(r.resistance_price),
            GH: Math.round(r.gamma_high_price),
            GL: Math.round(r.gamma_low_price),
            diff: Math.round(Math.abs(r.support_price - r.resistance_price)),
            valid: Math.abs(r.support_price - r.resistance_price) > 100
        })) || [];

        const validCount = records.filter(r => r.valid).length;
        const invalidCount = records.filter(r => !r.valid).length;

        return NextResponse.json({
            totalRecords: records.length,
            validRecords: validCount,
            invalidRecords: invalidCount,
            oldestRecord: records[records.length - 1]?.time,
            newestRecord: records[0]?.time,
            // All records for analysis
            allRecords: records
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
