import { NextResponse } from 'next/server';
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';

export const dynamic = 'force-dynamic';

export async function GET() {
    // Test 1: Check if Supabase is configured
    if (!isSupabaseConfigured || !supabase) {
        return NextResponse.json({
            error: 'Supabase not configured',
            isSupabaseConfigured,
            hasClient: !!supabase
        }, { status: 500 });
    }

    try {
        // Check Min/Max Timestamp and Count
        const { data: stats, error: statsError } = await supabase
            .from('market_levels')
            .select('timestamp')
            .order('timestamp', { ascending: true })
            .limit(1);

        const { data: statsMax } = await supabase
            .from('market_levels')
            .select('timestamp')
            .order('timestamp', { ascending: false })
            .limit(1);

        const { count } = await supabase
            .from('market_levels')
            .select('*', { count: 'exact', head: true });

        return NextResponse.json({
            success: true,
            count: count,
            minTimestamp: stats?.[0]?.timestamp,
            maxTimestamp: statsMax?.[0]?.timestamp,
            message: 'DB Stats Retrieved'
        });

    } catch (err) {
        return NextResponse.json({
            error: 'Exception occurred',
            message: String(err)
        }, { status: 500 });
    }
}
