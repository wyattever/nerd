"use client";
import { ResearchProvider } from "@/context/ResearchContext";
import { ResearchController } from "@/components/ResearchController";
import { EditorPanel } from "@/components/EditorPanel";

export default function Home() {
  return (
    <ResearchProvider>
      <main className="nerd-layout">
        <header className="nerd-header">
          <h1>N.E.R.D.</h1>
          <p className="nerd-subtitle">NCADEMI EdTech Research & Directory</p>
        </header>
        
        <ResearchController />
        <EditorPanel />
      </main>
    </ResearchProvider>
  );
}
