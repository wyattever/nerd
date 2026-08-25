import React, { useState } from 'react';
import { 
  LayoutTemplate, 
  SplitSquareHorizontal, 
  FileCode2, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  ChevronRight, 
  Server, 
  FileText 
} from 'lucide-react';

// ============================================================================
// MOCK FILE SYSTEM & METADATA
// ============================================================================

const mockNerdCss = `
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #333; padding: 2rem; background: #fff; margin: 0; }
    h1 { color: #0054a6; font-size: 2rem; margin-bottom: 0.5rem; margin-top: 0; }
    h2 { font-size: 1.2rem; border-bottom: 1px solid #eee; padding-bottom: 0.5rem; margin-top: 2rem; }
    .vendor { font-weight: bold; color: #555; }
    .link-list { list-style: none; padding: 0; }
    .link-list li { margin-bottom: 0.5rem; }
    .link-list a { color: #0054a6; text-decoration: none; }
    .link-list a:hover { text-decoration: underline; }
    .ai-insights { background: #f4f4f4; padding: 1.5rem; border-left: 4px solid #0054a6; margin-top: 2rem; border-radius: 4px; }
    .badge-legacy { display: inline-block; padding: 4px 8px; background: #fee2e2; color: #991b1b; font-size: 12px; font-weight: 600; border-radius: 4px; margin-bottom: 1rem;}
    .badge-new { display: inline-block; padding: 4px 8px; background: #dbeafe; color: #1e3a8a; font-size: 12px; font-weight: 600; border-radius: 4px; margin-bottom: 1rem;}
  </style>
`;

const mockFileSystem = {
  'canvas-lms': {
    metadata: {
      product_name: "Canvas LMS",
      product_slug: "canvas-lms",
      ncademi_url: "https://directory.ncademi.org/listing/canvas-lms",
      vendor_url: "https://www.instructure.com/canvas",
      last_captured: "2026-06-14T10:00:00Z",
      nerd_status: "draft_complete",
      version_history: [
        { id: "v1", date: "2024-02-10", type: "initial_capture" },
        { id: "v2", date: "2026-06-14", type: "nerd_update" }
      ]
    },
    currentHtml: `
      ${mockNerdCss}
      <span class="badge-legacy">Legacy Version (2024)</span>
      <h1>Canvas LMS</h1>
      <p class="vendor">Vendor: Instructure</p>
      <p>Canvas is a web-based learning management system, or LMS. It is used by learning institutions, educators, and students to access and manage online course learning materials.</p>
      <h2>Vendor Resources</h2>
      <ul class="link-list">
        <li><a href="#">Canvas Accessibility Statement (Broken Link)</a></li>
        <li><a href="#">Old VPAT 2.3 (2021)</a></li>
      </ul>
      <h2>Support</h2>
      <p>Contact support@instructure.com</p>
    `,
    updatedHtml: `
      ${mockNerdCss}
      <span class="badge-new">N.E.R.D. Update (2026)</span>
      <h1>Canvas LMS</h1>
      <p class="vendor">Vendor: Instructure</p>
      <p>Canvas is a web-based learning management system, or LMS. It is used by learning institutions, educators, and students to access and manage online course learning materials.</p>
      <h2>Vendor Resources</h2>
      <ul class="link-list">
        <li><a href="#">Canvas Accessibility Standards (Verified 2026)</a></li>
        <li><a href="#">Current WCAG 2.1 AA VPAT</a></li>
      </ul>
      <h2>Third-Party Insights</h2>
      <ul class="link-list">
        <li><a href="#">WebAIM: Canvas LMS Review</a></li>
        <li><a href="#">Ohio State University Accessibility Audit</a></li>
      </ul>
      <div class="ai-insights">
        <h3 style="margin-top: 0; margin-bottom: 0.5rem;">AI Generated Insights</h3>
        <p style="margin: 0;">Canvas LMS demonstrates a mature approach to accessibility, providing updated WCAG 2.1 AA conformance reports. Third-party institutional audits confirm strong support for screen readers, though some complex interactive modules may require keyboard navigation workarounds. The vendor maintains an active accessibility community forum.</p>
      </div>
      <h2>Support</h2>
      <p><a href="#">Canvas Accessibility Community</a></p>
    `
  },
  'zoom-edu': {
    metadata: {
      product_name: "Zoom for Education",
      product_slug: "zoom-edu",
      ncademi_url: "https://directory.ncademi.org/listing/zoom-edu",
      vendor_url: "https://zoom.us/education",
      last_captured: "2026-06-13T15:30:00Z",
      nerd_status: "pending_review",
      version_history: [
        { id: "v1", date: "2025-01-01", type: "initial_capture" },
        { id: "v2", date: "2026-06-13", type: "nerd_update" }
      ]
    },
    currentHtml: `${mockNerdCss}<h1>Zoom for Education</h1><p>Legacy content pending...</p>`,
    updatedHtml: `${mockNerdCss}<h1>Zoom for Education</h1><p>Updated content pending review...</p><div class="ai-insights">Testing layout.</div>`
  }
};

