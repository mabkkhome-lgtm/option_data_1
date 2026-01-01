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
        // Test 2: Try to insert a test record
        const testRecord = {
            timestamp: new Date().toISOString(),
            expiry_date: 'TEST',
            current_price: 99999,
            gamma_high_price: 99999,
            gamma_low_price: 99999,
            support_price: 11111,
            resistance_price: 22222,
            window_start: new Date().toISOString()
        };

        const { data: insertData, error: insertError } = await supabase
            .from('market_levels')
            .insert(testRecord)
            .select();

        if (insertError) {
            return NextResponse.json({
                test: 'INSERT FAILED',
                error: insertError.message,
                code: insertError.code,
                details: insertError.details,
                hint: insertError.hint,
                testRecord
            }, { status: 500 });
        }

        // Test 3: Verify we can read it back
        const { data: readData, error: readError } = await supabase
            .from('market_levels')
            .select('*')
            .eq('expiry_date', 'TEST')
            .order('timestamp', { ascending: false })
            .limit(1);

        // Test 4: Delete the test record
        await supabase.from('market_levels').delete().eq('expiry_date', 'TEST');

        return NextResponse.json({
            success: true,
            insertResult: insertData,
            readResult: readData,
            message: 'Database write test PASSED!'
        });

    } catch (err) {
        return NextResponse.json({
            error: 'Exception occurred',
            message: String(err)
        }, { status: 500 });
    }
}
