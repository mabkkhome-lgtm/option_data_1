'use client';

import { useEffect } from 'react';

import { DashboardCanvas } from '@/components/dashboard';

export default function Home() {
  // Automated Background Process: Calculate Market Levels every 5 minutes
  // Triggers /api/cron/market-levels
  useEffect(() => {
    const runCalculation = async () => {
      try {
        console.log("Triggering Market Levels Calculation...");
        await fetch('/api/cron/market-levels');
      } catch (e) {
        console.error("Auto-calc failed", e);
      }
    };

    // Run immediately on load
    runCalculation();

    // Run every 5 minutes (300,000 ms)
    const interval = setInterval(runCalculation, 300000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden bg-background">
      {/* Top Navigation Bar */}
      <header className="h-12 bg-background-secondary border-b border-border-color flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center">
              <span className="text-white font-bold text-sm">OS</span>
            </div>
            <h1 className="text-lg font-bold text-foreground tracking-tight">
              Options Strategy Simulator
            </h1>
          </div>

          {/* Workspace Tabs */}
          <div className="flex items-center gap-1 ml-4">
            <div className="px-3 py-1.5 bg-accent-primary/20 text-accent-primary text-sm rounded-t border-b-2 border-accent-primary">
              Workspace 1
            </div>
            <button className="px-2 py-1.5 text-foreground-muted hover:text-foreground text-sm transition-colors">
              +
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Market Status */}
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-bullish animate-pulse"></span>
            <span className="text-foreground-muted">Markets Open</span>
          </div>

          {/* User Menu */}
          <button className="w-8 h-8 rounded-full bg-background-tertiary border border-border-color flex items-center justify-center text-foreground-muted hover:text-foreground transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main Dashboard Canvas */}
      <main className="h-[calc(100vh-48px)] w-full">
        <DashboardCanvas />
      </main>
    </div>
  );
}