// ============================================================================
// APP COMPONENT
// ============================================================================

export default function App() {
  const [activeSlug, setActiveSlug] = useState('canvas-lms');
  const [viewMode, setViewMode] = useState('split');

  const activeData = mockFileSystem[activeSlug];
  const meta = activeData.metadata;

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden">
      
      {/* SIDEBAR */}
      <aside className="w-full md:w-64 bg-slate-900 text-slate-300 flex flex-col flex-shrink-0 shadow-xl z-20">
        <div className="p-5 border-b border-slate-800">
          <div className="flex items-center text-white font-bold text-lg tracking-tight">
            <Server className="mr-2 text-blue-500" size={20} />
            NCADEMI Repo
          </div>
          <p className="text-xs text-slate-400 mt-1">Static Artifact Viewer</p>
        </div>
        
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 mt-2 px-3">Products</div>
          {Object.entries(mockFileSystem).map(([slug, data]) => (
            <button
              key={slug}
              onClick={() => setActiveSlug(slug)}
              className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center justify-between transition-all duration-200 ${
                activeSlug === slug 
                  ? 'bg-blue-600 text-white font-medium shadow-md' 
                  : 'hover:bg-slate-800 text-slate-300'
              }`}
            >
              <div className="flex items-center truncate">
                <FileText size={16} className={`mr-2.5 flex-shrink-0 ${activeSlug === slug ? 'text-blue-200' : 'text-slate-500'}`} />
                <span className="truncate text-sm">{data.metadata.product_name}</span>
              </div>
              {activeSlug === slug && <ChevronRight size={16} className="text-blue-300" />}
            </button>
          ))}
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        
        {/* TOP HEADER */}
        <header className="bg-white border-b border-slate-200 px-6 py-5 flex-shrink-0 z-10 shadow-sm">
          <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
            
            {/* Metadata Info */}
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center">
                {meta.product_name}
                {meta.nerd_status === 'draft_complete' ? (
                  <span className="ml-4 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 border border-green-200">
                    <CheckCircle2 size={14} className="mr-1.5" /> Update Ready
                  </span>
                ) : (
                  <span className="ml-4 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800 border border-yellow-200">
                    <AlertCircle size={14} className="mr-1.5" /> Pending
                  </span>
                )}
              </h1>
              
              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-slate-500">
                <span className="flex items-center bg-slate-100 px-2 py-1 rounded-md"><FileCode2 size={14} className="mr-1.5 text-slate-400"/> /{meta.product_slug}/</span>
                <span className="flex items-center"><Clock size={14} className="mr-1.5 text-slate-400"/> Captured: {new Date(meta.last_captured).toLocaleDateString()}</span>
                <span className="text-slate-300">•</span>
                <a href={meta.ncademi_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800 hover:underline font-medium">Live Directory</a>
              </div>
            </div>

            {/* View Mode Toggle */}
            <div className="bg-slate-100 p-1 rounded-xl flex items-center border border-slate-200 shadow-inner">
              <button
                onClick={() => setViewMode('current')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center ${
                  viewMode === 'current' ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                }`}
              >
                Current Version
              </button>
              <button
                onClick={() => setViewMode('split')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center ${
                  viewMode === 'split' ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-200' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                }`}
              >
                <SplitSquareHorizontal size={16} className="mr-2" /> Split View
              </button>
              <button
                onClick={() => setViewMode('updated')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center ${
                  viewMode === 'updated' ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-200' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                }`}
              >
                <LayoutTemplate size={16} className="mr-2" /> N.E.R.D. Draft
              </button>
            </div>
          </div>
        </header>

        {/* VIEWER AREA: Iframes */}
        <div className="flex-1 bg-slate-200 p-6 overflow-hidden">
          
          {/* SINGLE VIEW (Current) */}
          {viewMode === 'current' && (
            <div className="w-full h-full bg-white rounded-xl shadow-md border border-slate-300 overflow-hidden flex flex-col transition-all">
              <div className="bg-slate-100 border-b border-slate-200 px-4 py-2.5 text-xs font-mono text-slate-600 flex items-center justify-between">
                <div className="flex items-center">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-400 mr-2.5"></span> 
                  {meta.product_slug}/current.html
                </div>
                <span className="bg-slate-200 px-2.5 py-1 rounded-md text-slate-700 font-sans font-semibold">Production</span>
              </div>
              <iframe className="w-full flex-1 border-0 bg-white" srcDoc={activeData.currentHtml} sandbox="allow-same-origin allow-scripts" />
            </div>
          )}

          {/* SINGLE VIEW (Updated) */}
          {viewMode === 'updated' && (
            <div className="w-full h-full bg-white rounded-xl shadow-lg border-2 border-blue-400 overflow-hidden flex flex-col transition-all">
              <div className="bg-blue-50 border-b border-blue-200 px-4 py-2.5 text-xs font-mono text-blue-800 flex items-center justify-between">
                <div className="flex items-center">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500 mr-2.5 animate-pulse shadow-sm"></span> 
                  {meta.product_slug}/updated.html
                </div>
                <span className="bg-blue-200 px-2.5 py-1 rounded-md text-blue-900 font-sans font-semibold shadow-sm">Draft Proposed</span>
              </div>
              <iframe className="w-full flex-1 border-0 bg-white" srcDoc={activeData.updatedHtml} sandbox="allow-same-origin allow-scripts" />
            </div>
          )}

          {/* SPLIT VIEW (Side-by-Side) */}
          {viewMode === 'split' && (
            <div className="w-full h-full flex flex-col lg:flex-row gap-6">
              
              {/* Left Pane: Current */}
              <div className="flex-1 bg-white rounded-xl shadow-md border border-slate-300 overflow-hidden flex flex-col transition-all">
                <div className="bg-slate-100 border-b border-slate-200 px-4 py-2.5 text-xs font-mono text-slate-600 flex items-center justify-between">
                  <div className="flex items-center">
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-400 mr-2.5"></span> 
                    current.html
                  </div>
                  <span className="bg-slate-200 px-2.5 py-1 rounded-md text-slate-700 font-sans font-semibold">Production</span>
                </div>
                <iframe className="w-full flex-1 border-0 bg-white" srcDoc={activeData.currentHtml} sandbox="allow-same-origin allow-scripts" />
              </div>

              {/* Right Pane: Updated */}
              <div className="flex-1 bg-white rounded-xl shadow-lg border-2 border-blue-400 overflow-hidden flex flex-col transition-all">
                <div className="bg-blue-50 border-b border-blue-200 px-4 py-2.5 text-xs font-mono text-blue-800 flex items-center justify-between">
                  <div className="flex items-center">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500 mr-2.5 animate-pulse shadow-sm"></span> 
                    updated.html
                  </div>
                  <span className="bg-blue-200 px-2.5 py-1 rounded-md text-blue-900 font-sans font-semibold shadow-sm">Draft Proposed</span>
                </div>
                <iframe className="w-full flex-1 border-0 bg-white" srcDoc={activeData.updatedHtml} sandbox="allow-same-origin allow-scripts" />
              </div>

            </div>
          )}

        </div>
      </main>
    </div>
  );
}